// Strategie A: Erkennung über das Seitenlayout (Positionen der Textbausteine).
// Verlässt sich auf Beschriftungen ("Angebotsnummer", Spaltenköpfe …) als Anker
// und auf deren x/y-Positionen – nicht auf fest einprogrammierte Koordinaten.
// Dadurch bleibt die Erkennung stabil, wenn sich Längen/Zeilenanzahlen ändern.

import { buildLines } from './pdfText.js';
import { emptyResult, splitQuantity } from './result.js';
import {
  RE,
  META_LABELS,
  COLUMN_LABELS,
  SUMMARY_LABELS,
  PAYMENT_HEADING,
  VALIDITY_LINE,
  CLOSING_STOP,
  DEFAULT_IGNORED_INTROS,
  normalizeSpaces,
  normalizeVatId,
  isMoney,
  makeOwnDataMatcher,
} from './patterns.js';

const PAGE_OFFSET = 10000; // virtuelle y-Koordinate über Seitengrenzen hinweg

export function parseLayout(pages, opts = {}) {
  const res = emptyResult('layout');
  const log = (msg) => res.log.push(msg);
  const isOwn = makeOwnDataMatcher(opts);
  const ignoredIntros = opts.ignoredIntros || DEFAULT_IGNORED_INTROS;

  const pageLines = pages.map((p) => buildLines(p.items));
  const bodySize = dominantSize(pageLines) || 8;

  // ── Fußzeilen abschneiden ────────────────────────────────────────────────
  const content = pageLines.map((lines, i) => {
    const cut = footerCutoff(lines, pages[i].height, isOwn);
    return lines.filter((l) => l.y < cut).map((l) => ({ ...l, page: i, yv: i * PAGE_OFFSET + l.y }));
  });
  const all = content.flat();
  if (!all.length) {
    log('Kein auswertbarer Text im Layout gefunden.');
    return res;
  }

  // ── Titel ───────────────────────────────────────────────────────────────
  const first = content[0] || [];
  const title = first.find((l) => l.size >= 1.6 * bodySize);
  res.meta.title = title ? normalizeSpaces(title.text) : null;
  res.meta.isOffer = !!title && /angebot/i.test(title.text);

  // ── Spaltenköpfe der Tabelle ────────────────────────────────────────────
  const header = findTableHeader(all);
  if (!header) log('Tabellenkopf (Artikel/Menge/…) nicht gefunden.');
  const headerYv = header ? header.line.yv : Infinity;

  // ── Kopfdaten (rechte Spalte: Beschriftung → Wert) ──────────────────────
  const metaLabelX = [];
  for (const line of all) {
    if (line.yv >= headerYv) break;
    for (let ci = 0; ci < line.cells.length; ci++) {
      const cell = line.cells[ci];
      for (const [key, re] of Object.entries(META_LABELS)) {
        const m = cell.text.match(re);
        if (!m) continue;
        const rest = normalizeSpaces(cell.text.slice(m[0].length));
        const next = line.cells.slice(ci + 1).find((c) => c.x0 >= cell.x1 - 0.5);
        const raw = rest || (next ? next.text : '');
        if (res.fields[key] == null && raw) res.fields[key] = raw;
        metaLabelX.push(cell.x0);
        break;
      }
    }
  }
  const pageWidth = pages[0]?.width || 595;
  const metaX = metaLabelX.length ? Math.min(...metaLabelX) : pageWidth * 0.5;
  cleanMetaFields(res, log);

  // ── Empfängeradresse + Hinweise vor der Tabelle ────────────────────────
  const leftLines = [];
  for (const line of first) {
    if (line.yv >= headerYv) break;
    if (title && line.y <= title.y) continue;
    const cells = line.cells.filter((c) => c.x0 < metaX - 5);
    if (!cells.length) continue;
    const text = normalizeSpaces(cells.map((c) => c.text).join(' '));
    const isSender =
      line.size < 0.85 * bodySize ||
      (opts.ownCompanyName && text.startsWith(opts.ownCompanyName) && /[·|•]/.test(text));
    if (isSender) continue;
    leftLines.push({ y: line.y, text, size: line.size });
  }
  let i = 0;
  const address = [];
  while (i < leftLines.length) {
    const l = leftLines[i];
    if (ignoredIntros.some((re) => re.test(l.text))) break;
    if (address.length && l.y - leftLines[i - 1].y > 2.6 * bodySize) break;
    address.push(l.text);
    i++;
  }
  if (address.length) {
    res.fields.customerName = address[0];
    res.fields.customerAddress = address.slice(1);
  } else {
    log('Empfängeradresse nicht gefunden.');
  }
  for (; i < leftLines.length; i++) {
    const t = leftLines[i].text;
    if (ignoredIntros.some((re) => re.test(t))) continue;
    res.notes.push(t);
  }

  if (!header) return res;

  // ── Tabellenkörper und Summenblock ──────────────────────────────────────
  const cols = header.cols;
  const after = all.filter((l) => l.yv > headerYv && !isRepeatedHeader(l));
  let summaryStart = after.findIndex((l) => isSummaryLine(l, cols, bodySize));
  if (summaryStart < 0) {
    log('Summenblock (Nettobetrag/Gesamt) nicht gefunden.');
    summaryStart = after.findIndex(
      (l) => PAYMENT_HEADING.test(l.text) || VALIDITY_LINE.test(l.text) || CLOSING_STOP.test(l.text),
    );
    if (summaryStart < 0) summaryStart = after.length;
  }
  const body = after.slice(0, summaryStart);
  let k = summaryStart;
  while (k < after.length && isSummaryLine(after[k], cols, bodySize)) {
    readSummaryLine(after[k], res.totals);
    k++;
  }
  const closing = after.slice(k);

  // ── Positionen ──────────────────────────────────────────────────────────
  const numericCols = ['quantity', 'unitPrice', 'vat', 'net'].filter((c) => cols[c]);
  const articleBoundary = cols.article ? (cols.article.x0 + cols.quantity.x0) / 2 : cols.quantity.x0 - 3 * bodySize;

  const textLines = [];
  const rows = [];
  for (const line of body) {
    const art = line.cells.filter((c) => c.x0 < articleBoundary);
    const num = line.cells.filter((c) => c.x0 >= articleBoundary);
    if (art.length) textLines.push({ yv: line.yv, text: normalizeSpaces(art.map((c) => c.text).join(' ')) });
    if (num.length) {
      const row = { yv: line.yv };
      for (const cell of num) {
        const col = nearestColumn(cell, numericCols, cols);
        row[col] = row[col] ? `${row[col]} ${cell.text}` : cell.text;
      }
      rows.push(row);
    }
  }

  const goodRows = [];
  for (const row of rows) {
    const q = splitQuantity(row.quantity);
    const priceOk = row.unitPrice && isMoney(row.unitPrice);
    if (q && priceOk) {
      goodRows.push({ ...row, q });
    } else if (goodRows.length) {
      const prev = goodRows[goodRows.length - 1];
      prev.extra = [...(prev.extra || []), [row.quantity, row.unitPrice, row.vat, row.net].filter(Boolean).join(' ')];
      log(`Zusatzzeile bei Position ${goodRows.length}: "${prev.extra.at(-1)}"`);
    } else {
      log(`Unvollständige Zahlenzeile ignoriert: ${JSON.stringify(row)}`);
    }
  }

  const groups = segmentItems(textLines, goodRows, bodySize);
  goodRows.forEach((row, idx) => {
    const g = groups[idx];
    const lines = g.lines.map((l) => l.text);
    const item = {
      title: lines[0] || '',
      description: lines.slice(1),
      quantity: row.q.number,
      unit: row.q.unit,
      unitPrice: stripCurrency(row.unitPrice),
      vatRate: row.vat ? row.vat.replace(/\s*%$/, '').trim() : null,
      net: row.net && isMoney(row.net) ? stripCurrency(row.net) : null,
      flags: [],
    };
    if (!item.title) item.flags.push('Kein Positionstext gefunden');
    if (g.uncertain) item.flags.push('Abgrenzung zur Nachbarposition unsicher');
    if (row.extra) item.flags.push(`Zusatzangabe im Angebot: ${row.extra.join('; ')}`);
    res.items.push(item);
  });
  if (!goodRows.length) log('Keine Positionszeilen (Menge/Einzelpreis) gefunden.');

  // ── Abschluss: Gültigkeit, Zahlungsbedingungen, weitere Hinweise ────────
  readClosing(closing, res, bodySize);
  return res;
}

// ════════════════════════════════════════════════════════════════════════

function dominantSize(pageLines) {
  const weight = new Map();
  for (const lines of pageLines)
    for (const l of lines)
      for (const c of l.cells) {
        const key = Math.round(c.size * 4) / 4;
        weight.set(key, (weight.get(key) || 0) + c.text.length);
      }
  let best = 0;
  let bestW = -1;
  for (const [size, w] of weight) if (w > bestW || (w === bestW && size < best)) [best, bestW] = [size, w];
  return best;
}

function footerCutoff(lines, pageHeight, isOwn) {
  // Fußbereich beginnt bei "Seite x/y" bzw. der obersten Zeile mit eigenen Firmendaten
  const candidates = [];
  for (const l of lines) {
    if (RE.pageNumber.test(normalizeSpaces(l.text))) candidates.push(l.y);
    else if (l.y > pageHeight * 0.7 && isOwn(l.text)) candidates.push(l.y);
  }
  if (!candidates.length) return pageHeight * 0.9;
  return Math.min(...candidates) - 0.5;
}

function findTableHeader(lines) {
  for (const line of lines) {
    const cols = {};
    for (const cell of line.cells) {
      for (const [key, re] of Object.entries(COLUMN_LABELS)) {
        if (!cols[key] && re.test(cell.text)) {
          cols[key] = { x0: cell.x0, x1: cell.x1, text: cell.text };
          break;
        }
      }
    }
    if (cols.quantity && (cols.unitPrice || cols.net) && Object.keys(cols).length >= 3) {
      return { line, cols };
    }
  }
  return null;
}

function isRepeatedHeader(line) {
  let hits = 0;
  for (const cell of line.cells) if (Object.values(COLUMN_LABELS).some((re) => re.test(cell.text))) hits++;
  return hits >= 3 && !line.cells.some((c) => isMoney(c.text));
}

function isSummaryLine(line, cols, bodySize) {
  const labelCell = line.cells[0];
  if (!labelCell || isMoney(labelCell.text)) return false;
  if (labelCell.x0 < cols.quantity.x0 - 3 * bodySize) return false;
  const label = labelCell.text;
  const known = Object.values(SUMMARY_LABELS).some((re) => re.test(label));
  return known && line.cells.slice(1).some((c) => isMoney(c.text));
}

function readSummaryLine(line, totals) {
  const label = line.cells[0].text;
  const value = stripCurrency([...line.cells].reverse().find((c) => isMoney(c.text)).text);
  if (SUMMARY_LABELS.discount.test(label)) totals.discount = value;
  else if (SUMMARY_LABELS.net.test(label)) totals.net = totals.net ?? value;
  else if (SUMMARY_LABELS.vat.test(label)) {
    totals.vatLines = [...(totals.vatLines || []), { label, value }];
    if (/insgesamt|gesamt|summe/i.test(label) || totals.vat == null) totals.vat = value;
  } else if (SUMMARY_LABELS.gross.test(label)) totals.gross = value;
}

function nearestColumn(cell, keys, cols) {
  let best = keys[0];
  let bestD = Infinity;
  for (const key of keys) {
    const c = cols[key];
    const d = Math.min(Math.abs(cell.x1 - c.x1), Math.abs(cell.x0 - c.x0));
    if (d < bestD) [best, bestD] = [key, d];
  }
  return best;
}

/**
 * Ordnet die Beschreibungszeilen den Zahlenzeilen zu. Im Angebot steht die
 * Zahlenzeile vertikal mittig neben dem Positionstext; zwischen zwei Positionen
 * ist der Abstand deutlich größer als zwischen Zeilen derselben Position.
 * Zwischen je zwei Zahlenzeilen wird daher an der größten Lücke getrennt.
 */
export function segmentItems(textLines, rows, bodySize) {
  const n = rows.length;
  if (!n) return [];
  const tol = 0.4 * bodySize;
  const lines = [...textLines].sort((a, b) => a.yv - b.yv);
  const gaps = lines.slice(1).map((l, j) => l.yv - lines[j].yv);
  const typical = median(gaps.filter((g) => g < PAGE_OFFSET / 2)) || bodySize * 1.5;

  const cuts = []; // Index j: Trennung zwischen lines[j] und lines[j+1]
  let minJ = -1;
  for (let r = 0; r < n - 1; r++) {
    const top = rows[r].yv;
    const bottom = rows[r + 1].yv;
    let best = null;
    for (let j = Math.max(0, minJ + 1); j < lines.length - 1; j++) {
      const a = lines[j];
      const b = lines[j + 1];
      if (a.yv > bottom + tol) break;
      if (b.yv < top - tol) continue;
      const crossesPage = Math.floor(a.yv / PAGE_OFFSET) !== Math.floor(b.yv / PAGE_OFFSET);
      const gap = crossesPage ? typical * 2 : b.yv - a.yv;
      const mid = (top + bottom) / 2;
      const center = Math.abs((a.yv + b.yv) / 2 - mid);
      if (!best || gap > best.gap + 0.01 || (Math.abs(gap - best.gap) <= 0.01 && center < best.center)) {
        best = { j, gap, center };
      }
    }
    if (best) {
      cuts.push({ j: best.j, uncertain: best.gap < 1.4 * typical });
      minJ = best.j;
    } else {
      // keine Textzeile zwischen den Zahlenzeilen → Position ohne eigenen Text
      cuts.push({ j: minJ, uncertain: true });
    }
  }

  const groups = [];
  let start = 0;
  for (let r = 0; r < n; r++) {
    const end = r < n - 1 ? cuts[r].j : lines.length - 1;
    groups.push({
      lines: lines.slice(start, end + 1),
      uncertain: (r > 0 && cuts[r - 1].uncertain) || (r < n - 1 && cuts[r].uncertain),
    });
    start = Math.max(start, end + 1);
  }
  return groups;
}

function readClosing(lines, res, bodySize) {
  let inPayment = false;
  let lastY = null;
  let paymentGap = null;
  for (const line of lines) {
    const text = normalizeSpaces(line.text);
    const pay = text.match(PAYMENT_HEADING);
    if (pay) {
      inPayment = true;
      res.paymentTerms = pay[1] ? [pay[1]] : [];
      lastY = line.yv;
      paymentGap = null;
      continue;
    }
    if (inPayment) {
      const gap = line.yv - lastY;
      const limit = paymentGap ? paymentGap * 1.5 : 2.6 * bodySize;
      if (gap <= limit && !CLOSING_STOP.test(text)) {
        res.paymentTerms.push(text);
        paymentGap = paymentGap ?? gap;
        lastY = line.yv;
        continue;
      }
      inPayment = false;
    }
    if (VALIDITY_LINE.test(text)) {
      const d = text.match(RE.dateInText);
      if (d) res.fields.validUntil = res.fields.validUntil ?? d[1];
      res.validityText = text;
      continue;
    }
    res.closingNotes.push(text);
  }
}

function cleanMetaFields(res, log) {
  const f = res.fields;
  if (f.offerNumber) {
    const v = normalizeSpaces(f.offerNumber).replace(/\s/g, '');
    if (RE.offerNumberValue.test(v)) f.offerNumber = v;
    else {
      log(`Angebotsnummer hat unerwartetes Format: "${f.offerNumber}"`);
      f.offerNumber = null;
    }
  }
  if (f.offerDate) {
    const m = normalizeSpaces(f.offerDate).match(RE.dateInText);
    f.offerDate = m ? m[1] : null;
    if (!m) log('Ausstellungsdatum hat unerwartetes Format.');
  }
  if (f.customerVatId) {
    const v = normalizeVatId(f.customerVatId);
    if (RE.vatId.test(v)) f.customerVatId = v;
    else {
      log(`Kunden-USt-IdNr. hat unerwartetes Format: "${f.customerVatId}"`);
      f.customerVatId = null;
    }
  }
}

function stripCurrency(s) {
  return normalizeSpaces(s).replace(/\s*€$/, '');
}

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
