// Erzeugt den Lieferschein als Vektor-PDF im Design des Musters
// TPC-L-2026-0279-2. Läuft im Browser und in Node (Tests).
// Gleiche Eingabe → byte-identisches PDF (keine Zufallswerte, keine Uhrzeit).

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { COMPANY } from '../config/company.js';
import { isoToSlashDate } from '../parser/format.js';
import { recipientOf } from '../delivery-note/model.js';
import { LOGO_SHAPES, LOGO_VIEWBOX } from './logo-paths.js';
import {
  ADDRESS, COLORS, CONTENT_BOTTOM, CONTINUATION, FOOTER, INTRO, LEFT, LOGO, META, PAGE, RIGHT_EDGE, TABLE, TITLE, VALUE_X,
} from './layout.js';

/** Dateien unter public/, die der Renderer braucht */
export const ASSET_FILES = {
  regular: 'fonts/LexendTPC-Regular.ttf',
  bold: 'fonts/Lexend-Bold.ttf',
  footerRegular: 'fonts/Roboto-Regular.ttf',
  footerBold: 'fonts/Roboto-Bold.ttf',
  pressLogos: 'img/presse-logos.png',
};

const color = (c) => rgb(c[0], c[1], c[2]);
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/**
 * @param {object} note    Lieferschein-Daten (siehe delivery-note/model.js)
 * @param {Record<keyof ASSET_FILES, Uint8Array|ArrayBuffer>} assets
 * @returns {Promise<Uint8Array>}
 */
export async function renderDeliveryNote(note, assets) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts = {
    regular: await doc.embedFont(assets.regular, { subset: true, customName: 'LexendTPC-Regular' }),
    bold: await doc.embedFont(assets.bold, { subset: true, customName: 'Lexend-Bold' }),
    footerRegular: await doc.embedFont(assets.footerRegular, { subset: true, customName: 'Roboto-Regular' }),
    footerBold: await doc.embedFont(assets.footerBold, { subset: true, customName: 'Roboto-Bold' }),
  };
  const pressLogos = await doc.embedPng(assets.pressLogos);

  const title = note.number || 'Lieferschein';
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setAuthor(COMPANY.name);
  doc.setSubject('Lieferschein');
  doc.setCreator('Lieferschein-Generator');
  doc.setProducer('pdf-lib');
  doc.setLanguage('de-DE');
  if (/^\d{4}-\d{2}-\d{2}$/.test(note.issueDate)) {
    const d = new Date(`${note.issueDate}T00:00:00Z`);
    doc.setCreationDate(d);
    doc.setModificationDate(d);
  }

  const ctx = new Ctx(doc, fonts);
  ctx.newPage();
  drawTitleBlock(ctx, note);
  drawTable(ctx, note);

  const total = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    drawLogo(page);
    drawFooter(ctx, page, pressLogos);
    if (total > 1) {
      const text = `Seite ${i + 1}/${total}`;
      const f = fonts.regular;
      const s = FOOTER.pageNumber.size;
      ctx.text(page, text, TABLE.columns[2].x1 - f.widthOfTextAtSize(clean(text, f), s), FOOTER.pageNumber.baseline, f, s, COLORS.footer);
    }
  });

  return doc.save({ useObjectStreams: false });
}

// ─────────────────────────────────────────────────────── Hilfsklasse ────

class Ctx {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.pages = [];
    this.page = null;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    return this.page;
  }

  /** Text an Grundlinie y (von oben gemessen) zeichnen */
  text(page, str, x, y, font, size, c = COLORS.text) {
    const s = clean(str, font);
    if (!s) return 0;
    page.drawText(s, { x, y: PAGE.height - y, size, font, color: color(c) });
    return font.widthOfTextAtSize(s, size);
  }

  wrap(str, font, size, maxWidth) {
    return wrapText(clean(str, font), font, size, maxWidth);
  }
}

/** Zeichen, die die Schrift nicht enthält, durch "?" ersetzen */
function clean(str, font) {
  const s = String(str ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[​‌‍⁠﻿]/g, '').replace(/[  ]/g, ' ');
  if (!font.__charset) font.__charset = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of s) out += font.__charset.has(ch.codePointAt(0)) ? ch : '?';
  return out;
}

/** Zeilenumbruch an Wortgrenzen; überlange Wörter werden hart getrennt */
export function wrapText(str, font, size, maxWidth) {
  const width = (t) => font.widthOfTextAtSize(t, size);
  const words = String(str).split(/ +/).filter((w, i, a) => w || (i > 0 && i < a.length - 1));
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (width(word) <= maxWidth) {
      line = word;
      continue;
    }
    let part = '';
    for (const ch of word) {
      if (part && width(part + ch) > maxWidth) {
        lines.push(part);
        part = ch;
      } else part += ch;
    }
    line = part;
  }
  lines.push(line);
  return lines;
}

// ─────────────────────────────────────────────────── Seitenelemente ─────

function drawLogo(page) {
  const scale = LOGO.width / LOGO_VIEWBOX[2];
  for (const shape of LOGO_SHAPES) {
    page.drawSvgPath(shape.d, { x: LOGO.x, y: PAGE.height - LOGO.top, scale, color: hex(shape.color) });
  }
}

function drawFooter(ctx, page, pressLogos) {
  const p = FOOTER.pressLogos;
  page.drawImage(pressLogos, { x: p.x, y: PAGE.height - p.top - p.height, width: p.width, height: p.height });
  const { footerRegular: r, footerBold: b } = ctx.fonts;
  const rows = [
    [[r, `${COMPANY.name} • ${COMPANY.street}, ${COMPANY.zipCityFooter} • ${COMPANY.phone} • ${COMPANY.email}`]],
    [[b, 'BANK:'], [r, ` ${COMPANY.bank} • `], [b, 'IBAN:'], [r, ` ${COMPANY.iban} • `], [b, 'BIC:'], [r, ` ${COMPANY.bic}`]],
    [[b, 'USt-IdNr.:'], [r, ` ${COMPANY.vatId} • `], [b, 'Steuernummer:'], [r, ` ${COMPANY.taxNumber}`]],
  ];
  rows.forEach((segments, i) => {
    const total = segments.reduce((w, [f, t]) => w + f.widthOfTextAtSize(clean(t, f), FOOTER.size), 0);
    let x = FOOTER.centerX - total / 2;
    for (const [f, t] of segments) x += ctx.text(page, t, x, FOOTER.baselines[i], f, FOOTER.size, COLORS.footer);
  });
}

/** Titel, Kopfdaten, Absender/Empfänger, ggf. Rechnungsadresse, Einleitung */
function drawTitleBlock(ctx, note) {
  const { regular, bold } = ctx.fonts;
  const page = ctx.page;
  const valueWidth = RIGHT_EDGE - VALUE_X;

  ctx.text(page, TITLE.text, LEFT, TITLE.baseline, bold, TITLE.size);

  const meta = [
    ['Lieferscheinnummer', note.number],
    ['Ausstellungsdatum', isoToSlashDate(note.issueDate)],
  ];
  if (note.showOfferNumber && note.offerNumber) meta.push(['Angebotsnummer', note.offerNumber]);
  if (note.showCustomerVatId && note.customerVatId) meta.push(['Kunden-USt-IDNr.', note.customerVatId]);

  let y = META.firstBaseline;
  meta.forEach(([label, value], i) => {
    if (i > 0) y += META.step;
    ctx.text(page, label, LEFT, y, bold, META.size, COLORS.teal);
    const lines = ctx.wrap(value, regular, META.size, valueWidth);
    lines.forEach((l, j) => ctx.text(page, l, VALUE_X, y + j * META.step, regular, META.size));
    y += (lines.length - 1) * META.step;
  });

  // Absender (links) und Empfänger (rechts)
  y += ADDRESS.gapAfterMeta;
  const sender = [COMPANY.street, COMPANY.zipCity, COMPANY.register];
  ctx.text(page, COMPANY.name, LEFT, y, bold, ADDRESS.senderNameSize);
  let leftEnd = y;
  sender.forEach((l, i) => {
    leftEnd = y + ADDRESS.firstLineGap + i * ADDRESS.lineStep;
    ctx.text(page, l, LEFT, leftEnd, regular, ADDRESS.lineSize, i === 2 ? COLORS.soft : COLORS.text);
  });
  const rightEnd = drawAddress(ctx, recipientOf(note), y, valueWidth);
  let end = Math.max(leftEnd, rightEnd);

  // Abweichende Rechnungsadresse
  if (!note.deliverySameAsBilling) {
    y = end + ADDRESS.blockGap;
    ctx.text(page, 'Rechnungsadresse', LEFT, y, bold, META.size, COLORS.teal);
    end = drawAddress(ctx, note.billing, y, valueWidth);
  }

  // Einleitungssatz
  y = end + INTRO.gap;
  const intro = ctx.wrap(note.intro, regular, INTRO.size, RIGHT_EDGE - LEFT);
  intro.forEach((l, i) => ctx.text(page, l, LEFT, y + i * ADDRESS.lineStep, regular, INTRO.size, COLORS.soft));
  ctx.cursor = y + (intro.length - 1) * ADDRESS.lineStep + TABLE.gapAfterIntro;
}

/** Name (fett) + Adresszeilen in der rechten Spalte; liefert letzte Grundlinie */
function drawAddress(ctx, addr, y, width) {
  const { regular, bold } = ctx.fonts;
  const names = ctx.wrap(addr.name, bold, ADDRESS.nameSize, width);
  names.forEach((l, i) => ctx.text(ctx.page, l, VALUE_X, y + i * ADDRESS.nameStep, bold, ADDRESS.nameSize));
  let last = y + (names.length - 1) * ADDRESS.nameStep;
  const lines = addr.lines.filter((l) => String(l).trim()).flatMap((l) => ctx.wrap(l, regular, ADDRESS.lineSize, width));
  lines.forEach((l, i) => {
    const ly = last + ADDRESS.firstLineGap + i * ADDRESS.lineStep;
    ctx.text(ctx.page, l, VALUE_X, ly, regular, ADDRESS.lineSize);
    if (i === lines.length - 1) last = ly;
  });
  return last;
}

function drawTableHeader(ctx, top) {
  const { bold } = ctx.fonts;
  for (const col of TABLE.columns) {
    ctx.page.drawRectangle({
      x: col.x0,
      y: PAGE.height - top - TABLE.headerHeight,
      width: col.x1 - col.x0,
      height: TABLE.headerHeight,
      color: color(COLORS.teal),
    });
    ctx.text(ctx.page, col.label, col.x0 + TABLE.inset, top + TABLE.headerBaseline, bold, TABLE.headerSize, COLORS.white);
  }
  // weiße Zellränder wie im Muster (trennen die Kopfzellen optisch)
  const white = color(COLORS.white);
  const bottom = PAGE.height - top - TABLE.headerHeight + TABLE.borderWidth / 2;
  for (const x of TABLE.borderX) {
    ctx.page.drawLine({ start: { x, y: PAGE.height - top }, end: { x, y: bottom }, thickness: TABLE.borderWidth, color: white });
  }
  ctx.page.drawLine({
    start: { x: TABLE.borderX[0], y: bottom },
    end: { x: TABLE.borderX[TABLE.borderX.length - 1], y: bottom },
    thickness: TABLE.borderWidth,
    color: white,
  });
  return top + TABLE.headerHeight + TABLE.firstRowBaseline;
}

function continuationPage(ctx, note) {
  ctx.newPage();
  const label = note.number ? `Lieferschein ${note.number}` : 'Lieferschein';
  ctx.text(ctx.page, label, LEFT, CONTINUATION.titleBaseline, ctx.fonts.bold, CONTINUATION.titleSize);
  return drawTableHeader(ctx, CONTINUATION.tableTop);
}

function drawTable(ctx, note) {
  const { regular, bold } = ctx.fonts;
  const [art, qty, unit] = TABLE.columns;
  const artWidth = art.x1 - art.x0 - 2 * TABLE.inset;
  const qtyWidth = qty.x1 - qty.x0 - 2 * TABLE.inset;
  const unitWidth = unit.x1 - unit.x0 - 2 * TABLE.inset;
  const fullPageRows = Math.floor((CONTENT_BOTTOM - (CONTINUATION.tableTop + TABLE.headerHeight + TABLE.firstRowBaseline)) / TABLE.lineStep) + 1;

  let y = drawTableHeader(ctx, ctx.cursor);

  note.items.forEach((item, index) => {
    // Zeilen der Artikelspalte: Bezeichnung (fett, unterstrichen) + Beschreibung (fett)
    const rows = [];
    for (const l of ctx.wrap(item.title, bold, TABLE.size, artWidth)) rows.push({ text: l, underline: true });
    for (const raw of String(item.description ?? '').split(/\r?\n/)) {
      for (const l of ctx.wrap(raw, bold, TABLE.size, artWidth)) rows.push({ text: l, underline: false });
    }
    while (rows.length > 1 && !rows[rows.length - 1].text.trim()) rows.pop();
    const qtyLines = ctx.wrap(item.quantity, regular, TABLE.size, qtyWidth);
    const unitLines = ctx.wrap(item.unit, regular, TABLE.size, unitWidth);
    const height = Math.max(rows.length, qtyLines.length, unitLines.length);

    if (index > 0) y += TABLE.lineStep + TABLE.itemGap;
    const lastY = y + (height - 1) * TABLE.lineStep;
    if (lastY > CONTENT_BOTTOM && height <= fullPageRows) y = continuationPage(ctx, note);

    for (let i = 0; i < height; i++) {
      if (y > CONTENT_BOTTOM) y = continuationPage(ctx, note);
      const row = rows[i];
      if (row && row.text) {
        const w = ctx.text(ctx.page, row.text, art.x0 + TABLE.inset, y, bold, TABLE.size);
        if (row.underline && w > 0) {
          const uy = PAGE.height - y - TABLE.underlineOffset;
          ctx.page.drawLine({
            start: { x: art.x0 + TABLE.inset, y: uy },
            end: { x: art.x0 + TABLE.inset + w, y: uy },
            thickness: TABLE.underlineThickness,
            color: color(COLORS.text),
          });
        }
      }
      const vy = y + TABLE.valueShift;
      if (qtyLines[i]) ctx.text(ctx.page, qtyLines[i], qty.x0 + TABLE.inset, vy, regular, TABLE.size);
      if (unitLines[i]) ctx.text(ctx.page, unitLines[i], unit.x0 + TABLE.inset, vy, regular, TABLE.size);
      if (i < height - 1) y += TABLE.lineStep;
    }
  });
}
