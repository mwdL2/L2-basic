import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAbNumber,
  formatDate,
  germanToIso,
  isValidIso,
  validateForm,
  formToDocument,
  computeTotals,
  fileNameFor,
  emptyForm,
  normalizeConfig,
} from '../src/core/abModel.js';
import { config } from './helpers.js';

const baseForm = () => ({
  ...emptyForm(config, '2026-10-16'),
  abNumber: 'TPC-AB-2026-0101',
  offerNumber: 'A-2026-0101',
  offerDate: '05.10.2026',
  customerName: 'Musterkunde Sport GmbH',
  customerAddress: 'Beispielweg 12\n10115 Berlin\nDeutschland',
  customerVatId: 'DE123456789',
  paymentTerms: '100% Vorkasse',
  items: [
    {
      title: 'Shaker',
      description: 'Inkl. Logodruck',
      quantity: '15000',
      unit: 'Stück',
      unitPrice: '1,19',
      vatRate: '19',
    },
  ],
});

test('AB-Nummer wird deterministisch aus der Angebotsnummer abgeleitet', () => {
  assert.equal(deriveAbNumber('A-2026-0346'), 'TPC-AB-2026-0346');
  assert.equal(deriveAbNumber('A-2026-0346', 'AB-{nr}/{jahr}'), 'AB-0346/2026');
  assert.equal(deriveAbNumber(''), '');
  assert.equal(deriveAbNumber('Quatsch'), '');
});

test('Datumsformate', () => {
  assert.equal(formatDate('2026-09-30', 'TT/MM/JJJJ'), '30/09/2026');
  assert.equal(formatDate('2026-09-30', 'TT.MM.JJJJ'), '30.09.2026');
  assert.equal(germanToIso('9.1.2026'), '2026-01-09');
  assert.ok(isValidIso('2026-02-28'));
  assert.ok(!isValidIso('2026-02-30'));
});

test('Validierung: Pflichtfelder blockieren, Hinweise nicht', () => {
  assert.equal(validateForm(baseForm()).ok, true);
  const f = baseForm();
  f.customerName = ' ';
  f.items[0].unitPrice = 'abc';
  f.paymentTerms = '';
  const v = validateForm(f);
  assert.equal(v.ok, false);
  assert.ok(v.errors.customerName);
  assert.ok(v.errors['items.0.unitPrice']);
  assert.ok(v.warnings.paymentTerms);
  assert.ok(!v.errors.paymentTerms);
});

test('Dokumentmodell: Formatierung und Optionen', () => {
  const doc = formToDocument(baseForm(), config);
  assert.deepEqual(
    doc.meta.map((m) => m.value),
    ['TPC-AB-2026-0101', '16/10/2026', 'A-2026-0101 vom 05/10/2026'],
  );
  assert.deepEqual(doc.recipient.lines, ['Beispielweg 12', '10115 Berlin', 'USt-IdNr.: DE123456789']);
  assert.deepEqual(doc.items[0], {
    title: 'Shaker',
    description: ['Inkl. Logodruck'],
    quantity: '15.000',
    unit: 'Stück',
    unitPrice: '1,19 €',
  });
  assert.equal(doc.totals, null);

  const f = baseForm();
  Object.assign(f.options, { angebotsbezug: false, kundenUstId: false, inlandLandWeglassen: false, summen: true });
  const doc2 = formToDocument(f, config);
  assert.equal(doc2.meta.length, 2);
  assert.deepEqual(doc2.recipient.lines, ['Beispielweg 12', '10115 Berlin', 'Deutschland']);
  assert.deepEqual(
    doc2.totals.map((t) => t.value),
    ['17.850,00 €', '3.391,50 €', '21.241,50 €'],
  );
});

test('Ausland: Land bleibt in der Anschrift', () => {
  const f = baseForm();
  f.customerAddress = 'Musterplatz 3\n6020 Innsbruck\nÖsterreich';
  assert.deepEqual(formToDocument(f, config).recipient.lines.slice(0, 3), [
    'Musterplatz 3',
    '6020 Innsbruck',
    'Österreich',
  ]);
});

test('Summen mit gemischten MwSt.-Sätzen', () => {
  const rows = computeTotals([
    { quantity: '250', unitPrice: '2,3450', vatRate: '7' },
    { quantity: '1', unitPrice: '149,00', vatRate: '19' },
  ]);
  assert.deepEqual(
    rows.map((r) => `${r.label}: ${r.value}`),
    ['Nettobetrag: 735,25 €', 'zzgl. MwSt. 19 %: 28,31 €', 'zzgl. MwSt. 7 %: 41,04 €', 'Gesamtbetrag: 804,60 €'],
  );
});

test('Dateiname ist sicher', () => {
  assert.equal(fileNameFor({ abNumber: 'TPC-AB-2026-0346' }, config), 'TPC-AB-2026-0346.pdf');
  const cfg = normalizeConfig({ ab: { dateiname: '{abNummer} {kunde}.pdf' } });
  assert.equal(
    fileNameFor({ abNumber: 'TPC-AB-1', customerName: 'Müller & Söhne / GmbH' }, cfg),
    'TPC-AB-1-Muller-Sohne-GmbH.pdf',
  );
});
