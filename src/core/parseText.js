// Strategie B: Erkennung über reinen Text (reguläre Ausdrücke, keine Positionen).
// Wird verwendet, wenn das Layout nicht ausgewertet werden kann, und für
// eingefügten Text (Fallback "Text aus dem PDF kopieren & einfügen").
// Kopierter Text kommt je nach PDF-Viewer in unterschiedlicher Reihenfolge an
// (zeilenweise, Zahlen nach jeder Position, spaltenweise) – alle Varianten
// werden unterstützt.

import { emptyResult, splitQuantity } from './result.js';
import {
  RE,
  SUMMARY_LABELS,
  PAYMENT_HEADING,
  VALIDITY_LINE,
  CLOSING_STOP,
  DEFAULT_IGNORED_INTROS,
  normalizeSpaces,
  normalizeVatId,
  makeOwnDataMatcher,
} from './patterns.js';

const NUM = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`;
const MONEY = String.raw`-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,4}`;
// Menge [Einheit] Einzelpreis € MwSt % Nettobetrag €  (am Zeilenende)
const ROW_RE = new RegExp(
  String.raw`(?:^|\s)(${NUM})(?:\s+([A-Za-zÄÖÜäöüß.]{1,12}))?\s+(${MONEY})\s*€\s+(\d{1,2}(?:,\d{1,2})?)\s*%\s+(${MONEY})\s*€$`,
);
const MONEY_ONLY = new RegExp(String.raw`^(?:${MONEY}\s*€\s*)+$`);
const MONEY_ALL = new RegExp(String.raw`(${MONEY})\s*€`, 'g');
const LABEL_MONEY = new RegExp(String.raw`^(.*?\D)\s+(${MONEY})\s*€$`);
// Zeile nur mit E-Mail/Webadresse → gehört zur Fußzeile, nicht zu den Zahlungsbedingungen
const CONTACT_ONLY = /^(\S+@\S+\.\w+|(https?:\/\/|www\.)\S+)$/i;
const META_STRIP = [
  /Kunden-?\s?USt\.?-?\s?ID-?\s?Nr\.?:?\s*[A-Z]{2}\s?[0-9A-Z+*]{2,12}/gi,
  /Angebots-?\s?(?:nummer|nr\.?):?\s*[A-Z]{1,5}-\d{4}-\d{2,6}/gi,
  /(?:Ausstellungsdatum|Angebotsdatum):?\s*\d{1,2}\.\d{1,2}\.\d{4}/gi,
  /Kunden-?\s?(?:nummer|nr\.?):?\s*\S+/gi,
  /(?:Gültig bis|Gültigkeit):?\s*\d{1,2}\.\d{1,2}\.\d{4}/gi,
  /^(Kunden-?\s?USt\.?-?\s?ID-?\s?Nr\.?|Angebotsnummer|Ausstellungsdatum|Kundennummer)\s*:?$/gi,
  // unbeschriftete Kopfwerte (Angebotsnummer, Datum) gehören nicht zur Anschrift
  /\b[A-Z]{1,5}-\d{4}-\d{2,6}\b/g,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
];

/**
 * @param {string|string[]} input  Text bzw. Zeilen
 */
export function parseText(input, opts = {}) {
  const res = emptyResult('text');
  const log = (m) => res.log.push(m);
  const isOwn = makeOwnDataMatcher(opts);
  const ignoredIntros = opts.ignoredIntros || DEFAULT_IGNORED_INTROS;

  // Zeilen mit Merker "Leerzeile davor" (Absatzgrenzen helfen beim Abgrenzen)
  // Seitenzahlen und Fußzeilen (eigene Firmendaten, auf jeder Seite wiederholt) fallen weg
  const entries = [];
  let blank = false;
  for (const raw of Array.isArray(input) ? input : String(input).split(/\r?\n/)) {
    const text = normalizeSpaces(raw);
    if (!text || RE.pageNumber.test(text) || isOwn(text)) {
      blank = true;
      continue;
    }
    entries.push({ text, blankBefore: blank });
    blank = false;
  }
  const lines = entries.map((e) => e.text);
  const full = lines.join('\n');

  // ── Abschnitte ──────────────────────────────────────────────────────────
  const titleIdx = lines.findIndex((l) => /^Angebot$/i.test(l));
  // Absenderzeile ("Firma · Straße, PLZ Ort") direkt unter dem Titel
  const senderIdx = lines.findIndex(
    (l, i) =>
      i > titleIdx &&
      i <= titleIdx + 3 &&
      /[·|•]/.test(l) &&
      ((!!opts.ownCompanyName && l.startsWith(opts.ownCompanyName)) || /\b\d{4,5}\b/.test(l)),
  );
  const headerEnd = findHeaderEnd(lines);
  if (headerEnd < 0) log('Tabellenkopf im Text nicht gefunden.');

  // ── Kopfdaten ───────────────────────────────────────────────────────────
  const head = titleIdx >= 0 ? lines.slice(titleIdx) : lines;
  const num = full.match(/Angebots-?\s?(?:nummer|nr\.?)\s*:?\s*([A-Z]{1,5}-\d{4}-\d{2,6})/i);
  res.fields.offerNumber = num ? num[1] : null;
  if (!num) {
    // Beschriftung und Wert getrennt (z. B. spaltenweise kopiert) → loses Muster
    const loose = head.find((l) => !isOwn(l) && RE.offerNumberLoose.test(l));
    if (loose) {
      res.fields.offerNumber = loose.match(RE.offerNumberLoose)[1];
      res.weak.offerNumber = true;
      log('Angebotsnummer nur über Muster (ohne Beschriftung) gefunden.');
    }
  }
  const date = full.match(/(?:Ausstellungsdatum|Angebotsdatum)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
  res.fields.offerDate = date ? date[1] : null;
  if (!date) {
    const loose = head.slice(0, 20).find((l) => RE.dateInText.test(l) && !VALIDITY_LINE.test(l));
    if (loose) {
      res.fields.offerDate = loose.match(RE.dateInText)[1];
      res.weak.offerDate = true;
      log('Ausstellungsdatum nur über Muster (ohne Beschriftung) gefunden.');
    }
  }
  const vat = full.match(/Kunden-?\s?USt\.?-?\s?ID-?\s?Nr\.?\s*:?\s*([A-Z]{2}\s?[0-9A-Z+*]{2,12})/i);
  if (vat) {
    const v = normalizeVatId(vat[1]);
    if (RE.vatId.test(v)) res.fields.customerVatId = v;
  }
  const custNo = full.match(/Kunden-?\s?(?:nummer|nr\.?)\s*:?\s*(\S+)/i);
  res.fields.customerNumber = custNo ? custNo[1] : null;
  res.meta.isOffer = titleIdx >= 0;
  res.meta.title = res.meta.isOffer ? 'Angebot' : null;

  // ── Adresse + Hinweise ──────────────────────────────────────────────────
  const preStart = Math.max(titleIdx, senderIdx) + 1;
  const preEnd = headerEnd >= 0 ? headerStart(lines, headerEnd) : Math.min(lines.length, preStart + 8);
  const address = [];
  const notes = [];
  let introSeen = false;
  for (let i = preStart; i < preEnd; i++) {
    let l = lines[i];
    for (const re of META_STRIP) l = l.replace(re, ' ');
    if (res.fields.customerVatId) l = l.replace(res.fields.customerVatId, ' ');
    l = normalizeSpaces(l);
    if (!l || isOwn(l)) continue;
    if (ignoredIntros.some((re) => re.test(l))) {
      introSeen = true;
      continue;
    }
    (introSeen ? notes : address).push(l);
  }
  if (address.length) {
    res.fields.customerName = address[0];
    res.fields.customerAddress = address.slice(1);
  } else log('Empfängeradresse im Text nicht gefunden.');
  res.notes = notes;

  // ── Positionen + Summen ─────────────────────────────────────────────────
  if (headerEnd >= 0) {
    const table = joinNumericFragments(dropRepeatedHeaders(entries.slice(headerEnd + 1)));
    let sumIdx = table.findIndex((e) => SUMMARY_LABELS.net.test(e.text));
    if (sumIdx < 0) {
      log('Summenblock im Text nicht gefunden.');
      sumIdx = table.findIndex(
        (e) => PAYMENT_HEADING.test(e.text) || VALIDITY_LINE.test(e.text) || CLOSING_STOP.test(e.text),
      );
      if (sumIdx < 0) sumIdx = table.length;
    }
    res.items = readItems(table.slice(0, sumIdx), log);
    readSummary(table.slice(sumIdx), res.totals);
  }

  // ── Zahlungsbedingungen / Gültigkeit / weitere Hinweise ────────────────
  const payIdx = lines.findIndex((l, i) => i > headerEnd && PAYMENT_HEADING.test(l));
  if (payIdx >= 0) {
    const rest = lines[payIdx].match(PAYMENT_HEADING)[1];
    const terms = rest ? [rest] : [];
    for (let i = payIdx + 1; i < lines.length && terms.length < 8; i++) {
      const l = lines[i];
      if (CLOSING_STOP.test(l) || VALIDITY_LINE.test(l) || isOwn(l) || isFooterName(l, opts) || CONTACT_ONLY.test(l))
        break;
      terms.push(l);
    }
    res.paymentTerms = terms;
    for (let i = payIdx + 1 + terms.length - (rest ? 1 : 0); i < lines.length; i++) {
      const l = lines[i];
      if (isOwn(l) || isFooterName(l, opts) || CONTACT_ONLY.test(l)) break;
      if (!VALIDITY_LINE.test(l)) res.closingNotes.push(l);
    }
  }
  const validity = lines.find((l) => VALIDITY_LINE.test(l) && RE.dateInText.test(l));
  if (validity) {
    res.validityText = validity;
    res.fields.validUntil = validity.match(RE.dateInText)[1];
  }
  return res;
}

// ════════════════════════════════════════════════════════════════════════

function isFooterName(line, opts) {
  return !!opts.ownCompanyName && line.trim() === opts.ownCompanyName;
}

/** Auf Folgeseiten wiederholter Tabellenkopf (als eine Zeile oder Wort für Wort) */
function dropRepeatedHeaders(entries) {
  const word = /^(Artikel|Menge|Einzelpreis|MwSt\.?\s*\(%\)|Nettobetrag)$/i;
  const out = [];
  let pendingBlank = false;
  for (let i = 0; i < entries.length; i++) {
    const t = entries[i].text;
    const fullHeader = /\bArtikel\b/i.test(t) && /\bMenge\b/i.test(t) && /(Einzelpreis|Nettobetrag)/i.test(t);
    let run = 0;
    while (i + run < entries.length && word.test(entries[i + run].text)) run++;
    if (fullHeader || run >= 3) {
      i += Math.max(run, 1) - 1;
      pendingBlank = true;
      continue;
    }
    out.push({ ...entries[i], blankBefore: entries[i].blankBefore || pendingBlank });
    pendingBlank = false;
  }
  return out;
}

/** Zahlen, die beim Kopieren auf eigene Zeilen gerutscht sind, wieder zusammenfügen */
function joinNumericFragments(entries) {
  const frag = /^(?:-?[\d.]+(?:,\d+)?\s*(?:€|%|[A-Za-z.]{1,6})?|€|%)$/;
  const out = [];
  for (const e of entries) {
    const prev = out.length ? out[out.length - 1] : null;
    if (
      prev &&
      frag.test(e.text) &&
      /(?:\d|€|%|\.)$/.test(prev.text) &&
      !ROW_RE.test(prev.text) &&
      isNumericish(prev.text)
    ) {
      prev.text = `${prev.text} ${e.text}`;
    } else out.push({ ...e });
  }
  return out;
}

function isNumericish(text) {
  return /^[-\d.,\s€%A-Za-z]*$/.test(text) && /\d/.test(text) && !/[A-Za-z]{7,}/.test(text);
}

function findHeaderEnd(lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\bArtikel\b/i.test(l) && /\bMenge\b/i.test(l) && /(Nettobetrag|Einzelpreis)/i.test(l)) return i;
    if (/^Artikel$/i.test(l)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) if (/^Nettobetrag$/i.test(lines[j])) return j;
    }
  }
  return -1;
}

function headerStart(lines, headerEnd) {
  let i = headerEnd;
  while (i > 0 && /^(Artikel|Menge|Einzelpreis|MwSt\.?\s*\(%\)|Nettobetrag)$/i.test(lines[i - 1])) i--;
  return /^(Artikel|Menge|Einzelpreis|MwSt|Nettobetrag)/i.test(lines[i]) ? i : headerEnd;
}

/** Summenblock: "Label Betrag" je Zeile oder spaltenweise (erst Labels, dann Beträge) */
function readSummary(entries, totals) {
  const pairs = [];
  const labels = [];
  const values = [];
  for (const { text } of entries) {
    const lm = text.match(LABEL_MONEY);
    if (lm && isSummaryLabel(lm[1])) pairs.push([lm[1], lm[2]]);
    else if (isSummaryLabel(text)) labels.push(text);
    else if (MONEY_ONLY.test(text)) values.push(...[...text.matchAll(MONEY_ALL)].map((m) => m[1]));
    else break;
  }
  labels.forEach((l, i) => values[i] != null && pairs.push([l, values[i]]));
  for (const [label, value] of pairs) {
    if (SUMMARY_LABELS.discount.test(label)) totals.discount = value;
    else if (SUMMARY_LABELS.net.test(label)) totals.net = totals.net ?? value;
    else if (SUMMARY_LABELS.vat.test(label)) {
      totals.vatLines.push({ label, value });
      if (/insgesamt|gesamt/i.test(label) || totals.vat == null) totals.vat = value;
    } else if (SUMMARY_LABELS.gross.test(label)) totals.gross = value;
  }
}

function isSummaryLabel(text) {
  return Object.values(SUMMARY_LABELS).some((re) => re.test(text)) && !/\d,\d{2}/.test(text);
}

/**
 * Ordnet Textzeilen den Zahlenzeilen zu. Je nach Herkunft des Textes:
 *  1. Absätze (Leerzeilen) ergeben genau so viele Blöcke wie Positionen
 *  2. Zahlen stehen jeweils NACH dem Positionstext
 *  3. Zahlen stehen jeweils VOR dem Positionstext
 *  4. Zahlen stehen vertikal mittig im Positionstext (aus dem PDF-Layout)
 */
function readItems(entries, log) {
  const seq = []; // { kind: 'text', text, blankBefore } | { kind: 'row', ... }
  for (const e of entries) {
    const m = e.text.match(ROW_RE);
    if (!m) {
      seq.push({ kind: 'text', text: e.text, blankBefore: e.blankBefore });
      continue;
    }
    const prefix = normalizeSpaces(e.text.slice(0, m.index));
    if (prefix) seq.push({ kind: 'text', text: prefix, blankBefore: e.blankBefore, middle: true });
    seq.push({
      kind: 'row',
      q: splitQuantity(m[2] ? `${m[1]} ${m[2]}` : m[1]),
      unitPrice: m[3],
      vatRate: m[4],
      net: m[5],
      withPrefix: !!prefix,
    });
  }
  const rows = seq.filter((s) => s.kind === 'row');
  if (!rows.length) {
    log('Keine Positionszeilen im Text gefunden.');
    return [];
  }
  const texts = seq.filter((s) => s.kind === 'text');
  const groups = assignTexts(seq, rows.length, texts);
  return rows.map((row, i) => {
    const lines = groups[i] || [];
    return {
      title: lines[0] || '',
      description: lines.slice(1),
      quantity: row.q.number,
      unit: row.q.unit,
      unitPrice: row.unitPrice,
      vatRate: row.vatRate,
      net: row.net,
      flags: ['Positionstext aus Textmuster abgegrenzt – bitte prüfen'],
    };
  });
}

function assignTexts(seq, n, texts) {
  if (n === 1) return [texts.map((t) => t.text)];

  // 1. Absatzblöcke
  const blocks = [];
  for (const t of texts) {
    if (!blocks.length || t.blankBefore) blocks.push([]);
    blocks[blocks.length - 1].push(t.text);
  }
  if (blocks.length === n && texts.some((t) => t.blankBefore)) return blocks;

  // Textgruppen zwischen den Zahlenzeilen
  const between = [[]]; // between[k]: Texte vor Zahlenzeile k (k = n: nach der letzten)
  for (const s of seq) {
    if (s.kind === 'row') between.push([]);
    else between[between.length - 1].push(s);
  }
  const hasMiddle = seq.some((s) => s.middle);

  // 2. Zahlen nach dem Text
  if (!hasMiddle && between[n].length === 0 && between.slice(0, n).every((g) => g.length)) {
    return between.slice(0, n).map((g) => g.map((t) => t.text));
  }
  // 3. Zahlen vor dem Text
  if (!hasMiddle && between[0].length === 0 && between.slice(1).every((g) => g.length)) {
    return between.slice(1).map((g) => g.map((t) => t.text));
  }

  // 4. Zahlen mittig: symmetrische Aufteilung um die Zahlenzeile
  const anchors = [];
  let ti = 0;
  for (const s of seq) {
    if (s.kind === 'text') ti++;
    else anchors.push(s.withPrefix ? ti - 1 : ti - 0.5);
  }
  const groups = [];
  let start = 0;
  anchors.forEach((a, r) => {
    let end;
    if (r === n - 1) end = texts.length - 1;
    else {
      end = Math.round(2 * a - start);
      end = Math.min(end, Math.ceil(anchors[r + 1]) - 1);
      end = Math.max(end, Math.floor(a));
    }
    groups.push(texts.slice(start, end + 1).map((t) => t.text));
    start = end + 1;
  });
  return groups;
}
