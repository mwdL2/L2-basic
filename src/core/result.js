// Gemeinsames Ergebnisformat beider Erkennungsstrategien.

import { RE, normalizeSpaces } from './patterns.js';

export function emptyResult(strategy) {
  return {
    strategy,
    meta: { title: null, isOffer: false },
    fields: {
      offerNumber: null,
      offerDate: null,
      validUntil: null,
      customerVatId: null,
      customerNumber: null,
      customerName: null,
      customerAddress: null,
    },
    notes: [],
    items: [],
    totals: { net: null, vat: null, gross: null, discount: null, vatLines: [] },
    paymentTerms: null,
    validityText: null,
    closingNotes: [],
    log: [],
    weak: {}, // Felder, die nur über unsichere Muster gefunden wurden
  };
}

/** "15.000 Stk." → { number: "15.000", unit: "Stk." } */
export function splitQuantity(raw) {
  if (!raw) return null;
  const text = normalizeSpaces(raw);
  if (!RE.quantity.test(text)) return null;
  const m = text.match(/^((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)(?:\s+(.+))?$/);
  if (!m) return null;
  return { number: m[1], unit: m[2] ? m[2].trim() : null };
}
