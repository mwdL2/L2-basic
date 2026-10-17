# Lieferschein-Generator – Hinweise für Claude

Internes Tool von Lab2 GmbH / the product company (TPC): liest ein Angebot (PDF) und
erzeugt daraus einen Lieferschein (PDF) im Design des Musters `TPC-L-2026-0279-2`.
Läuft komplett im Browser, keine Daten verlassen den Rechner. Benutzer-Doku: `README.md`.

## Befehle

```bash
npm install
npm run dev          # Vite-Dev-Server, http://localhost:5173
npm test             # node:test, 18 Tests (einer nur mit OFFER_PDF=/pfad/angebot.pdf)
npm run build        # statische Web-Version → dist/
npm run build:html   # eine Datei für Doppelklick/offline → dist-standalone/Lieferschein-Generator.html
node scripts/build-logo.mjs   # nur nach Änderung von assets/tpc-logo-wortmarke.svg
```

Vor jedem Commit: `npm test` und `npm run build` müssen durchlaufen.

## Aufbau

- `src/parser/` – Angebot lesen. `pdf-text.js` (pdf.js → Zeilen/Zellen mit Koordinaten),
  `offer-parser.js` (Stufen: Layout → Textmuster → Dateiname), `offer-text.js`
  (eingefügter Text, zeilen- und spaltenweise), `format.js` (deutsche Zahlen/Daten).
- `src/delivery-note/model.js` – Angebot → Lieferschein-Daten, Nummer `A-2026-0346` →
  `TPC-L-2026-0346`, Validierung, Dateiname.
- `src/pdf/` – `render.js` (pdf-lib), `layout.js` (alle Maße, gemessen am Muster, y =
  Grundlinie von oben), `logo-paths.js` (generiert aus dem SVG).
- `src/main.js`, `src/styles.css`, `index.html` – Oberfläche; `src/app/runtime.js`
  (Web: pdf.js-Worker, Assets per fetch) bzw. `runtime.standalone.js` (Einzeldatei:
  alles eingebettet, pdf.js im Haupt-Thread) – per Vite-Alias im Modus `standalone`.
- `src/config/company.js` – Absender, Bank, Steuerdaten, Nummernpräfix.
- `public/fonts` – LexendTPC-Regular (Hausschrift, vom Kunden), Lexend-Bold und Roboto
  (Google Fonts, OFL). `public/img/presse-logos.png` aus dem Muster.
- `test/helpers/offer-fixture.js` – erzeugt synthetische Angebots-PDFs im Original-Layout.

## Feste Regeln

- **Keine Preise im Lieferschein.** Der Parser liest Preise/Summen (gemeinsames
  Datenmodell), `deliveryNoteFromOffer()` übernimmt sie nie. Test prüft „kein €“.
- **Deterministisch:** gleiche Eingabe → gleiches Parser-Ergebnis und byte-identisches
  PDF (keine Zufallswerte, keine Uhrzeit, feste Font-Namen). Nicht aufweichen.
- **Datenmodell des Parsers** (`fields.offerNumber`, `offerDate`, `customerVatId`,
  `customerName`, `customerAddress[]`, `items[{title, description[], quantity, unit,
  unitPrice, vatRate, net, flags}]`, `totals`, `sources`) ist mit dem Schwester-Tool
  **AB-Generator** (Angebot → Auftragsbestätigung, Branch `claude/cool-carson-te0c54`)
  abgestimmt. Feldnamen nur gemeinsam ändern.
- **Design = Muster:** Layout-Werte stehen ausschließlich in `src/pdf/layout.js`.
  Abgleich: Muster und Ausgabe mit `pdftoppm -r 100` rendern und überlagern.
- **Datenschutz:** keine externen Requests, kein localStorage/Cookies. CSP-Meta in
  `index.html` (Web) bzw. in `scripts/build-standalone.mjs` (Einzeldatei) beibehalten.
  Texte aus PDFs nur per `textContent`/`value` ins DOM, nie als HTML.
- Keine echten Kunden-PDFs einchecken – Tests nutzen synthetische Angebote.
- Paketversionen sind exakt gepinnt (gleich wie AB-Generator): pdfjs-dist 6.3.289,
  pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, vite 8.3.1.

## Bekannte Punkte

- Fetter Schnitt: nur `LexendTPC-Regular.ttf` vorhanden; Bold kommt von Google Lexend
  (metrisch identisch). Liegt `LexendTPC-Bold.ttf` vor: in `public/fonts/` ablegen,
  `ASSET_FILES.bold` in `src/pdf/render.js`, Import in `runtime.standalone.js` und
  `@font-face` in `index.html` anpassen.
- Vorschlag (noch nicht umgesetzt): gemeinsamer Ordner `shared/` mit dem AB-Generator
  für Parser, Schriften, Logo und Styles.
- claude.ai-Vorschau: Dort sind Link-Downloads gesperrt; `download()` in `main.js`
  nutzt dann `window.claude.use('downloads')`. Die Artifact-Plattform lehnt JS mit
  rohen Steuerzeichen/U+FFFD ab – vor dem Hochladen in `\xNN`/`\uXXXX` umschreiben.
