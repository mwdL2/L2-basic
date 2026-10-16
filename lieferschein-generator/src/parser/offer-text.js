// Ausweichweg: Angebot als eingefügter Text (aus dem PDF-Viewer kopiert).
// Ohne Positionsangaben sind nur Textmuster möglich – Positionen werden daher
// immer mit "bitte prüfen" markiert. Ergebnisformat wie parseOfferPages().
//
// Zwei Kopierformen kommen vor:
//  a) zeilenweise ("Inkl. Mixerball   15000   1,19 €   19 %   17.850,00 €")
//  b) spaltenweise (erst alle Zahlen, danach die Texte als Absätze)

import { applyTextFallback, emptyOffer, PAGE_NUMBER, TOTAL_LABEL } from './offer-parser.js';
import { normalizeSpaces, splitQuantity } from './format.js';

const NUM = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`;
const MONEY = String.raw`-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,4}`;
// Menge [Einheit] Einzelpreis € MwSt % Nettobetrag €   (am Zeilenende)
const ROW_RE = new RegExp(
  String.raw`(?:^|\s)(${NUM})(?:\s+([A-Za-zÄÖÜäöüß.]{1,12}))?\s+(${MONEY})\s*€\s+(\d{1,2}(?:,\d{1,2})?)\s*%\s+(${MONEY})\s*€$`,
);
// Menge allein in einer Zeile (wenn Preise fehlen)
const QTY_ONLY = new RegExp(String.raw`^(${NUM})(?:\s+([A-Za-zÄÖÜäöüß.]{1,12}))?$`);
const FRAGMENT = /^(?!\d{1,2}\.\d{1,2}\.\d{4}$)(?:-?[\d.]+(?:,\d+)?\s*(?:€|%)?|€|%)$/;
const MONEY_LINE = new RegExp(String.raw`^${MONEY}\s*€?$`);
const HEADER_CELL = /^(?:Artikel|Menge|Einheit|Einzelpreis|MwSt\.?\s*\(%\)|Nettobetrag)$/i;
const CLOSING = /^(?:Dieses Angebot|Zahlungsbedingungen|Es gelten)/i;

export function parseOfferText(input) {
  const res = emptyOffer();
  res.meta.origin = 'text';

  // Leerzeilen bleiben als null erhalten (trennen Absätze = Positionen)
  const raw = String(input ?? '')
    .split(/\r?\n/)
    .map((l) => normalizeSpaces(l.replace(/\t/g, '  ')))
    .filter((l) => !PAGE_NUMBER.test(l))
    .map((l) => l || null);

  // Zahlen, die beim Kopieren auf eigene Zeilen gerutscht sind, wieder anhängen
  const joined = [];
  for (const l of raw) {
    if (l == null) {
      if (joined.length && joined[joined.length - 1] != null) joined.push(null);
      continue;
    }
    let p = joined.length - 1;
    if (p >= 0 && joined[p] == null) p--;
    const prev = p >= 0 ? joined[p] : null;
    if (prev != null && FRAGMENT.test(l) && /(?:\d|€|%)$/.test(prev) && !ROW_RE.test(prev)) {
      joined.length = p + 1;
      joined[p] = `${prev} ${l}`;
    } else joined.push(l);
  }
  const lines = joined.filter((l) => l != null);
  res.meta.hasText = lines.length > 0;
  if (!lines.length) return res;

  res.meta.isOffer = lines.some((l) => /^Angebot$/i.test(l));
  res.meta.title = res.meta.isOffer ? 'Angebot' : null;
  applyTextFallback(res, lines);

  // Tabellenkopf (eine Zeile oder Kopfzellen untereinander)
  let start = joined.findIndex((l) => l != null && /\bArtikel\b/i.test(l) && /\bMenge\b/i.test(l));
  if (start < 0) {
    start = joined.findIndex((l) => l != null && /^Artikel$/i.test(l));
    if (start >= 0) {
      for (let i = start + 1; i < joined.length; i++) {
        if (joined[i] == null) continue;
        if (!HEADER_CELL.test(joined[i])) break;
        start = i;
      }
    }
  }
  if (start < 0) {
    res.log.push('Tabellenkopf im Text nicht gefunden.');
    return res;
  }
  res.meta.tableFound = true;

  // Tabellenende: Summenzeile (Wert in derselben oder der nächsten Zeile) oder Schlusstext
  const nextText = (i) => joined.slice(i + 1).find((l) => l != null) || '';
  let end = joined.findIndex(
    (l, i) => i > start && l != null && TOTAL_LABEL.test(l) && (/\d,\d{2}\s*€?$/.test(l) || MONEY_LINE.test(nextText(i))),
  );
  if (end < 0) end = joined.findIndex((l, i) => i > start && l != null && CLOSING.test(l));
  if (end < 0) end = joined.length;

  // Textzeilen (mit Absatznummer) und Zahlenzeilen trennen
  const text = [];
  const rows = [];
  let para = 0;
  const segment = joined.slice(start + 1, end);
  // Mengen ohne Preise nur akzeptieren, wenn keine vollständige Preiszeile vorkommt
  // (sonst würden Beschreibungen wie "700 ml" als Menge gelesen)
  const rowRe = segment.some((l) => l != null && ROW_RE.test(l)) ? ROW_RE : QTY_ONLY;
  for (const l of segment) {
    if (l == null) {
      para++;
      continue;
    }
    const m = l.match(rowRe);
    if (m) {
      const prefix = normalizeSpaces(l.slice(0, m.index));
      if (prefix) text.push({ text: prefix, para });
      rows.push({
        anchor: prefix ? text.length - 1 : text.length - 0.5,
        q: splitQuantity(m[2] ? `${m[1]} ${m[2]}` : m[1]),
        unitPrice: m[3] ? `${m[3]} €` : null,
        vatRate: m[4] ? `${m[4]} %` : null,
        net: m[5] ? `${m[5]} €` : null,
      });
    } else text.push({ text: l, para });
  }

  const item = (lines, row, flag) => ({
    title: lines[0] || '',
    description: lines.slice(1),
    quantity: row ? row.q.number : null,
    quantityText: row ? row.q.raw : '',
    unit: row ? row.q.unit : '',
    unitPrice: row?.unitPrice ?? null,
    vatRate: row?.vatRate ?? null,
    net: row?.net ?? null,
    flags: [flag],
  });

  if (!rows.length) {
    res.log.push('Keine Mengen im Text gefunden.');
    if (text.length) res.items = [item(text.map((t) => t.text), null, 'Aus eingefügtem Text – Menge fehlt, bitte prüfen')];
  } else if (rows.every((r) => r.anchor < 0)) {
    // b) spaltenweise kopiert: Absätze der Reihe nach den Mengen zuordnen
    const paras = [];
    for (const t of text) {
      if (!paras.length || paras[paras.length - 1].para !== t.para) paras.push({ para: t.para, lines: [] });
      paras[paras.length - 1].lines.push(t.text);
    }
    if (paras.length !== rows.length) res.log.push(`${rows.length} Mengen, aber ${paras.length} Textabsätze – Zuordnung bitte prüfen.`);
    const n = Math.max(paras.length, rows.length);
    for (let i = 0; i < n; i++) res.items.push(item(paras[i]?.lines || [], rows[i], 'Aus eingefügtem Text abgegrenzt – bitte prüfen'));
  } else {
    // a) zeilenweise: Die Menge steht vertikal mittig zum Positionstext,
    //    Position r reicht von `from` bis zur Spiegelung von `from` an ihrem Anker.
    let from = 0;
    rows.forEach((row, r) => {
      let to;
      if (r === rows.length - 1) to = text.length - 1;
      else {
        to = Math.round(2 * row.anchor - from);
        to = Math.min(to, Math.ceil(rows[r + 1].anchor) - 1);
        to = Math.max(to, Math.floor(row.anchor));
      }
      res.items.push(item(text.slice(from, to + 1).map((t) => t.text), row, 'Aus eingefügtem Text abgegrenzt – bitte prüfen'));
      from = to + 1;
    });
  }
  if (res.items.length) res.sources.items = 'text';
  return res;
}
