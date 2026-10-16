import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfPages } from '../src/parser/pdf-text.js';
import { parseOfferPages } from '../src/parser/offer-parser.js';
import { parseOfferText } from '../src/parser/offer-text.js';
import { buildBlankPdf, buildOfferPdf, DEFAULT_OFFER } from './helpers/offer-fixture.js';

async function parse(bytes, fileName = 'angebot.pdf') {
  return parseOfferPages(await readPdfPages(new Uint8Array(bytes), pdfjs), { fileName });
}

test('liest Kopfdaten, Adresse und Positionen über das Layout', async () => {
  const r = await parse(await buildOfferPdf());
  assert.equal(r.meta.isOffer, true);
  assert.deepEqual(r.fields.offerNumber, 'A-2026-0999');
  assert.equal(r.fields.offerDate, '02.10.2026');
  assert.equal(r.fields.customerVatId, 'DE123456789');
  assert.equal(r.fields.customerName, 'Muster Sport GmbH');
  assert.deepEqual(r.fields.customerAddress, ['Beispielweg 12', '10115 Berlin', 'Deutschland']);
  for (const k of ['offerNumber', 'offerDate', 'customerVatId', 'customerName', 'customerAddress', 'items']) {
    assert.equal(r.sources[k], 'layout', k);
  }
  assert.equal(r.items.length, 2);
  assert.deepEqual(
    r.items.map((i) => [i.title, i.description, i.quantity]),
    [
      ['Sonderanfertigung Trinkflasche', ['Inkl. Logodruck', 'Material: Tritan'], 5000],
      ['Add-on: Faltkarton', ['Inkl. Full-Color-Print', 'Textur: Seidenmatt', 'Passend zu Flasche'], 5000],
    ],
  );
  assert.equal(r.items[0].net, '10.500,00 €');
  assert.equal(r.totals.gross, '13.685,00 €');
  assert.deepEqual(r.items.flatMap((i) => i.flags), []);
});

test('trennt viele Positionen unterschiedlicher Länge korrekt', async () => {
  const items = [
    { lines: ['Nur eine Zeile'], qty: '1', price: '1,00 €', vat: '19 %', net: '1,00 €' },
    { lines: ['Lang', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], qty: '1.920', price: '1,00 €', vat: '19 %', net: '1.920,00 €' },
    { lines: ['Zwei', 'Zeilen'], qty: '250', price: '1,00 €', vat: '7 %', net: '250,00 €' },
  ];
  const r = await parse(await buildOfferPdf({ items }));
  assert.deepEqual(
    r.items.map((i) => [i.title, i.description.length, i.quantity]),
    [
      ['Nur eine Zeile', 0, 1],
      ['Lang', 7, 1920],
      ['Zwei', 1, 250],
    ],
  );
});

test('Tabelle über mehrere Seiten mit wiederholtem Kopf', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    lines: [`Artikel ${i + 1}`, 'Beschreibung'],
    qty: String((i + 1) * 100),
    price: '1,00 €',
    vat: '19 %',
    net: '1,00 €',
  }));
  const r = await parse(await buildOfferPdf({ items, rowsPerPage: 2 }));
  assert.equal(r.meta.pages, 3);
  assert.deepEqual(
    r.items.map((i) => [i.title, i.quantity]),
    items.map((it, i) => [`Artikel ${i + 1}`, (i + 1) * 100]),
  );
});

test('fehlende USt-IdNr. bleibt leer statt falsch befüllt', async () => {
  const r = await parse(await buildOfferPdf({ vatId: null }));
  assert.equal(r.fields.customerVatId, null);
  assert.equal(r.fields.customerName, 'Muster Sport GmbH');
});

test('Fallback: Angebotsnummer ohne Label aus Text bzw. Dateiname', async () => {
  const r = await parse(await buildOfferPdf({ omitLabels: true }), '26-10-A-2026-0999-Lab2-GmbH.pdf');
  assert.equal(r.fields.offerNumber, 'A-2026-0999');
  assert.notEqual(r.sources.offerNumber, 'layout');
  const r2 = await parse(await buildOfferPdf({ omitLabels: true, offerNumber: null }), '26-10-A-2026-0777-Lab2-GmbH.pdf');
  assert.equal(r2.fields.offerNumber, 'A-2026-0777');
  assert.equal(r2.sources.offerNumber, 'filename');
});

test('PDF ohne Text wird erkannt', async () => {
  const r = await parse(await buildBlankPdf(), 'scan.pdf');
  assert.equal(r.meta.hasText, false);
  assert.equal(r.items.length, 0);
  assert.ok(r.warnings.length > 0);
});

test('eingefügter Text: zeilenweise kopiert', () => {
  const text = [
    'Angebot',
    'Lab2. GmbH · Am Schlangengraben 9D, 13597 Berlin, DE',
    'Muster Sport GmbH   Kunden-USt-IDNr.   DE123456789',
    'Beispielweg 12   Angebotsnummer   A-2026-0999',
    '10115 Berlin   Ausstellungsdatum   02.10.2026',
    'Deutschland',
    'Gerne bieten wir die unten aufgeführten Artikel zu folgenden Preisen an.',
    'Artikel   Menge   Einzelpreis   MwSt. (%)   Nettobetrag',
    'Trinkflasche',
    'Inkl. Logodruck   5000   2,10 €   19 %   10.500,00 €',
    'Material: Tritan',
    'Faltkarton',
    'Passend zu Flasche   5000   0,20 €   19 %   1.000,00 €',
    'Nettobetrag   11.500,00 €',
  ].join('\n');
  const r = parseOfferText(text);
  assert.equal(r.fields.offerNumber, 'A-2026-0999');
  assert.equal(r.fields.offerDate, '02.10.2026');
  assert.equal(r.fields.customerName, 'Muster Sport GmbH');
  assert.deepEqual(r.fields.customerAddress, ['Beispielweg 12', '10115 Berlin', 'Deutschland']);
  assert.deepEqual(
    r.items.map((i) => [i.title, i.description, i.quantity]),
    [
      ['Trinkflasche', ['Inkl. Logodruck', 'Material: Tritan'], 5000],
      ['Faltkarton', ['Passend zu Flasche'], 5000],
    ],
  );
  assert.ok(r.items.every((i) => i.flags.length > 0), 'Text-Ergebnisse sind immer "bitte prüfen"');
});

test('eingefügter Text: spaltenweise kopiert (Zahlen vor den Texten)', () => {
  const text = [
    'Angebot', '', 'Lab2. GmbH · Am Schlangengraben 9D, 13597 Berlin, DE', '', 'Muster Sport GmbH', '', 'Kunden-USt-IDNr.', '', 'DE123456789', '',
    'Beispielweg 12', '10115 Berlin', 'Deutschland', '', 'Angebotsnummer', 'Ausstellungsdatum', '', 'A-2026-0999', '02.10.2026', '',
    'Artikel', '', 'Menge', '', 'Einzelpreis', '', 'MwSt. (%)', '', 'Nettobetrag', '',
    '5000', '', '2,10 €', '', '19 %', '', '10.500,00 €', '', '5000', '', '0,20 €', '', '19 %', '', '1.000,00 €', '',
    'Trinkflasche', 'Inkl. Logodruck', '', 'Faltkarton', 'Passend zu Flasche', '', 'Nettobetrag', '', '11.500,00 €',
  ].join('\n');
  const r = parseOfferText(text);
  assert.equal(r.fields.offerDate, '02.10.2026');
  assert.deepEqual(r.fields.customerAddress, ['Beispielweg 12', '10115 Berlin', 'Deutschland']);
  assert.deepEqual(
    r.items.map((i) => [i.title, i.description, i.quantity]),
    [
      ['Trinkflasche', ['Inkl. Logodruck'], 5000],
      ['Faltkarton', ['Passend zu Flasche'], 5000],
    ],
  );
});

// Optional: echtes Angebot prüfen, ohne es einzuchecken
//   OFFER_PDF=/pfad/26-10-A-2026-0346-Lab2-GmbH.pdf npm test
const real = process.env.OFFER_PDF;
test('echtes Angebot (OFFER_PDF)', { skip: !real || !existsSync(real) }, async () => {
  const r = await parse(readFileSync(real), basename(real));
  assert.ok(r.fields.offerNumber && r.fields.customerName && r.items.length > 0);
  assert.deepEqual(r.items.flatMap((i) => i.flags), []);
  assert.equal(DEFAULT_OFFER.items.length, 2);
});
