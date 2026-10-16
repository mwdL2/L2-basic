import { test } from 'node:test';
import assert from 'node:assert/strict';
import fontkit from '@pdf-lib/fontkit';
import { analyzePdf } from '../src/core/pipeline.js';
import { draftToForm, formToDocument } from '../src/core/abModel.js';
import { renderAbPdf, safeText, wrapText, parseMarkup } from '../src/core/renderAB.js';
import { CASES, assets, config, pdfText, pdfjs, readFixture } from './helpers.js';

async function abFor(c) {
  const { draft } = await analyzePdf(pdfjs, readFixture(c.file), { fileName: c.file, config });
  const form = draftToForm(draft, config, '2026-10-16');
  return { form, bytes: await renderAbPdf(formToDocument(form, config), assets) };
}

test('Rundlauf: Angebot → AB enthält alle übernommenen Angaben', async () => {
  const c = CASES[0];
  const { bytes } = await abFor(c);
  const [text] = await pdfText(bytes);
  for (const s of [
    'Auftragsbestätigung',
    'Auftragsbestätigungsnummer',
    'TPC-AB-2026-0101',
    '16/10/2026',
    'A-2026-0101 vom 05/10/2026',
    'Musterkunde Sport GmbH',
    'Beispielweg 12 / 14',
    'USt-IdNr.: DE123456789',
    'Gerne bestätigen wir Ihnen hiermit folgenden Lieferauftrag:',
    'Exkl. Versand',
    'Sonderanfertigung Kunststoff-Shaker',
    'Fertigungsort: China',
    '15.000',
    '1,19 €',
    '0,17 €',
    'Zahlungsbedingungen:',
    '65% Innerhalb von 14 Tagen nach Anlieferung',
    'IBAN:',
  ]) {
    assert.ok(text.replace(/\n/g, ' ').includes(s) || text.includes(s), `fehlt: ${s}`);
  }
  assert.ok(!text.includes('Deutschland\n'), 'Inland wird weggelassen');
  assert.ok(!text.includes('Dieses Angebot gilt'), 'Gültigkeitshinweis gehört nicht in die AB');
});

test('Deterministisch: gleiche Eingabe → byte-identisches PDF', async () => {
  const a = await abFor(CASES[1]);
  const b = await abFor(CASES[1]);
  assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes));
});

test('Viele Positionen → Seitenumbruch mit wiederholtem Tabellenkopf und Seitenzahlen', async () => {
  const { form } = await abFor(CASES[2]);
  form.items = [...form.items, ...form.items, ...form.items];
  const bytes = await renderAbPdf(formToDocument(form, config), assets);
  const pages = await pdfText(bytes);
  assert.ok(pages.length >= 3, `Seiten: ${pages.length}`);
  pages.forEach((p, i) => {
    assert.ok(p.includes(`Seite ${i + 1} von ${pages.length}`));
    assert.ok(p.includes('Preis pro Einheit (netto)'), `Tabellenkopf auf Seite ${i + 1}`);
    assert.ok(p.includes('IBAN:'), `Fußzeile auf Seite ${i + 1}`);
  });
  assert.ok(pages.at(-1).includes('Zahlungsbedingungen:'));
});

test('Zeichen ohne Glyphe werden ersetzt statt als Kästchen gedruckt', () => {
  const glyphs = fontkit.create(assets.fonts.lexendRegular);
  assert.equal(safeText('Müller Straße 1', glyphs), 'Müller Straße 1');
  assert.equal(safeText('东京', glyphs), '??');
  assert.equal(safeText('Tab\tund\nUmbruch', glyphs), 'Tab und Umbruch');
});

test('Zeilenumbruch und Fettdruck-Markup', () => {
  const measure = (s) => s.length;
  assert.deepEqual(wrapText('aa bb cc dd', measure, 5), ['aa bb', 'cc dd']);
  assert.deepEqual(wrapText('abcdefghij', measure, 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(parseMarkup('**BANK:** X • **IBAN:** Y'), [
    { text: 'BANK:', bold: true },
    { text: ' X • ', bold: false },
    { text: 'IBAN:', bold: true },
    { text: ' Y', bold: false },
  ]);
});
