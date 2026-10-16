// Zeichnet die Auftragsbestätigung als PDF (Vektor, eingebettete Schriften).
// Maße, Schriftgrößen und Farben sind aus der bisherigen Google-Docs-AB
// übernommen (TPC-AB-2026-0340), damit das Ergebnis gleich aussieht.
// Gleiche Eingaben erzeugen byte-identische PDFs (fester Zeitstempel, feste Fontnamen).

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const A4 = [595.28, 841.89];

const rgb255 = (r, g, b) => rgb(r / 255, g / 255, b / 255);
const COLORS = {
  teal: rgb255(31, 167, 170),
  black: rgb(0, 0, 0),
  soft: rgb255(29, 29, 27),
  white: rgb(1, 1, 1),
  footer: rgb(0.6, 0.6, 0.6),
};

// Alle y-Werte: Grundlinie in pt, von der Blattoberkante gemessen
export const LAYOUT = {
  left: 28.35,
  logo: { x: 482.1, top: -3.75, size: 94.5 },
  title: { baseline: 104, size: 32 },
  meta: { firstBaseline: 147.25, step: 17.25, size: 12, valueX: 280.35 },
  address: {
    gapAfterMeta: 36.5,
    headSize: 14,
    size: 11,
    firstStep: 17.13,
    step: 15.81,
    rightX: 208.35,
    leftWidth: 172,
  },
  intro: { gap: 47.44, size: 11, step: 15.81 },
  table: {
    gapToTable: 20.62,
    headerHeight: 24,
    headerBaseline: 16,
    headerSize: 10,
    cols: [28.35, 210.6, 308.85, 406.35, 551.1],
    pad: 5.25,
    size: 10.5,
    step: 13.125,
    firstBaseline: 18.25,
    rowBottom: 38,
  },
  afterTable: 28.8,
  block: { size: 11, step: 15.81, gap: 31.6 },
  footer: { baselines: [796.17, 809.97, 823.78], size: 10, centerX: 275.8 },
  contentBottom: 768,
  continuationTop: 56,
};

/**
 * @param {object} doc     Dokumentmodell aus formToDocument()
 * @param {object} assets  { fonts: { lexendRegular, lexendBold, robotoRegular, robotoBold }, logo?: Uint8Array (PNG) }
 * @returns {Promise<Uint8Array>}
 */
export async function renderAbPdf(doc, assets) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);

  const embed = async (bytes, name) => {
    const font = await pdf.embedFont(bytes, { subset: true, customName: name });
    const glyphs = fontkit.create(toUint8(bytes));
    return { font, glyphs };
  };
  const F = {
    regular: await embed(assets.fonts.lexendRegular, 'LXNDRG+Lexend-Regular'),
    bold: await embed(assets.fonts.lexendBold, 'LXNDBD+Lexend-Bold'),
    footer: await embed(assets.fonts.robotoRegular, 'RBTORG+Roboto-Regular'),
    footerBold: await embed(assets.fonts.robotoBold, 'RBTOBD+Roboto-Bold'),
  };
  const logo = assets.logo ? await pdf.embedPng(assets.logo) : null;

  const H = A4[1];
  const pages = [];
  let page;
  let y; // aktuelle Grundlinie (von oben)

  const text = (str, x, baseline, f, size, color = COLORS.black) => {
    const s = safeText(str, f.glyphs);
    if (!s) return;
    page.drawText(s, { x, y: H - baseline, size, font: f.font, color });
  };
  const width = (str, f, size) => f.font.widthOfTextAtSize(safeText(str, f.glyphs), size);
  const wrap = (str, f, size, maxWidth) =>
    wrapText(safeText(str, f.glyphs), (s) => f.font.widthOfTextAtSize(s, size), maxWidth);

  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
  };

  // ── Seite 1: Kopf ─────────────────────────────────────────────────────
  newPage();
  if (logo) {
    const L = LAYOUT.logo;
    page.drawImage(logo, { x: L.x, y: H - L.top - L.size, width: L.size, height: L.size });
  }
  text(doc.title, LAYOUT.left, LAYOUT.title.baseline, F.bold, LAYOUT.title.size);

  const M = LAYOUT.meta;
  y = M.firstBaseline;
  doc.meta.forEach((row, i) => {
    if (i) y += M.step;
    text(row.label, LAYOUT.left, y, F.bold, M.size, COLORS.teal);
    text(row.value, M.valueX, y, F.regular, M.size);
  });

  // ── Absender | Empfänger ─────────────────────────────────────────────
  const A = LAYOUT.address;
  const headY = y + A.gapAfterMeta;
  const drawAddress = (block, x, maxWidth) => {
    let by = headY;
    const head = wrap(block.name, F.bold, A.headSize, maxWidth);
    head.forEach((l, i) => text(l, x, by + i * A.headSize * 1.2, F.bold, A.headSize));
    by += (head.length - 1) * A.headSize * 1.2;
    let first = true;
    for (const line of block.lines) {
      for (const l of wrap(line, F.regular, A.size, maxWidth)) {
        by += first ? A.firstStep : A.step;
        first = false;
        text(l, x, by, F.regular, A.size);
      }
    }
    return by;
  };
  const leftEnd = drawAddress(doc.sender, LAYOUT.left, A.rightX - LAYOUT.left - 8);
  const rightEnd = drawAddress(doc.recipient, A.rightX, LAYOUT.table.cols[4] - A.rightX);
  y = Math.max(leftEnd, rightEnd);

  // ── Einleitung + Hinweise ───────────────────────────────────────────
  const I = LAYOUT.intro;
  y += I.gap;
  const fullWidth = LAYOUT.table.cols[4] - LAYOUT.left;
  wrap(doc.intro, F.regular, I.size, fullWidth).forEach((l, i) => {
    if (i) y += I.step;
    text(l, LAYOUT.left, y, F.regular, I.size, COLORS.soft);
  });
  if (doc.notes.length) {
    y += I.step * 0.5;
    for (const note of doc.notes) {
      for (const l of wrap(note, F.regular, I.size, fullWidth)) {
        y += I.step;
        text(l, LAYOUT.left, y, F.regular, I.size, COLORS.soft);
      }
    }
  }

  // ── Tabelle ───────────────────────────────────────────────────────────
  const T = LAYOUT.table;
  const colWidth = (i) => T.cols[i + 1] - T.cols[i] - 2 * T.pad;
  const drawHeader = (top) => {
    for (let i = 0; i < 4; i++) {
      page.drawRectangle({
        x: T.cols[i],
        y: H - top - T.headerHeight,
        width: T.cols[i + 1] - T.cols[i] + (i < 3 ? 0.3 : 0),
        height: T.headerHeight,
        color: COLORS.teal,
      });
      text(doc.columns[i] || '', T.cols[i] + T.pad, top + T.headerBaseline, F.bold, T.headerSize, COLORS.white);
    }
    return top + T.headerHeight;
  };

  let rowTop = drawHeader(y + T.gapToTable);
  doc.items.forEach((item, idx) => {
    const titleLines = wrap(item.title, F.bold, T.size, colWidth(0));
    const descLines = item.description.flatMap((d) => wrap(d, F.regular, T.size, colWidth(0)));
    const qtyLines = wrap(item.quantity, F.regular, T.size, colWidth(1));
    const unitLines = wrap(item.unit, F.regular, T.size, colWidth(2));
    const priceLines = wrap(item.unitPrice, F.regular, T.size, colWidth(3));
    const lineCount = Math.max(
      titleLines.length + descLines.length,
      qtyLines.length,
      unitLines.length,
      priceLines.length,
    );
    const height = T.firstBaseline + (lineCount - 1) * T.step + T.rowBottom;
    // Nur der beschriebene Teil muss auf die Seite – der Leerraum darunter darf in den Rand ragen
    const needed = height - T.rowBottom + 6;
    if (rowTop + needed > LAYOUT.contentBottom && idx > 0) {
      newPage();
      rowTop = drawHeader(LAYOUT.continuationTop);
    }
    const by = rowTop + T.firstBaseline;
    const x0 = T.cols[0] + T.pad;
    titleLines.forEach((l, i) => text(l, x0, by + i * T.step, F.bold, T.size));
    descLines.forEach((l, i) => text(l, x0, by + (titleLines.length + i) * T.step, F.regular, T.size));
    qtyLines.forEach((l, i) => text(l, T.cols[1] + T.pad, by + i * T.step, F.regular, T.size));
    unitLines.forEach((l, i) => text(l, T.cols[2] + T.pad, by + i * T.step, F.regular, T.size));
    priceLines.forEach((l, i) => text(l, T.cols[3] + T.pad, by + i * T.step, F.regular, T.size));
    rowTop += height;
  });
  const lastBaseline = rowTop - T.rowBottom;
  y = rowTop + LAYOUT.afterTable;

  // ── Summen (optional) ─────────────────────────────────────────────────
  const B = LAYOUT.block;
  const ensureSpace = (lineCount) => {
    if (y + (lineCount - 1) * B.step > LAYOUT.contentBottom) {
      newPage();
      y = LAYOUT.continuationTop + B.step;
    }
  };
  if (doc.totals?.length) {
    y = lastBaseline + 30;
    ensureSpace(doc.totals.length);
    const right = T.cols[4] - T.pad;
    doc.totals.forEach((row, i) => {
      if (i) y += B.step;
      const f = row.bold ? F.bold : F.regular;
      text(row.label, T.cols[2] + T.pad, y, f, B.size, COLORS.soft);
      text(row.value, right - width(row.value, f, B.size), y, f, B.size, COLORS.soft);
    });
    y += 1.5 * B.gap;
  }

  // ── Zahlungsbedingungen + weitere Hinweise ───────────────────────────
  const block = (heading, bodyLines) => {
    const wrapped = bodyLines.flatMap((l) => wrap(l, F.regular, B.size, fullWidth));
    ensureSpace(wrapped.length + (heading ? 1 : 0));
    if (heading) text(heading, LAYOUT.left, y, F.bold, B.size, COLORS.soft);
    wrapped.forEach((l, i) =>
      text(l, LAYOUT.left, y + (i + (heading ? 1 : 0)) * B.step, F.regular, B.size, COLORS.soft),
    );
    y += (wrapped.length - (heading ? 0 : 1)) * B.step + B.gap;
  };
  if (doc.payment.lines.length) block(doc.payment.heading, doc.payment.lines);
  if (doc.closingNotes.length) block('', doc.closingNotes);

  // ── Fußzeile + Seitenzahlen ──────────────────────────────────────────
  const FT = LAYOUT.footer;
  pages.forEach((p, i) => {
    page = p;
    doc.footer.slice(0, FT.baselines.length).forEach((line, li) => {
      const segs = parseMarkup(line).map((s) => ({ ...s, f: s.bold ? F.footerBold : F.footer }));
      const total = segs.reduce((acc, s) => acc + width(s.text, s.f, FT.size), 0);
      let x = FT.centerX - total / 2;
      for (const s of segs) {
        text(s.text, x, FT.baselines[li], s.f, FT.size, COLORS.footer);
        x += width(s.text, s.f, FT.size);
      }
    });
    if (pages.length > 1) {
      const label = `Seite ${i + 1} von ${pages.length}`;
      text(label, T.cols[4] - width(label, F.regular, 8), FT.baselines[0] - 18, F.regular, 8, COLORS.footer);
    }
  });

  // ── Metadaten (fest → reproduzierbar) ────────────────────────────────
  const date = isoToDate(doc.pdf.date);
  pdf.setTitle(doc.pdf.title || doc.title);
  if (doc.pdf.author) pdf.setAuthor(doc.pdf.author);
  if (doc.pdf.subject) pdf.setSubject(doc.pdf.subject);
  pdf.setCreator('AB-Generator');
  pdf.setProducer('AB-Generator (pdf-lib)');
  pdf.setLanguage('de-DE');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);

  return pdf.save();
}

// ════════════════════════════════════════════════════════════════════════

function toUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function isoToDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(Date.UTC(2000, 0, 1));
}

/** "**BANK:** Musterbank" → [{ text: "BANK:", bold: true }, { text: " Musterbank", bold: false }] */
export function parseMarkup(line) {
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });
  return parts;
}

/**
 * Ersetzt Zeichen, die die Schrift nicht enthält (Fallback: Grundbuchstabe
 * ohne Akzent, sonst "?"), damit nie ein leeres Kästchen im PDF landet.
 */
export function safeText(str, glyphs) {
  let out = '';
  for (const ch of String(str ?? '').replace(/[\t\r\n]+/g, ' ')) {
    const cp = ch.codePointAt(0);
    if (cp < 32) continue;
    if (glyphs.hasGlyphForCodePoint(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (base && [...base].every((c) => glyphs.hasGlyphForCodePoint(c.codePointAt(0)))) out += base;
    else if (/\s/.test(ch)) out += ' ';
    else out += '?';
  }
  return out;
}

/** Zeilenumbruch an Leerzeichen; überlange Wörter werden hart getrennt. */
export function wrapText(str, measure, maxWidth) {
  const words = String(str ?? '')
    .split(/ +/)
    .filter(Boolean);
  if (!words.length) return [];
  const out = [];
  let line = '';
  for (let word of words) {
    while (measure(word) > maxWidth && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut--;
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) line = candidate;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}
