import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeConfig } from '../src/core/abModel.js';
import { loadAssets } from '../tools/convert.mjs';
import { CASES } from './fixtures-src/cases.mjs';

export { pdfjs, CASES };
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const fixtureDir = join(root, 'test/fixtures');

export const config = normalizeConfig(JSON.parse(readFileSync(join(root, 'public/firmendaten.example.json'), 'utf8')));
export const assets = loadAssets(config);

export function readFixture(name) {
  return new Uint8Array(readFileSync(join(fixtureDir, name)));
}

const META_KEYS = {
  'Kunden-USt-IDNr.': 'customerVatId',
  Angebotsnummer: 'offerNumber',
  Ausstellungsdatum: 'offerDate',
};

/** Erwartete Erkennungsergebnisse direkt aus der Fall-Definition */
export function expected(c) {
  const meta = {};
  for (const [label, value] of c.meta) {
    const key = META_KEYS[label] || (/^[A-Z]-\d{4}/.test(value) ? 'offerNumber' : 'offerDate');
    meta[key] = value;
  }
  const strip = (s) => s.replace(/\s*[€%]$/, '');
  return {
    offerNumber: meta.offerNumber,
    offerDate: meta.offerDate,
    customerVatId: meta.customerVatId || '',
    customerName: c.customer.name,
    customerAddress: c.customer.lines,
    notes: c.notes,
    paymentTerms: c.payment,
    closingNotes: c.closing,
    items: c.items.map((it) => {
      const [quantity, unit = null] = it.quantity.split(' ');
      return {
        title: it.title,
        description: it.description,
        quantity,
        unit,
        unitPrice: strip(it.unitPrice),
        vatRate: strip(it.vat),
        net: strip(it.net),
      };
    }),
  };
}

export function itemCore(it) {
  const { title, description, quantity, unit, unitPrice, vatRate, net } = it;
  return { title, description, quantity, unit, unitPrice, vatRate, net };
}

/** Text aller Seiten eines PDFs (für Rundlauf-Prüfungen der erzeugten AB) */
export async function pdfText(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map((i) => i.str).join('\n'));
  }
  await task.destroy();
  return pages;
}
