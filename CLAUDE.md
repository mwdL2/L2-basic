# AB-Generator – Hinweise für Claude

Internes Tool von Lab2. GmbH („the product company.“): liest ein **Angebot als PDF** (erzeugt mit Qonto) ein und
erzeugt daraus die **Auftragsbestätigung (AB) als PDF** im bisherigen Google-Docs-Layout. Läuft komplett im
Browser: kein Server, keine Datenbank, kein Upload, kein localStorage. Sprache von UI, Code-Kommentaren und
Commits: Deutsch.

## Befehle

```bash
npm install
npm run dev            # Entwicklungsserver (Vite)
npm test               # node --test, 38 Tests
npm run build          # statische Website → dist/
npm run build:single   # eine HTML-Datei mit allem → dist/AB-Generator.html (läuft per Doppelklick)
npm run convert -- angebot.pdf [aus.pdf] [--datum=JJJJ-MM-TT] [--json]   # Kommandozeile
npm run fixtures       # Test-Angebote neu erzeugen (braucht Playwright + Chromium)
```

Nach Änderungen immer `npm test` und, bei Oberflächen-Änderungen, `npm run build` ausführen.

## Aufbau

- `src/core/` – umgebungsneutral (Browser **und** Node): keine DOM-APIs; pdf.js wird als Parameter übergeben.
  - `pdfText.js` PDF → Textbausteine mit Koordinaten → Zeilen/Zellen
  - `parseLayout.js` Strategie A (Layout: Beschriftungen + Spaltenköpfe als Anker, keine festen Koordinaten)
  - `parseText.js` Strategie B (Textmuster; auch für eingefügten Text, zeilen- und spaltenweise kopiert)
  - `merge.js` feldweise Zusammenführung: Status `ok | warn | missing | empty`, Quelle, Rechenprüfungen
  - `abModel.js` Firmendaten-Konfiguration, Formularzustand, Dokumentmodell, AB-Nummer
  - `renderAB.js` AB-PDF mit pdf-lib; Maße aus der Muster-AB vermessen (`LAYOUT`)
  - `decimal.js` exakte Dezimalrechnung (BigInt), deutsches Zahlenformat
- `src/main.js`, `src/app/` – Oberfläche ohne Framework; Inhalte aus PDFs nur über `textContent`/`value`.
- `tools/convert.mjs` (CLI), `tools/build-single.mjs` (Einzeldatei).
- `public/` – Schriften (Lexend, Roboto; OFL), Logo, `firmendaten.example.json`.

Erkennungskette: PDF-Layout → Textmuster → Dateiname → eingefügter Text → manuell. Ergebnisse beider
Strategien werden verglichen; Abweichungen → „bitte prüfen“, nie stilles Übernehmen.

## Wichtige Regeln

- **Deterministisch:** gleiche Eingaben → byte-identisches PDF (fester Zeitstempel = AB-Datum, feste Fontnamen
  via `customName`). Keine Zufallswerte, kein `Date.now()` im Renderer. Ein Test prüft das.
- **Datenschutz:** Die CSP in `index.html` erlaubt nur `'self'`; keine externen Requests einbauen.
- **Öffentliches Repository** (`mwdL2/L2-basic`): `public/firmendaten.json` (IBAN, Steuernummer) und echte
  Angebote/ABs **nie committen**. Sie sind in `.gitignore`. Echte Angebote für Tests nach `test/private/`.
- Testdaten nur anonymisiert (`test/fixtures-src/cases.mjs` ist die Quelle der erwarteten Werte).
- Exakte Paketversionen sind gepinnt (`--save-exact`).

## Offene Entscheidungen (beim User nachfragen)

- Schrift „LexendTPC-Regular“ und das Logo als SVG verwenden? Beides liegt auf Branch
  `claude/lucid-hawking-7zn7r3` unter `lieferschein-generator/`. Die Laufweiten sind identisch mit Lexend, es
  gibt keinen Bold-Schnitt.
- Tool nach `ab-generator/` verschieben und Gemeinsames mit dem Lieferschein-Generator in `shared/` bündeln.
  Der Lieferschein-Generator nutzt dieselben Feldnamen und Paketversionen.
