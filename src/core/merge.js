// Führt die Ergebnisse der Strategien feldweise zusammen, prüft Plausibilität
// und kennzeichnet jedes Feld mit Quelle und Status:
//   ok      – sicher erkannt (und, wo möglich, durch Rechenprüfung bestätigt)
//   warn    – erkannt, aber bitte prüfen (Ersatzstrategie, Abweichung, Prüfung fehlgeschlagen)
//   missing – nicht erkannt, muss manuell ergänzt werden
//   empty   – optionales Feld, im Angebot nicht vorhanden

import { RE, normalizeSpaces } from './patterns.js';
import { parseDecimal, mul, sum, rescale, percentOf, approxEqual, formatMoney } from './decimal.js';

export const SOURCE_LABELS = {
  layout: 'PDF-Layout',
  text: 'Textmuster',
  filename: 'Dateiname',
  manual: 'Manuell',
};

const VALIDATORS = {
  offerNumber: (v) => RE.offerNumberValue.test(v),
  offerDate: (v) => RE.date.test(v),
  validUntil: (v) => RE.date.test(v),
  customerVatId: (v) => RE.vatId.test(v),
  customerNumber: (v) => !!v,
  customerName: (v) => !!normalizeSpaces(v),
  customerAddress: (v) => Array.isArray(v) && v.length > 0,
  notes: (v) => Array.isArray(v) && v.length > 0,
  paymentTerms: (v) => Array.isArray(v) && v.length > 0,
  closingNotes: (v) => Array.isArray(v) && v.length > 0,
};

const OPTIONAL = new Set(['customerVatId', 'customerNumber', 'notes', 'closingNotes', 'validUntil']);

/**
 * @param {object} p
 * @param {object|null} p.layout  Ergebnis Strategie A
 * @param {object|null} p.text    Ergebnis Strategie B
 * @param {string}      p.fileName
 */
export function buildDraft({ layout = null, text = null, fileName = '' }) {
  const results = [layout, text].filter(Boolean);
  const draft = { fields: {}, items: null, totals: null, checks: [], log: [], isOffer: false };

  for (const r of results) {
    for (const msg of r.log) draft.log.push(`[${SOURCE_LABELS[r.strategy]}] ${msg}`);
    if (r.meta.isOffer) draft.isOffer = true;
  }

  const fromFile = fileName.match(RE.offerNumberLoose);
  const extra = { offerNumber: fromFile ? [{ source: 'filename', value: fromFile[1], weak: true }] : [] };

  const valueOf = (r, key) => {
    if (key in r.fields) return r.fields[key];
    if (key === 'notes') return r.notes;
    if (key === 'paymentTerms') return r.paymentTerms;
    if (key === 'closingNotes') return r.closingNotes;
    return null;
  };

  for (const key of Object.keys(VALIDATORS)) {
    const candidates = results.map((r) => ({ source: r.strategy, value: valueOf(r, key), weak: !!r.weak?.[key] }));
    candidates.push(...(extra[key] || []));
    draft.fields[key] = pickField(key, candidates);
  }

  // ── Positionen ──────────────────────────────────────────────────────────
  const totals = pickTotals(results);
  draft.totals = totals;
  const evaluated = results.filter((r) => r.items.length).map((r) => ({ r, check: checkItems(r.items, totals) }));
  const best =
    evaluated.find((e) => e.check.rowsOk && e.check.sumOk !== false) ||
    evaluated.find((e) => e.check.rowsOk) ||
    evaluated[0];

  if (!best) {
    draft.items = {
      value: [],
      source: null,
      status: 'missing',
      note: 'Keine Positionen erkannt – bitte manuell erfassen.',
    };
  } else {
    const others = evaluated.filter((e) => e !== best);
    const agree = others.every((o) => sameNumbers(o.r.items, best.r.items));
    const sameText = others.every((o) => sameTexts(o.r.items, best.r.items));
    let status = 'ok';
    const notes = [];
    if (!best.check.rowsOk || best.check.sumOk === false) {
      status = 'warn';
      notes.push('Rechenprüfung nicht bestanden – Positionen bitte prüfen.');
    }
    if (others.length && !agree) {
      status = 'warn';
      notes.push('Die Erkennungsstrategien weichen bei Mengen/Preisen voneinander ab.');
    }
    if (best.r.strategy !== 'layout') {
      status = 'warn';
      notes.push('Positionen über Ersatzstrategie (Textmuster) erkannt – Zeilenzuordnung bitte prüfen.');
    }
    if (others.length && agree && !sameText) {
      draft.log.push(
        'Hinweis: Die Strategien grenzen die Positionstexte unterschiedlich ab – Layout-Ergebnis verwendet.',
      );
    }
    const items = best.r.items.map((it) => ({ ...it, flags: [...it.flags] }));
    if (items.some((it) => it.flags.length)) status = 'warn';
    draft.items = { value: items, source: best.r.strategy, status, note: notes.join(' ') };
    draft.checks.push(...best.check.list);
  }

  draft.checks.unshift({
    label: 'Dokument ist ein Angebot',
    ok: draft.isOffer,
    detail: draft.isOffer ? 'Titel „Angebot“ gefunden' : 'Titel „Angebot“ nicht gefunden – ist das die richtige Datei?',
  });
  return draft;
}

function pickField(key, candidates) {
  const optional = OPTIONAL.has(key);
  const isList = ['customerAddress', 'notes', 'paymentTerms', 'closingNotes'].includes(key);
  const valid = candidates.filter((c) => c.value != null && VALIDATORS[key](c.value));
  if (!valid.length) {
    return { value: isList ? [] : '', source: null, status: optional ? 'empty' : 'missing', note: '' };
  }
  const chosen = valid.find((c) => !c.weak) || valid[0];
  const differing = valid.filter((c) => c !== chosen && !same(c.value, chosen.value) && !c.weak);
  let status = 'ok';
  let note = '';
  if (chosen.weak) {
    status = 'warn';
    note = `Nur indirekt erkannt (${SOURCE_LABELS[chosen.source]}) – bitte prüfen.`;
  } else if (differing.length) {
    status = 'warn';
    note = differing
      .map((d) => `${SOURCE_LABELS[d.source]} liest: „${Array.isArray(d.value) ? d.value.join(' / ') : d.value}“`)
      .join('; ');
  }
  return { value: chosen.value, source: chosen.source, status, note };
}

function same(a, b) {
  const norm = (v) => (Array.isArray(v) ? v.map(normalizeSpaces).join('\n') : normalizeSpaces(v));
  return norm(a) === norm(b);
}

function pickTotals(results) {
  const out = { net: null, vat: null, gross: null, discount: null };
  for (const key of Object.keys(out)) {
    for (const r of results) {
      if (out[key] == null && r.totals[key] != null) out[key] = r.totals[key];
    }
  }
  return out;
}

function sameNumbers(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    const eq = (p, q) => {
      const dp = parseDecimal(p);
      const dq = parseDecimal(q);
      return dp && dq ? approxEqual(dp, dq, 0) : p === q;
    };
    return eq(x.quantity, y.quantity) && eq(x.unitPrice, y.unitPrice);
  });
}

function sameTexts(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => same([x.title, ...x.description], [b[i].title, ...b[i].description]));
}

/** Rechenprüfungen: Menge × Preis = Betrag, Summe, MwSt., Gesamt */
export function checkItems(items, totals) {
  const list = [];
  let rowsOk = true;
  const nets = [];
  const byRate = new Map();
  items.forEach((it, idx) => {
    const q = parseDecimal(it.quantity);
    const p = parseDecimal(it.unitPrice);
    const n = it.net != null ? parseDecimal(it.net) : null;
    if (!q || !p) {
      rowsOk = false;
      list.push({ label: `Position ${idx + 1}: Menge/Einzelpreis lesbar`, ok: false, detail: 'Zahl nicht lesbar' });
      return;
    }
    const calc = rescale(mul(q, p), 2);
    const net = n || calc;
    nets.push(net);
    const rate = it.vatRate != null ? parseDecimal(it.vatRate) : null;
    if (rate) {
      const key = it.vatRate;
      byRate.set(key, { rate, nets: [...(byRate.get(key)?.nets || []), net] });
    }
    if (n) {
      const ok = approxEqual(calc, n, 1);
      if (!ok) rowsOk = false;
      list.push({
        label: `Position ${idx + 1}: Menge × Einzelpreis = Betrag`,
        ok,
        detail: `${it.quantity} × ${it.unitPrice} € = ${formatMoney(calc)}${ok ? '' : ` (Angebot: ${it.net} €)`}`,
      });
    }
  });

  let sumOk = null;
  const totalNet = sum(nets);
  if (totals?.net && nets.length === items.length) {
    const t = parseDecimal(totals.net);
    sumOk = !!t && approxEqual(totalNet, t, 1);
    list.push({
      label: 'Summe der Positionen = Nettobetrag',
      ok: sumOk,
      detail: `${formatMoney(rescale(totalNet, 2))}${t ? ` / Angebot: ${totals.net} €` : ''}`,
    });
  }
  if (totals?.vat && byRate.size) {
    const t = parseDecimal(totals.vat);
    const calcVat = sum([...byRate.values()].map(({ rate, nets: ns }) => rescale(percentOf(sum(ns), rate), 2)));
    const ok = !!t && approxEqual(calcVat, t, items.length);
    list.push({ label: 'MwSt.-Betrag', ok, detail: `${formatMoney(calcVat)} / Angebot: ${totals.vat} €` });
  }
  if (totals?.gross && totals?.net && totals?.vat) {
    const g = parseDecimal(totals.gross);
    const calc = sum([parseDecimal(totals.net), parseDecimal(totals.vat)].filter(Boolean));
    const ok = !!g && approxEqual(calc, g, 1);
    list.push({ label: 'Gesamt = Netto + MwSt.', ok, detail: `${formatMoney(calc)} / Angebot: ${totals.gross} €` });
  }
  return { rowsOk, sumOk, list };
}
