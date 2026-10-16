// Übersetzt ein gelesenes Angebot in die Daten eines Lieferscheins.
// Preise (Einzelpreis, MwSt., Nettobetrag, Summen) werden bewusst NICHT
// übernommen: Das Angebot ist nicht final, der Lieferschein enthält nur
// Artikel, Menge und Einheit.

import { DEFAULT_INTRO, DEFAULT_UNIT, DELIVERY_NOTE_PREFIX } from '../config/company.js';
import { formatGermanNumber, normalizeQuantityText, todayIso } from '../parser/format.js';

/** "A-2026-0346" → "TPC-L-2026-0346" */
export function deliveryNumberFromOffer(offerNumber) {
  const m = String(offerNumber ?? '').match(/^[A-Z]{1,5}-(\d{4}-\d{2,6})$/);
  return m ? `${DELIVERY_NOTE_PREFIX}${m[1]}` : '';
}

export function emptyAddress() {
  return { name: '', lines: [] };
}

export function emptyItem() {
  return { title: '', description: '', quantity: '', unit: DEFAULT_UNIT };
}

/**
 * @param {object} offer  Ergebnis von parseOfferPages()
 * @param {{today?: string}} [opts]  Ausstellungsdatum als ISO-String
 */
export function deliveryNoteFromOffer(offer, opts = {}) {
  const f = offer.fields;
  return {
    number: deliveryNumberFromOffer(f.offerNumber),
    issueDate: opts.today || todayIso(),
    offerNumber: f.offerNumber || '',
    showOfferNumber: true,
    customerVatId: f.customerVatId || '',
    showCustomerVatId: !!f.customerVatId,
    billing: { name: f.customerName || '', lines: [...(f.customerAddress || [])] },
    deliverySameAsBilling: true,
    delivery: emptyAddress(),
    intro: DEFAULT_INTRO,
    items: offer.items.map((it) => ({
      title: it.title || '',
      description: (it.description || []).join('\n'),
      quantity: it.quantity != null ? formatGermanNumber(it.quantity) : normalizeQuantityText(it.quantityText),
      unit: it.unit || DEFAULT_UNIT,
    })),
  };
}

/** Empfänger des Lieferscheins (oben rechts) */
export function recipientOf(note) {
  return note.deliverySameAsBilling ? note.billing : note.delivery;
}

/** Fehlende Pflichtangaben als Liste { field, message } */
export function validateDeliveryNote(note) {
  const problems = [];
  const need = (cond, field, message) => {
    if (!cond) problems.push({ field, message });
  };
  need(note.number.trim(), 'number', 'Lieferscheinnummer fehlt');
  need(/^\d{4}-\d{2}-\d{2}$/.test(note.issueDate), 'issueDate', 'Ausstellungsdatum fehlt');
  need(note.billing.name.trim(), 'billing.name', 'Name/Firma der Rechnungsadresse fehlt');
  need(note.billing.lines.some((l) => l.trim()), 'billing.lines', 'Anschrift der Rechnungsadresse fehlt');
  if (!note.deliverySameAsBilling) {
    need(note.delivery.name.trim(), 'delivery.name', 'Name/Firma der Lieferadresse fehlt');
    need(note.delivery.lines.some((l) => l.trim()), 'delivery.lines', 'Anschrift der Lieferadresse fehlt');
  }
  if (note.showOfferNumber) need(note.offerNumber.trim(), 'offerNumber', 'Angebotsnummer fehlt');
  if (note.showCustomerVatId) need(note.customerVatId.trim(), 'customerVatId', 'Kunden-USt-IDNr. fehlt');
  need(note.items.length > 0, 'items', 'Keine Positionen vorhanden');
  note.items.forEach((it, i) => {
    need(it.title.trim(), `items.${i}.title`, `Position ${i + 1}: Artikelbezeichnung fehlt`);
    need(String(it.quantity).trim(), `items.${i}.quantity`, `Position ${i + 1}: Menge fehlt`);
  });
  return problems;
}

/** Dateiname des erzeugten PDFs (wie im Muster: "TPC-L-2026-0279-2.pdf") */
export function fileNameFor(note) {
  const base = (note.number || 'Lieferschein').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `${base}.pdf`;
}
