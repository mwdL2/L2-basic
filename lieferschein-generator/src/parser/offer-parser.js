// Liest ein Lab2-Angebot (PDF, Layout wie A-2026-0346) und liefert ein
// neutrales Angebots-Objekt. Das Ergebnisformat entspricht dem Parser des
// AB-Generators (fields / items / totals), damit beide Tools später einen
// gemeinsamen Parser nutzen können.
//
// Mehrstufig, jede Stufe füllt nur Felder, die noch fehlen:
//   1. "layout"   – Auswertung über Positionen (Label → Wert rechts daneben,
//                   Tabellenspalten über die Kopfzeile)
//   2. "text"     – reguläre Ausdrücke über den reinen Text
//   3. "filename" – Angebotsnummer aus dem Dateinamen
// Was danach noch fehlt, wird in der Oberfläche als "bitte ergänzen" markiert.
// Alle Schritte sind deterministisch (gleiche Eingabe → gleiches Ergebnis).

import { COMPANY } from '../config/company.js';
import { buildLines } from './pdf-text.js';
import { germanDateToIso, normalizeSpaces, splitQuantity } from './format.js';

const LABELS = {
  offerNumber: /^Angebots?[-\s]?(?:nummer|nr\.?)\s*:?\s*/i,
  offerDate: /^(?:Ausstellungsdatum|Angebotsdatum|Datum)\s*:?\s*/i,
  customerVatId: /^Kunden[-\s]?USt\.?[-\s]?ID[-\s]?Nr\.?\s*:?\s*/i,
  customerNumber: /^Kunden[-\s]?(?:nummer|nr\.?)\s*:?\s*/i,
  validUntil: /^(?:Gültig bis|Gültigkeit)\s*:?\s*/i,
};

const VALID = {
  offerNumber: (v) => /^[A-Z]{1,5}-\d{4}-\d{2,6}$/.test(v),
  offerDate: (v) => germanDateToIso(v) != null,
  customerVatId: (v) => /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(v),
  customerNumber: (v) => v.length > 0 && v.length <= 30,
  validUntil: (v) => germanDateToIso(v) != null,
};

const HEADER_COLUMNS = [
  ['article', /^(?:Artikel|Bezeichnung|Beschreibung|Leistung|Produkt)$/i],
  ['quantity', /^(?:Menge|Anzahl|Stückzahl|Stk\.?)$/i],
  ['unit', /^(?:Einheit|ME)$/i],
  ['unitPrice', /^(?:Einzelpreis|Stückpreis|E-Preis|Preis)/i],
  ['vatRate', /^(?:MwSt|USt)/i],
  ['net', /^(?:Nettobetrag|Gesamtpreis|Gesamt|Betrag|Summe|Netto)/i],
];

export const TOTAL_LABEL = /^(?:Nettobetrag|Zwischensumme|Summe|MwSt|USt|Gesamt|Endbetrag|Brutto|Rabatt|Nachlass)/i;
export const INTRO_LINE = /^(?:Gerne|Sehr geehrte|Vielen Dank|Hiermit|Wir bieten|Wie besprochen|Exkl\.|Inkl\.|Zzgl\.)/i;
export const PAGE_NUMBER = /^Seite\s+\d+\s*(?:\/|von)\s*\d+$/i;
const MONEY = /-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,4}/;

export function emptyOffer() {
  return {
    fields: {
      offerNumber: null,
      offerDate: null,
      customerVatId: null,
      customerNumber: null,
      customerName: null,
      customerAddress: [],
      validUntil: null,
    },
    sources: {},
    items: [],
    totals: { net: null, vat: null, gross: null },
    introLines: [],
    closingLines: [],
    meta: { isOffer: false, title: null, pages: 0, hasText: false, tableFound: false },
    warnings: [],
    log: [],
  };
}

/**
 * @param {Array} pages   Ergebnis von readPdfPages()
 * @param {{fileName?: string}} [opts]
 */
export function parseOfferPages(pages, opts = {}) {
  const res = emptyOffer();
  res.meta.pages = pages.length;
  const pageLines = pages.map((p) => buildLines(p.items));
  res.meta.hasText = pageLines.some((l) => l.length > 0);
  if (!res.meta.hasText) {
    res.warnings.push('Im PDF wurde kein Text gefunden (gescanntes Dokument?). Bitte die Felder von Hand ausfüllen.');
    applyFilenameFallback(res, opts.fileName);
    return res;
  }

  try {
    parseLayout(res, pages, pageLines);
  } catch (err) {
    res.log.push(`Layout-Auswertung abgebrochen: ${err.message}`);
  }
  try {
    applyTextFallback(res, pageLines.flat().map((l) => l.text));
  } catch (err) {
    res.log.push(`Text-Auswertung abgebrochen: ${err.message}`);
  }
  applyFilenameFallback(res, opts.fileName);

  if (!res.meta.isOffer) {
    res.warnings.push('Das Dokument trägt nicht den Titel „Angebot“. Bitte prüfen, ob die richtige Datei gewählt wurde.');
  }
  return res;
}

// ═════════════════════════════════════════════════ Stufe 1: Layout ══════

function parseLayout(res, pages, pageLines) {
  const first = pageLines[0] || [];
  const firstPage = pages[0];

  // Titel = größte Schrift im oberen Seitenviertel
  const top = first.filter((l) => l.y < firstPage.height * 0.25);
  const title = top.reduce((best, l) => (!best || l.size > best.size ? l : best), null);
  if (title) {
    res.meta.title = title.text;
    res.meta.isOffer = /^Angebot\b/i.test(title.text);
  }

  // Label/Wert-Paare (Kopfdaten)
  const labelCells = [];
  for (const line of first) {
    for (const cell of line.cells) {
      for (const [key, re] of Object.entries(LABELS)) {
        const m = cell.text.match(re);
        if (!m) continue;
        if (key === 'offerDate' && /^Datum/i.test(cell.text) && labelCells.some((l) => l.key === 'offerDate')) continue;
        labelCells.push({ key, cell, line, rest: cell.text.slice(m[0].length).trim() });
        break;
      }
    }
  }
  for (const { key, cell, line, rest } of labelCells) {
    if (res.fields[key]) continue;
    let value = rest;
    if (!value) {
      const right = line.cells.filter((c) => c.x0 > cell.x1 - 0.5 && c.x0 - cell.x1 < 220);
      value = right.length ? right[0].text : '';
    }
    value = normalizeSpaces(value);
    if (key === 'customerVatId') value = value.replace(/\s/g, '').toUpperCase();
    if (value && VALID[key](value)) set(res, key, value, 'layout');
  }

  // Tabelle (Kopfzeile kann auf jeder Seite stehen)
  const header = findHeader(pageLines);
  res.meta.tableFound = !!header;

  // Absenderzeile und Empfängeradresse (Seite 1, links)
  const sender = findSenderLine(first, firstPage);
  const metaX = labelCells.length ? Math.min(...labelCells.map((l) => l.cell.x0)) : firstPage.width / 2;
  const stopY = header && header.page === 0 ? header.line.y : firstPage.height * 0.6;
  const startY = sender ? sender.y : title ? title.y : 0;
  const leftCells = [];
  for (const line of first) {
    if (line.y <= startY + 0.5 || line.y >= stopY) continue;
    for (const c of line.cells) {
      if (c.x0 < metaX - 10 && !isOwnCompany(c.text)) leftCells.push(c);
    }
  }
  leftCells.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const block = [];
  for (const c of leftCells) {
    if (INTRO_LINE.test(c.text)) break;
    const prev = block[block.length - 1];
    if (prev) {
      const maxGap = Math.max(2.4 * Math.max(prev.size, c.size), 14);
      if (c.y - prev.y > maxGap || Math.abs(c.x0 - block[0].x0) > 3) break;
    }
    block.push(c);
  }
  if (block.length) {
    set(res, 'customerName', block[0].text, 'layout');
    set(res, 'customerAddress', block.slice(1).map((c) => c.text), 'layout');
    const lastY = block[block.length - 1].y;
    res.introLines = leftCells.filter((c) => c.y > lastY + 0.5).map((c) => c.text);
  } else {
    res.log.push('Empfängeradresse über das Layout nicht gefunden.');
  }

  if (header) readTable(res, pages, pageLines, header);
  else res.log.push('Tabellenkopf (Artikel / Menge) nicht gefunden.');
}

export function set(res, key, value, source) {
  res.fields[key] = value;
  res.sources[key] = source;
}

function isOwnCompany(text) {
  const t = normalizeSpaces(text);
  return t.startsWith(COMPANY.name) || t.includes(COMPANY.vatId) || t.includes(COMPANY.register);
}

function findSenderLine(lines, page) {
  return (
    lines.find(
      (l) => l.y < page.height * 0.45 && l.cells.some((c) => c.text.startsWith(COMPANY.name) && /[·•|,]/.test(c.text)),
    ) || null
  );
}

function findHeader(pageLines) {
  for (let p = 0; p < pageLines.length; p++) {
    for (const line of pageLines[p]) {
      const cols = matchHeader(line);
      if (cols) return { page: p, line, cols };
    }
  }
  return null;
}

function matchHeader(line) {
  const cols = {};
  for (const cell of line.cells) {
    for (const [key, re] of HEADER_COLUMNS) {
      if (!cols[key] && re.test(cell.text)) {
        cols[key] = { x0: cell.x0, x1: cell.x1 };
        break;
      }
    }
  }
  return cols.article && cols.quantity && cols.quantity.x0 > cols.article.x0 ? cols : null;
}

/** Spaltengrenzen: Mitte zwischen benachbarten Kopfzellen */
function columnRanges(cols) {
  const list = Object.entries(cols)
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => a.x0 - b.x0);
  return list.map((c, i) => ({
    key: c.key,
    from: i === 0 ? -Infinity : (list[i - 1].x1 + c.x0) / 2,
    to: i === list.length - 1 ? Infinity : (c.x1 + list[i + 1].x0) / 2,
  }));
}

function footerTop(lines, page) {
  const pn = lines.find((l) => l.cells.some((c) => PAGE_NUMBER.test(c.text)));
  if (pn) return pn.y - pn.size;
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 0;
  const small = lines.filter((l) => l.y > page.height * 0.8 && l.size < body * 0.85);
  return small.length ? Math.min(...small.map((l) => l.y)) - 1 : page.height;
}

function readTable(res, pages, pageLines, header) {
  const ranges = columnRanges(header.cols);
  const articleX = header.cols.article.x0;
  const qtyX = header.cols.quantity.x0;
  const articleCells = [];
  const otherCells = [];
  let ended = false;
  let yOffset = 0;

  for (let p = header.page; p < pageLines.length && !ended; p++) {
    const lines = pageLines[p];
    const page = pages[p];
    const pageHeader = p === header.page ? header : lines.map((l) => ({ line: l, cols: matchHeader(l) })).find((h) => h.cols);
    const startY = pageHeader ? pageHeader.line.y : 0;
    const endY = footerTop(lines, page);
    for (const line of lines) {
      if (line.y <= startY + 0.5 || line.y >= endY) continue;
      // Ende der Tabelle: Summenzeile oder wieder linksbündiger Fließtext
      const totalCell = line.cells.find((c) => c.x0 >= qtyX - 12 && TOTAL_LABEL.test(c.text));
      if (totalCell && !line.cells.some((c) => c.x0 < qtyX - 4)) {
        readTotals(res, lines.filter((l) => l.y >= line.y && l.y < endY), qtyX);
        res.closingLines = lines.filter((l) => l.y > line.y && l.y < endY && l.x0 < articleX - 3).map((l) => l.text);
        ended = true;
        break;
      }
      if (line.x0 < articleX - 4) {
        res.closingLines = lines.filter((l) => l.y >= line.y && l.y < endY).map((l) => l.text);
        ended = true;
        break;
      }
      for (const c of line.cells) {
        const cell = { ...c, y: c.y + yOffset, page: p };
        if (c.x0 < qtyX - 4) articleCells.push(cell);
        else {
          const center = (c.x0 + c.x1) / 2;
          const col = ranges.find((r) => center >= r.from && center < r.to);
          if (col && col.key !== 'article') otherCells.push({ ...cell, col: col.key });
        }
      }
    }
    yOffset += page.height;
  }

  const qtyCells = otherCells.filter((c) => c.col === 'quantity').sort((a, b) => a.y - b.y);
  const groups = groupPositions(articleCells.sort((a, b) => a.y - b.y || a.x0 - b.x0), qtyCells, res);

  res.items = groups.map(({ lines, qty, flags }) => {
    const rowCells = qty ? otherCells.filter((c) => Math.abs(c.y - qty.y) < Math.max(2, qty.size * 0.4)) : [];
    const pick = (key) => rowCells.find((c) => c.col === key)?.text ?? null;
    const q = splitQuantity(qty ? qty.text : '');
    const unit = pick('unit') || q.unit;
    const item = {
      title: lines[0] ? lines[0].text : '',
      description: lines.slice(1).map((l) => l.text),
      quantity: q.number,
      quantityText: q.raw,
      unit,
      unitPrice: pick('unitPrice'),
      vatRate: pick('vatRate'),
      net: pick('net'),
      flags: [...flags],
    };
    if (item.quantity == null) item.flags.push('Menge nicht erkannt');
    if (!item.title) item.flags.push('Artikelbezeichnung nicht erkannt');
    return item;
  });
  if (res.items.length) res.sources.items = 'layout';
}

/**
 * Artikelzeilen zu Positionen bündeln. Jede Position hat genau eine Menge;
 * bei n Mengen werden die Zeilen an den n−1 größten vertikalen Abständen
 * getrennt (Zeilen innerhalb einer Position stehen enger als zwischen zwei
 * Positionen).
 */
function groupPositions(lines, qtys, res) {
  if (!lines.length && !qtys.length) return [];
  const steps = [];
  for (let i = 1; i < lines.length; i++) steps.push(lines[i].y - lines[i - 1].y);
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const typical = sortedSteps.length ? sortedSteps[Math.floor((sortedSteps.length - 1) / 4)] : 0;

  if (!qtys.length) {
    // Keine Mengen gefunden: nur nach großen Abständen trennen
    const groups = [];
    lines.forEach((l, i) => {
      if (i === 0 || steps[i - 1] > Math.max(typical * 1.8, l.size * 2.6)) groups.push({ lines: [], qty: null, flags: [] });
      groups[groups.length - 1].lines.push(l);
    });
    res.log.push('Keine Mengen in der Tabelle gefunden.');
    return groups;
  }

  const n = qtys.length;
  if (lines.length >= n) {
    const cut = steps
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, n - 1)
      .map((x) => x.i + 1)
      .sort((a, b) => a - b);
    const bigEnough = cut.every((i) => steps[i - 1] > typical * 1.3 || n === 1);
    const groups = [];
    let from = 0;
    for (const to of [...cut, lines.length]) {
      groups.push({ lines: lines.slice(from, to), qty: null, flags: [] });
      from = to;
    }
    groups.forEach((g, i) => {
      g.qty = qtys[i];
      const y0 = g.lines[0].y;
      const y1 = g.lines[g.lines.length - 1].y;
      const margin = Math.max(typical, g.qty.size) * 2;
      if (!bigEnough || g.qty.y < y0 - margin || g.qty.y > y1 + margin) {
        g.flags.push('Zuordnung von Text und Menge bitte prüfen');
      }
    });
    if (groups.every((g) => !g.flags.length)) return groups;
    // Plausibilitätsprüfung fehlgeschlagen → Zuordnung über die Nähe zur Menge
    res.log.push('Positionen über die Nähe zur Menge zugeordnet.');
  }

  const groups = qtys.map((q) => ({ lines: [], qty: q, flags: ['Zuordnung von Text und Menge bitte prüfen'] }));
  for (const l of lines) {
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(qtys[i].y - l.y) < Math.abs(qtys[best].y - l.y)) best = i;
    groups[best].lines.push(l);
  }
  return groups;
}

function readTotals(res, lines, qtyX) {
  for (const line of lines) {
    const label = line.cells.find((c) => c.x0 >= qtyX - 12 && TOTAL_LABEL.test(c.text));
    if (!label) continue;
    const value = line.cells.filter((c) => c.x0 > label.x1 && MONEY.test(c.text)).pop();
    if (!value) continue;
    if (/^(?:Nettobetrag|Zwischensumme|Summe)/i.test(label.text)) res.totals.net ??= value.text;
    else if (/^(?:MwSt|USt)/i.test(label.text)) res.totals.vat ??= value.text;
    else if (/^(?:Gesamt|Endbetrag|Brutto)/i.test(label.text)) res.totals.gross ??= value.text;
  }
}

// ═══════════════════════════════════════════ Stufe 2: reiner Text ══════

/** @param {string[]} lines  Textzeilen (Zellen durch mindestens zwei Leerzeichen getrennt) */
export function applyTextFallback(res, lines) {
  const full = lines.join('\n');
  const f = res.fields;

  if (!f.offerNumber) {
    const m =
      full.match(/Angebots?[-\s]?(?:nummer|nr\.?)\s*:?\s*([A-Z]{1,5}-\d{4}-\d{2,6})/i) ||
      full.match(/\b(A-\d{4}-\d{3,6})\b/);
    if (m) set(res, 'offerNumber', m[1], 'text');
  }
  if (!f.offerDate) {
    const m = full.match(/(?:Ausstellungsdatum|Angebotsdatum)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (m && germanDateToIso(m[1])) set(res, 'offerDate', m[1], 'text');
    else {
      // Label und Wert getrennt kopiert: erstes Datum vor der Tabelle, nicht aus der Gültigkeitszeile
      const head = lines.slice(0, Math.max(0, lines.findIndex((l) => /\bArtikel\b/i.test(l))) || lines.length);
      const d = head.filter((l) => !/gilt|gültig/i.test(l)).map((l) => l.match(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/)?.[1]).find((v) => v && germanDateToIso(v));
      if (d) set(res, 'offerDate', d, 'text');
    }
  }
  if (!f.customerVatId) {
    const m = full.match(/Kunden[-\s]?USt\.?[-\s]?ID[-\s]?Nr\.?\s*:?\s*([A-Z]{2}\s?[0-9A-Z+*]{2,12})/i);
    if (m) {
      const v = m[1].replace(/\s/g, '').toUpperCase();
      if (VALID.customerVatId(v) && v !== COMPANY.vatId) set(res, 'customerVatId', v, 'text');
    }
  }
  if (!f.customerName) {
    // Zeile direkt nach der Absenderzeile "Lab2. GmbH · …"
    const idx = lines.findIndex((l) => l.startsWith(COMPANY.name) && /[·•|]/.test(l));
    const name = idx >= 0 ? lines[idx + 1] : null;
    if (name) {
      const clean = stripMeta(name.split('  ')[0]);
      if (clean && !Object.values(LABELS).some((re) => re.test(clean))) {
        set(res, 'customerName', clean, 'text');
        const addr = [];
        for (let i = idx + 2; i < lines.length && addr.length < 5; i++) {
          const l = stripMeta(lines[i].split('  ')[0]);
          if (!l || INTRO_LINE.test(l) || /^Artikel\b/i.test(l)) break;
          // Kopfdaten (Label oder reiner Wert), die zwischen den Adresszeilen stehen, überspringen
          if (Object.values(LABELS).some((re) => re.test(l)) || isMetaValue(l)) continue;
          addr.push(l);
        }
        if (!f.customerAddress.length && addr.length) set(res, 'customerAddress', addr, 'text');
      }
    }
  }
}

function isMetaValue(l) {
  const v = l.replace(/\s/g, '');
  return VALID.offerNumber(v) || germanDateToIso(v) != null || (/^[A-Z]{2}\d{8,12}$/.test(v));
}

/** Kopfdaten, die beim Kopieren in dieselbe Zeile wie die Adresse gerutscht sind, abschneiden */
function stripMeta(line) {
  return normalizeSpaces(
    String(line).replace(/\s+(?:Kunden[-\s]?USt|Kunden[-\s]?(?:nummer|nr)|Angebots?[-\s]?(?:nummer|nr)|Ausstellungsdatum|Angebotsdatum)\b.*$/i, ''),
  );
}

// ═══════════════════════════════════════════ Stufe 3: Dateiname ═══════

export function applyFilenameFallback(res, fileName) {
  if (!fileName || res.fields.offerNumber) return;
  const m = String(fileName).match(/([A-Z]{1,5}-\d{4}-\d{2,6})/);
  if (m) set(res, 'offerNumber', m[1], 'filename');
}
