// Firmendaten/Einstellungen, Formularzustand und das Dokumentmodell der
// Auftragsbestätigung. Alles rein funktional (keine Browser-APIs).

import { parseDecimal, formatMoney, formatQuantity, mul, rescale, sum, percentOf, formatDecimal } from './decimal.js';
import { HOME_COUNTRY, normalizeSpaces } from './patterns.js';

export const DEFAULT_CONFIG = {
  firma: {
    name: '',
    absenderZeilen: [],
    ustId: '',
    steuernummer: '',
    email: '',
    register: '',
  },
  fusszeile: [],
  ab: {
    titel: 'Auftragsbestätigung',
    nummernVorlage: 'TPC-AB-{jahr}-{nr}',
    datumsformat: 'TT/MM/JJJJ',
    einleitung: 'Gerne bestätigen wir Ihnen hiermit folgenden Lieferauftrag:',
    standardEinheit: 'Stück',
    standardMwSt: '19',
    zahlungsUeberschrift: 'Zahlungsbedingungen:',
    spalten: ['Artikel', 'Menge', 'Einheit', 'Preis pro Einheit (netto)'],
    logo: 'img/logo.png',
    dateiname: '{abNummer}.pdf',
  },
  optionen: {
    angebotsbezug: true,
    kundenUstId: true,
    summen: false,
    weitereHinweise: false,
    inlandLandWeglassen: true,
  },
};

export function normalizeConfig(raw = {}) {
  const merged = structuredClone(DEFAULT_CONFIG);
  for (const section of Object.keys(merged)) {
    const value = raw[section];
    if (value == null) continue;
    if (Array.isArray(merged[section])) merged[section] = Array.isArray(value) ? value.map(String) : [];
    else if (typeof value === 'object') Object.assign(merged[section], value);
  }
  return merged;
}

/** Optionen für die Erkennung (eigene Firmendaten → Absenderzeile/Fußzeile ignorieren) */
export function parserOptions(config) {
  return {
    ownCompanyName: config.firma.name || undefined,
    ownVatId: config.firma.ustId || undefined,
    ownTaxNumber: config.firma.steuernummer || undefined,
    ownEmail: config.firma.email || undefined,
    ownRegister: config.firma.register || undefined,
    ownAddressLines: config.firma.absenderZeilen.filter((l) => !/^HRB/i.test(l)),
  };
}

// ── Datum ──────────────────────────────────────────────────────────────────

/** "09.10.2026" → "2026-10-09" */
export function germanToIso(date) {
  const m = String(date || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

export function isoToGerman(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function isValidIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Formatiert ein ISO-Datum nach Vorlage, z. B. "TT/MM/JJJJ" → "30/09/2026" */
export function formatDate(iso, pattern = 'TT/MM/JJJJ') {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return pattern.replace('JJJJ', m[1]).replace('MM', m[2]).replace('TT', m[3]);
}

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ── Nummern ────────────────────────────────────────────────────────────────

/**
 * Leitet die AB-Nummer deterministisch aus der Angebotsnummer ab.
 * "A-2026-0346" + "TPC-AB-{jahr}-{nr}" → "TPC-AB-2026-0346"
 */
export function deriveAbNumber(offerNumber, template = DEFAULT_CONFIG.ab.nummernVorlage) {
  const m = String(offerNumber || '').match(/^([A-Z]{1,5})-(\d{4})-(\d{2,6})$/);
  if (!m) return '';
  return template
    .replace('{präfix}', m[1])
    .replace('{praefix}', m[1])
    .replace('{jahr}', m[2])
    .replace('{nr}', m[3])
    .replace('{angebotsnummer}', offerNumber);
}

export function fileNameFor(form, config) {
  const name = (config.ab.dateiname || '{abNummer}.pdf')
    .replace('{abNummer}', form.abNumber || 'Auftragsbestaetigung')
    .replace('{kunde}', form.customerName || '')
    .replace('{angebotsnummer}', form.offerNumber || '');
  const safe = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

// ── Formularzustand ────────────────────────────────────────────────────────

export function emptyItem(config) {
  return {
    title: '',
    description: '',
    quantity: '',
    unit: config.ab.standardEinheit,
    unitPrice: '',
    vatRate: '',
    net: '',
  };
}

/** Erkennungsergebnis → bearbeitbarer Formularzustand */
export function draftToForm(draft, config, today = todayIso()) {
  const f = draft?.fields || {};
  const val = (k) => f[k]?.value ?? '';
  const list = (k) => (Array.isArray(f[k]?.value) ? f[k].value.join('\n') : '');
  const offerNumber = val('offerNumber');
  return {
    abNumber: deriveAbNumber(offerNumber, config.ab.nummernVorlage),
    abDate: today,
    offerNumber,
    offerDate: val('offerDate'),
    customerName: val('customerName'),
    customerAddress: list('customerAddress'),
    customerVatId: val('customerVatId'),
    notes: list('notes'),
    paymentTerms: list('paymentTerms'),
    closingNotes: list('closingNotes'),
    items: (draft?.items?.value || []).map((it) => ({
      title: it.title || '',
      description: (it.description || []).join('\n'),
      quantity: it.quantity || '',
      unit: it.unit || config.ab.standardEinheit,
      unitPrice: it.unitPrice || '',
      vatRate: it.vatRate || '',
      net: it.net || '',
    })),
    options: { ...config.optionen },
  };
}

export function emptyForm(config, today = todayIso()) {
  return { ...draftToForm(null, config, today), items: [emptyItem(config)] };
}

const lines = (s) =>
  String(s || '')
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(Boolean);

/** Pflichtfelder und Zahlenformate prüfen. Fehler blockieren die Ausgabe, Hinweise nicht. */
export function validateForm(form) {
  const errors = {};
  const warnings = {};
  if (!normalizeSpaces(form.abNumber)) errors.abNumber = 'AB-Nummer fehlt';
  if (!isValidIso(form.abDate)) errors.abDate = 'Datum fehlt oder ist ungültig';
  if (!normalizeSpaces(form.customerName)) errors.customerName = 'Kundenname fehlt';
  if (!lines(form.customerAddress).length) warnings.customerAddress = 'Keine Anschrift angegeben';
  if (!lines(form.paymentTerms).length) warnings.paymentTerms = 'Keine Zahlungsbedingungen angegeben';
  if (form.offerDate && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(form.offerDate))
    warnings.offerDate = 'Format TT.MM.JJJJ erwartet';
  if (!form.items.length) errors.items = 'Mindestens eine Position erforderlich';
  form.items.forEach((it, i) => {
    if (!normalizeSpaces(it.title)) errors[`items.${i}.title`] = 'Bezeichnung fehlt';
    if (!parseDecimal(it.quantity)) errors[`items.${i}.quantity`] = 'Menge fehlt/ungültig';
    if (!parseDecimal(it.unitPrice)) errors[`items.${i}.unitPrice`] = 'Preis fehlt/ungültig';
    if (it.vatRate && !parseDecimal(it.vatRate)) warnings[`items.${i}.vatRate`] = 'MwSt.-Satz ungültig';
  });
  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

/** Formularzustand → fertig formatiertes Dokumentmodell für den PDF-Renderer */
export function formToDocument(form, config) {
  const ab = config.ab;
  const opt = form.options || config.optionen;
  const fmtDate = (iso) => formatDate(iso, ab.datumsformat);

  const meta = [
    { label: 'Auftragsbestätigungsnummer', value: normalizeSpaces(form.abNumber) },
    { label: 'Ausstellungsdatum', value: fmtDate(form.abDate) },
  ];
  if (opt.angebotsbezug && normalizeSpaces(form.offerNumber)) {
    const date = germanToIso(form.offerDate);
    meta.push({
      label: 'Angebotsnummer',
      value: normalizeSpaces(form.offerNumber) + (date ? ` vom ${fmtDate(date)}` : ''),
    });
  }

  let addr = lines(form.customerAddress);
  if (opt.inlandLandWeglassen && addr.length && HOME_COUNTRY.test(addr[addr.length - 1])) addr = addr.slice(0, -1);
  if (opt.kundenUstId && normalizeSpaces(form.customerVatId))
    addr.push(`USt-IdNr.: ${normalizeSpaces(form.customerVatId)}`);

  const items = form.items.map((it) => {
    const q = parseDecimal(it.quantity);
    const p = parseDecimal(it.unitPrice);
    return {
      title: normalizeSpaces(it.title),
      description: lines(it.description),
      quantity: q ? formatQuantity(q) : normalizeSpaces(it.quantity),
      unit: normalizeSpaces(it.unit) || ab.standardEinheit,
      unitPrice: p ? formatMoney(p) : normalizeSpaces(it.unitPrice),
    };
  });

  return {
    title: ab.titel,
    meta,
    sender: { name: config.firma.name, lines: config.firma.absenderZeilen },
    recipient: { name: normalizeSpaces(form.customerName), lines: addr },
    intro: ab.einleitung,
    notes: lines(form.notes),
    columns: ab.spalten,
    items,
    totals: opt.summen ? computeTotals(form.items, ab.standardMwSt) : null,
    payment: { heading: ab.zahlungsUeberschrift, lines: lines(form.paymentTerms) },
    closingNotes: opt.weitereHinweise ? lines(form.closingNotes) : [],
    footer: config.fusszeile,
    pdf: {
      title: `${ab.titel} ${normalizeSpaces(form.abNumber)}`.trim(),
      author: config.firma.name,
      subject: normalizeSpaces(form.offerNumber) ? `Zu Angebot ${normalizeSpaces(form.offerNumber)}` : '',
      date: form.abDate,
    },
  };
}

/** Netto, MwSt. je Satz und Gesamtbetrag aus den Positionen */
export function computeTotals(items, defaultRate = '19') {
  const byRate = new Map();
  const nets = [];
  for (const it of items) {
    const q = parseDecimal(it.quantity);
    const p = parseDecimal(it.unitPrice);
    if (!q || !p) continue;
    const net = rescale(mul(q, p), 2);
    nets.push(net);
    const rateStr = normalizeSpaces(it.vatRate) || defaultRate;
    const entry = byRate.get(rateStr) || { rate: parseDecimal(rateStr), nets: [] };
    entry.nets.push(net);
    byRate.set(rateStr, entry);
  }
  const net = sum(nets);
  const rows = [{ label: 'Nettobetrag', value: formatMoney(rescale(net, 2)) }];
  const vats = [];
  const sorted = [...byRate.keys()].sort().map((k) => byRate.get(k));
  for (const { rate, nets: ns } of sorted) {
    if (!rate) continue;
    const v = rescale(percentOf(sum(ns), rate), 2);
    vats.push(v);
    rows.push({ label: `zzgl. MwSt. ${formatDecimal(rate)} %`, value: formatMoney(v) });
  }
  rows.push({ label: 'Gesamtbetrag', value: formatMoney(rescale(sum([net, ...vats]), 2)), bold: true });
  return rows;
}
