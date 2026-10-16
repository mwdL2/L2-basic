// Baut ein synthetisches Angebots-PDF im Layout der Lab2-Angebote
// (Positionen gemessen am Original A-2026-0346, Kundendaten erfunden).
// So testen wir den Parser, ohne echte Kundendokumente einzuchecken.

import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const ROOT = new URL('../../', import.meta.url);
const font = (f) => readFileSync(new URL(`public/fonts/${f}`, ROOT));

const W = 594;
const H = 842.88;
const TEAL = rgb(0.1216, 0.6549, 0.6667);
const INK = rgb(0.1137, 0.1137, 0.1059);

export const DEFAULT_OFFER = {
  customerName: 'Muster Sport GmbH',
  address: ['Beispielweg 12', '10115 Berlin', 'Deutschland'],
  vatId: 'DE123456789',
  offerNumber: 'A-2026-0999',
  date: '02.10.2026',
  items: [
    { lines: ['Sonderanfertigung Trinkflasche', 'Inkl. Logodruck', 'Material: Tritan'], qty: '5000', price: '2,10 €', vat: '19 %', net: '10.500,00 €' },
    { lines: ['Add-on: Faltkarton', 'Inkl. Full-Color-Print', 'Textur: Seidenmatt', 'Passend zu Flasche'], qty: '5000', price: '0,20 €', vat: '19 %', net: '1.000,00 €' },
  ],
  totals: { net: '11.500,00 €', vat: '2.185,00 €', gross: '13.685,00 €' },
};

/**
 * @param {object} [o]  Felder wie DEFAULT_OFFER; `omitLabels` entfernt Kopf-Labels,
 *                      `rowsPerPage` erzwingt Seitenumbrüche in der Tabelle
 */
export async function buildOfferPdf(o = {}) {
  const d = { ...DEFAULT_OFFER, ...o };
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(font('LexendTPC-Regular.ttf'), { subset: true, customName: 'Reg' });
  const bold = await doc.embedFont(font('Lexend-Bold.ttf'), { subset: true, customName: 'Bold' });

  let page = doc.addPage([W, H]);
  const text = (s, x, y, size, f = reg, color = INK) => page.drawText(s, { x, y: H - y, size, font: f, color });
  const right = (s, x1, y, size, f = reg) => text(s, x1 - f.widthOfTextAtSize(s, size), y, size, f);

  const tableHeader = (top) => {
    page.drawRectangle({ x: 63, y: H - top - 18, width: 480.75, height: 18, color: TEAL });
    const y = top + 11.25;
    text('Artikel', 72, y, 7.5, bold, rgb(1, 1, 1));
    text('Menge', 326.52, y, 7.5, bold, rgb(1, 1, 1));
    text('Einzelpreis', 375.2, y, 7.5, bold, rgb(1, 1, 1));
    text('MwSt. (%)', 426.95, y, 7.5, bold, rgb(1, 1, 1));
    text('Nettobetrag', 491.91, y, 7.5, bold, rgb(1, 1, 1));
    return top + 18;
  };
  const footer = (n, total) => {
    text(`Seite ${n}/${total}`, 522.52, 758.25, 5.62);
    ['Lab2. GmbH', 'Am Schlangengraben 9D,', '13597 Berlin, DE', 'ah@lab2.gmbh'].forEach((l, i) => text(l, 63, 776.25 + i * 8.25, 5.62));
    text('Steuernummer: 29/409/30037', 225.25, 784.5, 5.62);
    text('USt-IDNr. DE356148615', 225.25, 792.75, 5.62);
  };

  text('Angebot', 63, 69.75, 16.5, bold);
  text('Lab2. GmbH · Am Schlangengraben 9D, 13597 Berlin, DE', 63, 182.25, 5.62);
  text(d.customerName, 63, 205.5, 8.25, bold);
  d.address.forEach((l, i) => text(l, 63, 222 + i * 7.5, 7.5));
  const meta = [
    ['Kunden-USt-IDNr.', d.vatId, 204.75],
    ['Angebotsnummer', d.offerNumber, 220.5],
    ['Ausstellungsdatum', d.date, 231.75],
  ];
  for (const [label, value, y] of meta) {
    if (value == null) continue;
    if (!o.omitLabels) text(label, 315.75, y, 7.5, bold);
    text(value, 398.25, y, 7.5);
  }
  text('Gerne bieten wir die unten aufgeführten Artikel zu folgenden Preisen an.', 63, 261, 7.5);
  text('Exkl. Versand', 63, 285, 7.5);

  const pages = [page];
  let y = tableHeader(298.5) + 25.5; // erste Grundlinie 342
  d.items.forEach((it, idx) => {
    const height = it.lines.length === 1 ? 0 : 13.5 + (it.lines.length - 2) * 12; // Abstand erste → letzte Zeile
    if ((o.rowsPerPage && idx > 0 && idx % o.rowsPerPage === 0) || y + height > 700) {
      page = doc.addPage([W, H]);
      pages.push(page);
      y = tableHeader(60) + 25.5;
    }
    it.lines.forEach((l, i) => text(l, 72, y + (i === 0 ? 0 : 13.5 + (i - 1) * 12), 7.5));
    const mid = y + height / 2;
    right(it.qty, 350.51, mid, 7.5);
    if (it.price) right(it.price, 412.58, mid, 7.5);
    if (it.vat) right(it.vat, 461.63, mid, 7.5);
    if (it.net) right(it.net, 534.75, mid, 7.5);
    page.drawRectangle({ x: 63, y: H - (y + height + 12.75), width: 480.75, height: 0.75, color: rgb(0.86, 0.86, 0.85) });
    y += height + 32.25;
  });
  y += -5;
  text('Nettobetrag', 327.75, y, 7.5, bold);
  right(d.totals.net, 537.74, y, 7.5);
  text('MwSt.-Betrag insgesamt', 327.75, y + 24, 7.5, bold);
  right(d.totals.vat, 537.74, y + 24, 7.5);
  text('Gesamt (inkl. MwSt.)', 327.75, y + 48, 7.5, bold);
  right(d.totals.gross, 537.74, y + 48, 7.5, bold);
  text('Dieses Angebot gilt für 30 Tage. (01.11.2026)', 63, y + 81.75, 7.5);
  text('Zahlungsbedingungen:', 63, y + 104.25, 7.5);
  text('35% Anzahlung', 63, y + 116.25, 7.5);

  pages.forEach((p, i) => {
    page = p;
    footer(i + 1, pages.length);
  });
  return doc.save();
}

/** PDF ohne jeden Text (wie ein Scan) */
export async function buildBlankPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: TEAL });
  return doc.save();
}
