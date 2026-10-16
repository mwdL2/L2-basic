import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { analyzePdf, analyzeText } from '../src/core/pipeline.js';
import { extractPdf, pagesToTextLines } from '../src/core/pdfText.js';
import { parseLayout } from '../src/core/parseLayout.js';
import { parseText } from '../src/core/parseText.js';
import { buildDraft } from '../src/core/merge.js';
import { parserOptions } from '../src/core/abModel.js';
import { CASES, config, expected, fixtureDir, itemCore, pdfjs, readFixture } from './helpers.js';

const LABELLED = CASES.filter((c) => c.meta.every(([label]) => label));

for (const c of CASES) {
  test(`PDF ${c.file}: alle Angaben korrekt erkannt`, async () => {
    const exp = expected(c);
    const { draft, noText } = await analyzePdf(pdfjs, readFixture(c.file), { fileName: c.file, config });
    assert.equal(noText, false);
    const f = draft.fields;
    assert.equal(f.offerNumber.value, exp.offerNumber);
    assert.equal(f.offerDate.value, exp.offerDate);
    assert.equal(f.customerVatId.value, exp.customerVatId);
    assert.equal(f.customerName.value, exp.customerName);
    assert.deepEqual(f.customerAddress.value, exp.customerAddress);
    assert.deepEqual(f.notes.value, exp.notes);
    assert.deepEqual(f.paymentTerms.value, exp.paymentTerms);
    assert.deepEqual(f.closingNotes.value, exp.closingNotes);
    assert.deepEqual(draft.items.value.map(itemCore), exp.items);
    assert.equal(draft.items.source, 'layout');
    assert.equal(draft.items.status, 'ok');
    for (const check of draft.checks) assert.ok(check.ok, `${check.label}: ${check.detail}`);
    for (const key of ['customerName', 'customerAddress', 'paymentTerms']) assert.equal(f[key].status, 'ok', key);
  });
}

test('Beschriftete Kopfdaten gelten als sicher erkannt', async () => {
  for (const c of LABELLED) {
    const { draft } = await analyzePdf(pdfjs, readFixture(c.file), { fileName: c.file, config });
    assert.equal(draft.fields.offerNumber.status, 'ok', c.file);
    assert.equal(draft.fields.offerNumber.source, 'layout', c.file);
    assert.equal(draft.fields.offerDate.status, 'ok', c.file);
  }
});

test('Fallback: Kopfdaten ohne Beschriftung → Textmuster, als „bitte prüfen“ markiert', async () => {
  const c = CASES.find((x) => x.meta.some(([label]) => !label));
  const { draft } = await analyzePdf(pdfjs, readFixture(c.file), { fileName: 'angebot.pdf', config });
  assert.equal(draft.fields.offerNumber.value, 'A-2026-0104');
  assert.equal(draft.fields.offerNumber.source, 'text');
  assert.equal(draft.fields.offerNumber.status, 'warn');
  assert.equal(draft.fields.offerDate.value, '08.10.2026');
  assert.equal(draft.fields.offerDate.status, 'warn');
});

test('Fallback: Angebotsnummer aus dem Dateinamen, wenn der Inhalt sie nicht hergibt', () => {
  const opts = parserOptions(config);
  const text = parseText(['Angebot', 'Kunde GmbH', 'Straße 1', '12345 Ort'], opts);
  text.fields.offerNumber = null;
  const draft = buildDraft({ text, fileName: '26-10-A-2026-0999-Musterfirma-GmbH.pdf' });
  assert.equal(draft.fields.offerNumber.value, 'A-2026-0999');
  assert.equal(draft.fields.offerNumber.source, 'filename');
  assert.equal(draft.fields.offerNumber.status, 'warn');
});

test('Fehlende Pflichtangaben werden als „fehlt“ markiert, der Rest bleibt erhalten', () => {
  const opts = parserOptions(config);
  const text = parseText(['Angebot', 'Angebotsnummer A-2026-0005', 'Ausstellungsdatum 01.10.2026'], opts);
  const draft = buildDraft({ text });
  assert.equal(draft.fields.offerNumber.status, 'ok');
  assert.equal(draft.fields.customerName.status, 'missing');
  assert.equal(draft.items.status, 'missing');
  assert.equal(draft.fields.customerVatId.status, 'empty', 'optionales Feld');
});

test('Strategien unabhängig: Layout und Text liefern dieselben Zahlen', async () => {
  const opts = parserOptions(config);
  for (const c of CASES) {
    const { pages } = await extractPdf(pdfjs, readFixture(c.file));
    const a = parseLayout(pages, opts);
    const b = parseText(pagesToTextLines(pages), opts);
    const nums = (r) => r.items.map((it) => [it.quantity, it.unitPrice, it.net]);
    assert.deepEqual(nums(b), nums(a), c.file);
    assert.deepEqual(b.totals.net, a.totals.net, c.file);
  }
});

test('Strategie A bricht ab → Strategie B übernimmt', async () => {
  const c = CASES[0];
  const { pages } = await extractPdf(pdfjs, readFixture(c.file));
  const text = parseText(pagesToTextLines(pages), parserOptions(config));
  const draft = buildDraft({ layout: null, text, fileName: c.file });
  assert.deepEqual(
    draft.items.value.map((it) => [it.title, it.quantity, it.unitPrice]),
    expected(c).items.map((it) => [it.title, it.quantity, it.unitPrice]),
  );
  assert.equal(draft.items.source, 'text');
  assert.equal(draft.items.status, 'warn', 'Ersatzstrategie → bitte prüfen');
});

for (const c of CASES) {
  for (const variant of ['raw', 'spalten']) {
    test(`Eingefügter Text (${variant}) ${c.file}`, () => {
      const exp = expected(c);
      const text = readFileSync(join(fixtureDir, 'paste', c.file.replace(/\.pdf$/, `.${variant}.txt`)), 'utf8');
      const { draft } = analyzeText(text, { config });
      assert.equal(draft.fields.offerNumber.value, exp.offerNumber);
      assert.equal(draft.fields.customerName.value, exp.customerName);
      assert.deepEqual(draft.fields.customerAddress.value, exp.customerAddress);
      assert.deepEqual(draft.fields.paymentTerms.value, exp.paymentTerms);
      assert.deepEqual(draft.items.value.map(itemCore), exp.items);
      for (const check of draft.checks) assert.ok(check.ok, `${check.label}: ${check.detail}`);
    });
  }
}

test('PDF ohne Text (Scan) wird erkannt', async () => {
  const doc = await PDFDocument.create();
  doc.addPage().drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: rgb(0.5, 0.5, 0.5) });
  const { noText, draft } = await analyzePdf(pdfjs, await doc.save(), { fileName: 'scan.pdf', config });
  assert.equal(noText, true);
  assert.match(draft.log.join(' '), /keinen auslesbaren Text/);
});

test('Kaputte Datei → verständlicher Fehler statt Absturz der Oberfläche', async () => {
  await assert.rejects(analyzePdf(pdfjs, new TextEncoder().encode('kein pdf'), { fileName: 'x.pdf', config }));
});
