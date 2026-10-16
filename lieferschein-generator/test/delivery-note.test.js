import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfPages, pagesToText } from '../src/parser/pdf-text.js';
import { parseOfferPages } from '../src/parser/offer-parser.js';
import {
  deliveryNoteFromOffer,
  deliveryNumberFromOffer,
  emptyDeliveryNote,
  fileNameFor,
  validateDeliveryNote,
} from '../src/delivery-note/model.js';
import { ASSET_FILES, renderDeliveryNote } from '../src/pdf/render.js';
import { formatGermanNumber, germanDateToIso, isoToSlashDate, parseGermanNumber, splitQuantity } from '../src/parser/format.js';
import { buildOfferPdf } from './helpers/offer-fixture.js';

const ROOT = new URL('../', import.meta.url);
const assets = Object.fromEntries(
  Object.entries(ASSET_FILES).map(([k, p]) => [k, new Uint8Array(readFileSync(new URL(`public/${p}`, ROOT)))]),
);

async function offerFromFixture(opts) {
  const pages = await readPdfPages(new Uint8Array(await buildOfferPdf(opts)), pdfjs);
  return parseOfferPages(pages, { fileName: 'angebot.pdf' });
}

async function pdfText(bytes) {
  const pages = await readPdfPages(new Uint8Array(bytes), pdfjs);
  return { pages: pages.length, text: pagesToText(pages) };
}

test('Zahlen und Datumswerte', () => {
  assert.equal(parseGermanNumber('15000'), 15000);
  assert.equal(parseGermanNumber('1.920'), 1920);
  assert.equal(parseGermanNumber('2,5'), 2.5);
  assert.equal(parseGermanNumber('abc'), null);
  assert.equal(formatGermanNumber(15000), '15.000');
  assert.equal(formatGermanNumber(2.5), '2,5');
  assert.deepEqual(splitQuantity('15000 Stk.'), { number: 15000, unit: 'Stk.', raw: '15000 Stk.' });
  assert.equal(germanDateToIso('09.10.2026'), '2026-10-09');
  assert.equal(germanDateToIso('31.02.2026'), null);
  assert.equal(isoToSlashDate('2026-09-28'), '28/09/2026');
});

test('Lieferscheinnummer aus der Angebotsnummer', () => {
  assert.equal(deliveryNumberFromOffer('A-2026-0346'), 'TPC-L-2026-0346');
  assert.equal(deliveryNumberFromOffer(''), '');
  assert.equal(deliveryNumberFromOffer('Quatsch'), '');
});

test('Angebot → Lieferschein: alles übernommen, keine Preise', async () => {
  const offer = await offerFromFixture();
  const note = deliveryNoteFromOffer(offer, { today: '2026-10-16' });
  assert.equal(note.number, 'TPC-L-2026-0999');
  assert.equal(note.offerNumber, 'A-2026-0999');
  assert.equal(note.customerVatId, 'DE123456789');
  assert.deepEqual(note.billing, { name: 'Muster Sport GmbH', lines: ['Beispielweg 12', '10115 Berlin', 'Deutschland'] });
  assert.equal(note.deliverySameAsBilling, true);
  assert.deepEqual(note.items[0], {
    title: 'Sonderanfertigung Trinkflasche',
    description: 'Inkl. Logodruck\nMaterial: Tritan',
    quantity: '5.000',
    unit: 'Stück',
  });
  assert.doesNotMatch(JSON.stringify(note), /€|10\.500|2,10/);
  assert.deepEqual(validateDeliveryNote(note), []);
});

test('Validierung: abweichende Lieferadresse ist dann Pflicht', () => {
  const note = emptyDeliveryNote({ today: '2026-10-16' });
  const fields = (n) => validateDeliveryNote(n).map((p) => p.field);
  assert.ok(fields(note).includes('number'));
  Object.assign(note, { number: 'TPC-L-1', offerNumber: 'A-1', billing: { name: 'X', lines: ['Y'] } });
  note.items[0] = { title: 'Artikel', description: '', quantity: '1', unit: 'Stück' };
  assert.deepEqual(fields(note), []);
  note.deliverySameAsBilling = false;
  assert.deepEqual(fields(note), ['delivery.name', 'delivery.lines']);
  assert.equal(fileNameFor({ number: 'TPC-L-2026-0279-2' }), 'TPC-L-2026-0279-2.pdf');
});

test('PDF: Inhalt, Rechnungsadresse nur bei abweichender Lieferadresse, keine Preise', async () => {
  const note = deliveryNoteFromOffer(await offerFromFixture(), { today: '2026-10-16' });
  const same = await pdfText(await renderDeliveryNote(note, assets));
  assert.equal(same.pages, 1);
  for (const s of ['Lieferschein', 'TPC-L-2026-0999', '16/10/2026', 'A-2026-0999', 'DE123456789', 'Muster Sport GmbH', 'Beispielweg 12', 'Sonderanfertigung Trinkflasche', 'Material: Tritan', '5.000', 'Stück', 'Lab2. GmbH', 'HRB245397B']) {
    assert.ok(same.text.includes(s), `fehlt: ${s}`);
  }
  assert.ok(!same.text.includes('Rechnungsadresse'));
  assert.ok(!same.text.includes('€'), 'keine Preise im Lieferschein');

  note.deliverySameAsBilling = false;
  note.delivery = { name: 'Lager Nord GmbH', lines: ['Hafenstraße 1', 'PL-72-100 Łozienica', 'POLEN'] };
  note.items[0].description += '\nSKU: TF-01\nEAN: 4260000000000\nCharge: 7';
  const diff = await pdfText(await renderDeliveryNote(note, assets));
  for (const s of ['Rechnungsadresse', 'Lager Nord GmbH', 'Łozienica', 'Muster Sport GmbH', 'SKU: TF-01', 'Charge: 7']) {
    assert.ok(diff.text.includes(s), `fehlt: ${s}`);
  }
  // Lieferadresse steht oben (Empfänger), Rechnungsadresse darunter
  assert.ok(diff.text.indexOf('Lager Nord GmbH') < diff.text.indexOf('Rechnungsadresse'));
});

test('PDF: optionale Kopfzeilen lassen sich abschalten', async () => {
  const note = deliveryNoteFromOffer(await offerFromFixture(), { today: '2026-10-16' });
  note.showOfferNumber = false;
  note.showCustomerVatId = false;
  const { text } = await pdfText(await renderDeliveryNote(note, assets));
  assert.ok(!text.includes('Angebotsnummer') && !text.includes('DE123456789'));
});

test('PDF: viele Positionen → Seitenumbruch mit Seitenzahlen', async () => {
  const note = deliveryNoteFromOffer(await offerFromFixture(), { today: '2026-10-16' });
  for (let i = 0; i < 20; i++) note.items.push({ title: `Artikel ${i + 3}`, description: 'Zeile A\nZeile B', quantity: '10', unit: 'Karton' });
  const { pages, text } = await pdfText(await renderDeliveryNote(note, assets));
  assert.ok(pages >= 2);
  assert.ok(text.includes(`Seite 1/${pages}`) && text.includes(`Seite ${pages}/${pages}`));
  assert.ok(text.includes('Artikel 22'));
});

test('PDF: deterministisch (gleiche Eingabe → gleiche Bytes)', async () => {
  const note = deliveryNoteFromOffer(await offerFromFixture(), { today: '2026-10-16' });
  const hash = async () => createHash('sha256').update(await renderDeliveryNote(note, assets)).digest('hex');
  assert.equal(await hash(), await hash());
});

test('PDF: Zeichen außerhalb der Schrift brechen nichts', async () => {
  const note = deliveryNoteFromOffer(await offerFromFixture(), { today: '2026-10-16' });
  note.items[0].title = 'Flasche 😀 中文';
  const { text } = await pdfText(await renderDeliveryNote(note, assets));
  assert.ok(text.includes('Flasche'));
});
