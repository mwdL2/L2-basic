// Stammdaten des Absenders. Erscheinen im Absenderblock und in der Fußzeile
// des Lieferscheins (Werte 1:1 aus dem Muster TPC-L-2026-0279-2).
export const COMPANY = Object.freeze({
  name: 'Lab2. GmbH',
  street: 'Am Schlangengraben 9D',
  zipCity: '13597, Berlin',
  zipCityFooter: '13597 Berlin',
  register: 'HRB245397B',
  phone: '0159 0237 4630',
  email: 'ah@lab2.gmbh',
  bank: 'Olinda Zweigniederlassung Deutschland',
  iban: 'DE04100101238368160693',
  bic: 'QNTODEB2XXX',
  vatId: 'DE356148615',
  taxNumber: '29/409/30037',
});

// Nummernkreis: aus "A-2026-0346" (Angebot) wird "TPC-L-2026-0346" (Lieferschein).
export const DELIVERY_NOTE_PREFIX = 'TPC-L-';

export const DEFAULT_UNIT = 'Stück';
export const DEFAULT_INTRO = 'Geliefert werden folgende Waren:';
