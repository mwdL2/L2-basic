// Gemeinsame Muster für beide Erkennungsstrategien.

export const RE = {
  offerNumberValue: /^[A-Z]{1,5}-\d{4}-\d{2,6}$/,
  offerNumberLoose: /\b([A-Z]{1,5}-\d{4}-\d{3,6})\b/,
  date: /^\d{1,2}\.\d{1,2}\.\d{4}$/,
  dateInText: /(\d{1,2}\.\d{1,2}\.\d{4})/,
  vatId: /^[A-Z]{2}[0-9A-Z+*]{2,12}$/,
  money: /^-?\d{1,3}(?:\.\d{3})*,\d{2,4}\s*€$|^-?\d+,\d{2,4}\s*€$/,
  percent: /^\d{1,2}(?:,\d{1,2})?\s*%$/,
  quantity: /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:\s+\S.*)?$/,
  pageNumber: /^Seite\s+\d+\s*(?:\/|von)\s*\d+$/i,
  zip: /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/,
};

/** Beschriftungen im Kopfbereich des Angebots (rechte Spalte) */
export const META_LABELS = {
  customerVatId: /^Kunden-?\s?USt\.?-?\s?ID-?\s?Nr\.?:?\s*/i,
  offerNumber: /^Angebots-?\s?(?:nummer|nr\.?):?\s*/i,
  offerDate: /^(?:Ausstellungsdatum|Angebotsdatum|Datum):?\s*/i,
  validUntil: /^(?:Gültig bis|Gültigkeit):?\s*/i,
  customerNumber: /^Kunden-?\s?(?:nummer|nr\.?):?\s*/i,
};

/** Spaltenköpfe der Positionstabelle */
export const COLUMN_LABELS = {
  article: /^(Artikel|Beschreibung|Position|Leistung|Bezeichnung)\b/i,
  quantity: /^(Menge|Anzahl|Stückzahl)\b/i,
  unitPrice: /^(Einzelpreis|Stückpreis|Preis)\b/i,
  vat: /^(MwSt|USt)\b/i,
  net: /^(Nettobetrag|Betrag|Gesamt|Summe)\b/i,
};

export const SUMMARY_LABELS = {
  net: /^(Nettobetrag|Zwischensumme|Summe netto|Gesamt netto)\b/i,
  vat: /^(MwSt|USt|Umsatzsteuer|Mehrwertsteuer)/i,
  gross: /^(Gesamt|Gesamtbetrag|Endbetrag|Summe brutto|Bruttobetrag)\b/i,
  discount: /^(Rabatt|Nachlass|Skonto)/i,
};

export const PAYMENT_HEADING = /^Zahlungsbedingungen\s*:?\s*(.*)$/i;
export const VALIDITY_LINE = /(gilt für|gültig bis|Gültigkeit)/i;
/** Text nach dem Zahlungsblock, der sicher nicht mehr dazugehört */
export const CLOSING_STOP = /^(Es gelten|Dieses Angebot|Mit freundlichen|Bankverbindung|Wir freuen uns|Bei Fragen)/i;

/** Standard-Einleitung des Angebots – wird nicht in die AB übernommen */
export const DEFAULT_IGNORED_INTROS = [/^Gerne bieten wir\b/i, /^Sehr geehrte/i, /^Vielen Dank für Ihre Anfrage/i];

export const COUNTRY_NAMES =
  /^(Deutschland|Germany|DE|Österreich|Austria|AT|Schweiz|Switzerland|CH|Niederlande|Netherlands|Belgien|Frankreich|France|Italien|Spanien|Polen|Dänemark|Luxemburg)$/i;
export const HOME_COUNTRY = /^(Deutschland|Germany|DE)$/i;

export function normalizeSpaces(s) {
  return String(s ?? '')
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/[\u00a0\u202f\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVatId(s) {
  return normalizeSpaces(s).replace(/[\s.]/g, '').toUpperCase();
}

export function isMoney(s) {
  return RE.money.test(normalizeSpaces(s));
}

/** Footer-Erkennung: Zeilen mit eigenen Firmendaten (nicht Kundendaten) */
export function makeOwnDataMatcher(opts = {}) {
  const needles = [opts.ownVatId, opts.ownTaxNumber, opts.ownEmail, opts.ownRegister]
    .filter(Boolean)
    .map((s) => normalizeSpaces(s).toLowerCase());
  const generic =
    /(Registergericht|Geschäftsführ|Steuernummer|(?<!Kunden-?\s?)USt-?ID-?Nr\.?\s+DE\d|Amtsgericht|IBAN|BIC:)/i;
  const loose = (s) =>
    normalizeSpaces(
      String(s)
        .toLowerCase()
        .replace(/[.,;:·•|]/g, ' '),
    );
  const name = opts.ownCompanyName ? loose(opts.ownCompanyName) : null;
  const addressLines = (opts.ownAddressLines || []).map(loose).filter((a) => a.length >= 4);
  return (text) => {
    const t = normalizeSpaces(text).toLowerCase();
    if (generic.test(text) || needles.some((n) => n && t.includes(n))) return true;
    const l = loose(text);
    if (name && l === name) return true;
    // Adresszeilen der eigenen Firma in der Fußzeile, z. B. "13597 Berlin, DE"
    return addressLines.some(
      (a) => l === a || (l.startsWith(a) && l.length <= a.length + 4) || (a.startsWith(l) && l.length >= a.length - 4),
    );
  };
}
