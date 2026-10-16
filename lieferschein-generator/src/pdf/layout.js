// Maße des Muster-Lieferscheins TPC-L-2026-0279-2 (A4, 596 × 842 pt).
// Alle y-Werte sind Grundlinien, gemessen von der OBERKANTE der Seite;
// ermittelt mit pdf.js/pdfplumber aus dem Original.

export const PAGE = { width: 596, height: 842 };

export const COLORS = {
  teal: [31 / 255, 167 / 255, 170 / 255], // #1FA7AA (Labels, Tabellenkopf)
  text: [0, 0, 0],
  soft: [29 / 255, 29 / 255, 27 / 255], // #1D1D1B (Einleitungssatz, HRB)
  footer: [0.6, 0.6, 0.6], // #999999
  white: [1, 1, 1],
};

export const LEFT = 28.35;
export const VALUE_X = 208.35;
export const RIGHT_EDGE = 567.65;

export const TITLE = { text: 'Lieferschein', size: 32, baseline: 104 };

export const META = { firstBaseline: 147.25, step: 17.25, size: 12 };

export const ADDRESS = {
  gapAfterMeta: 36.5, // letzte Meta-Zeile → Firmenname
  senderNameSize: 14,
  nameSize: 12,
  nameStep: 14.5, // falls ein langer Name umbricht
  firstLineGap: 17.13, // Firmenname → erste Adresszeile
  lineSize: 11,
  lineStep: 15.81,
  blockGap: 31.62, // zwei Zeilen Abstand zwischen Blöcken
};

export const INTRO = { size: 11, gap: 31.63 };

export const TABLE = {
  gapAfterIntro: 20.62, // Grundlinie Einleitung → Oberkante Tabellenkopf
  headerHeight: 24,
  headerBaseline: 16, // ab Oberkante Kopf
  headerSize: 10,
  columns: [
    { key: 'article', label: 'Artikel', x0: 28.35, x1: 302.1 },
    { key: 'quantity', label: 'Menge', x0: 302.1, x1: 383.1 },
    { key: 'unit', label: 'Einheit', x0: 383.1, x1: 523.35 },
  ],
  borderX: [28.5, 302.5, 383.5, 523.5],
  borderWidth: 1,
  inset: 5.25,
  firstRowBaseline: 18.25, // ab Unterkante Kopf
  size: 10.5,
  lineStep: 13.125,
  itemGap: 13.125, // eine Leerzeile zwischen zwei Positionen
  underlineOffset: 1.4,
  underlineThickness: 0.75,
};

export const LOGO = { x: 490.88, top: 22.31, width: 76.95 };

export const FOOTER = {
  pressLogos: { x: 138.94, top: 759.84, width: 273.75, height: 21.75 },
  centerX: 275.8,
  baselines: [796.17, 809.97, 823.78],
  size: 10,
  pageNumber: { baseline: 750, size: 9 },
};

// Tiefste Grundlinie für Tabelleninhalt (darunter folgt die Fußzeile)
export const CONTENT_BOTTOM = 735;

// Folgeseiten: kleiner Kopf statt großem Titel
export const CONTINUATION = { titleBaseline: 50, titleSize: 14, tableTop: 80 };
