import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal,
  formatDecimal,
  formatMoney,
  formatQuantity,
  mul,
  rescale,
  approxEqual,
  percentOf,
} from '../src/core/decimal.js';

test('deutsche Zahlen werden exakt gelesen', () => {
  assert.deepEqual(parseDecimal('17.850,00'), { u: 1785000n, s: 2 });
  assert.deepEqual(parseDecimal('1,19 €'), { u: 119n, s: 2 });
  assert.deepEqual(parseDecimal('15000'), { u: 15000n, s: 0 });
  assert.deepEqual(parseDecimal('15.000'), { u: 15000n, s: 0 });
  assert.deepEqual(parseDecimal('2,3450'), { u: 23450n, s: 4 });
  assert.deepEqual(parseDecimal('19 %'), { u: 19n, s: 0 });
  assert.deepEqual(parseDecimal('-5,50'), { u: -550n, s: 2 });
  assert.deepEqual(parseDecimal('1234.56'), { u: 123456n, s: 2 }, 'Punkt als Dezimaltrenner');
});

test('ungültige Zahlen → null', () => {
  for (const bad of ['', 'abc', '1.23.4', '1,2,3', '12.34.567', null, undefined]) {
    assert.equal(parseDecimal(bad), null, String(bad));
  }
});

test('Formatierung im deutschen Format', () => {
  assert.equal(formatQuantity(parseDecimal('15000')), '15.000');
  assert.equal(formatQuantity(parseDecimal('2,50')), '2,5');
  assert.equal(formatMoney(parseDecimal('1,19')), '1,19 €');
  assert.equal(formatMoney(parseDecimal('0,1725')), '0,1725 €');
  assert.equal(formatMoney(parseDecimal('4,3200')), '4,32 €');
  assert.equal(formatMoney(parseDecimal('1234567')), '1.234.567,00 €');
  assert.equal(formatDecimal(parseDecimal('7,0')), '7');
});

test('Rechnen ohne Rundungsfehler', () => {
  const net = rescale(mul(parseDecimal('15000'), parseDecimal('1,19')), 2);
  assert.equal(formatMoney(net), '17.850,00 €');
  const vat = rescale(percentOf(parseDecimal('586,25'), parseDecimal('7')), 2);
  assert.equal(formatMoney(vat), '41,04 €', 'kaufmännisch gerundet (41,0375)');
  assert.ok(approxEqual(parseDecimal('10,00'), parseDecimal('10,01'), 1));
  assert.ok(!approxEqual(parseDecimal('10,00'), parseDecimal('10,02'), 1));
  // 0,1 + 0,2 in Gleitkomma wäre 0.30000000000000004
  assert.equal(formatMoney(rescale(mul(parseDecimal('3'), parseDecimal('0,1')), 2)), '0,30 €');
});
