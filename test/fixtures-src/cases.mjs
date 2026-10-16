// Anonymisierte Testfälle im Aufbau der echten Angebote (Qonto-Layout).
// Daraus erzeugt build-fixtures.mjs per Chromium die PDFs in test/fixtures/.

const shaker = {
  title: 'Sonderanfertigung Kunststoff-Shaker',
  description: ['Inkl. Logodruck', 'Inkl. Mixerball', 'Material: Weizenstroh-PP', 'Fertigungsort: China'],
};
const karton = {
  title: 'Add-on: Faltkarton',
  description: [
    'Inkl. vollflächigem Full-Color-Print',
    'Inkl. Konfektionierung',
    'Textur: Seidenmatt',
    'Passend zu Shaker',
  ],
};

export const CASES = [
  {
    file: '26-10-A-2026-0101-Musterfirma-GmbH.pdf',
    customer: { name: 'Musterkunde Sport GmbH', lines: ['Beispielweg 12 / 14', '10115 Berlin', 'Deutschland'] },
    meta: [
      ['Kunden-USt-IDNr.', 'DE123456789'],
      ['Angebotsnummer', 'A-2026-0101'],
      ['Ausstellungsdatum', '05.10.2026'],
    ],
    notes: ['Exkl. Versand'],
    items: [
      { ...shaker, quantity: '15000', unitPrice: '1,19 €', vat: '19 %', net: '17.850,00 €' },
      { ...karton, quantity: '15000', unitPrice: '0,17 €', vat: '19 %', net: '2.550,00 €' },
    ],
    totals: { net: '20.400,00 €', vat: '3.876,00 €', gross: '24.276,00 €' },
    validity: 'Dieses Angebot gilt für 30 Tage. (04.11.2026)',
    payment: ['35% Anzahlung', '65% Innerhalb von 14 Tagen nach Anlieferung'],
    closing: ['Es gelten unsere unter www.example.com/agb einsehbaren AGBs'],
  },
  {
    file: '26-10-A-2026-0102-Musterfirma-GmbH.pdf',
    customer: {
      name: 'Alpen Fitness Handels GmbH',
      lines: ['z. Hd. Frau Beispiel', 'Musterplatz 3', '6020 Innsbruck', 'Österreich'],
    },
    meta: [
      ['Angebotsnummer', 'A-2026-0102'],
      ['Ausstellungsdatum', '06.10.2026'],
    ],
    notes: [],
    items: [
      {
        title: 'Edelstahl-Dosierlöffel',
        description: ['inkl. Logo-Lasergravur', 'Farbe: Gold'],
        quantity: '250 Stk.',
        unitPrice: '2,3450 €',
        vat: '7 %',
        net: '586,25 €',
      },
      {
        title: 'Druckvorlage / Grafikservice',
        description: [],
        quantity: '1',
        unitPrice: '149,00 €',
        vat: '19 %',
        net: '149,00 €',
      },
    ],
    totals: { net: '735,25 €', vat: '69,35 €', gross: '804,60 €' },
    validity: 'Dieses Angebot gilt für 14 Tage. (20.10.2026)',
    payment: ['100% Vorkasse'],
    closing: [],
  },
  {
    file: '26-10-A-2026-0103-Musterfirma-GmbH.pdf',
    multiPage: true,
    customer: { name: 'Mehrseiten Testkunde AG', lines: ['Lange Straße 1', '20095 Hamburg', 'Deutschland'] },
    meta: [
      ['Kunden-USt-IDNr.', 'DE987654321'],
      ['Angebotsnummer', 'A-2026-0103'],
      ['Ausstellungsdatum', '07.10.2026'],
    ],
    notes: ['Exkl. Versand', 'Lieferzeit ca. 8–10 Wochen nach Druckfreigabe'],
    items: Array.from({ length: 9 }, (_, i) => {
      const qty = (i + 1) * 500;
      const cents = 95 + i * 10;
      const net = (qty * cents) / 100;
      const fmt = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return {
        title: `Testartikel ${i + 1} mit Veredelung`,
        description: [
          'Inkl. Logodruck',
          `Farbe: Pantone ${300 + i}`,
          'Material: Recycling-PP',
          ...(i % 2 ? ['Einzeln verpackt'] : []),
        ],
        quantity: String(qty),
        unitPrice: `${fmt(cents / 100)} €`,
        vat: '19 %',
        net: `${fmt(net)} €`,
      };
    }),
    payment: ['50% Anzahlung', '50% vor Auslieferung'],
    validity: 'Dieses Angebot gilt für 30 Tage. (06.11.2026)',
    closing: ['Es gelten unsere unter www.example.com/agb einsehbaren AGBs'],
  },
  {
    // Vorlage geändert: Kopfdaten ohne Beschriftungen → Ersatzstrategien müssen greifen
    file: '26-10-A-2026-0104-Musterfirma-GmbH.pdf',
    customer: { name: 'Fallback Test GmbH', lines: ['Hauptstraße 5', '80331 München', 'Deutschland'] },
    meta: [
      ['', 'A-2026-0104'],
      ['', '08.10.2026'],
    ],
    notes: [],
    items: [{ ...shaker, quantity: '2000', unitPrice: '1,45 €', vat: '19 %', net: '2.900,00 €' }],
    totals: { net: '2.900,00 €', vat: '551,00 €', gross: '3.451,00 €' },
    validity: 'Dieses Angebot gilt für 30 Tage. (07.11.2026)',
    payment: ['35% Anzahlung', '65% Innerhalb von 14 Tagen nach Anlieferung'],
    closing: [],
  },
];

// Summen für den mehrseitigen Fall berechnen
for (const c of CASES) {
  if (c.totals) continue;
  const toCents = (s) => Math.round(Number(s.replace(/[^\d,]/g, '').replace(',', '.')) * 100);
  const net = c.items.reduce((a, it) => a + toCents(it.net), 0);
  const vat = Math.round(net * 0.19);
  const fmt = (v) => (v / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  c.totals = { net: fmt(net), vat: fmt(vat), gross: fmt(net + vat) };
}
