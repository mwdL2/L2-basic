# Lieferschein-Generator

Erzeugt aus einem Lab2-Angebot (PDF) den passenden **Lieferschein (PDF)** im Design
des Muster-Lieferscheins `TPC-L-2026-0279-2`. Läuft vollständig im Browser: kein
Server, kein Upload, keine Speicherung (CSP sperrt Verbindungen zu fremden Servern).

Schwester-Tool: **AB-Generator** (Angebot → Auftragsbestätigung, Repo-Root bzw.
Branch `claude/cool-carson-te0c54`). Oberfläche, Ablauf, Datenmodell des Parsers und
Bibliotheksversionen sind bewusst identisch, damit beide Tools später einen
gemeinsamen Kern (`shared/`) nutzen können.

## Bedienung

1. Angebot als PDF in das Feld ziehen (oder auswählen).
2. Erkannte Angaben prüfen – jedes Feld zeigt seine Herkunft
   (`✓ aus Angebot`, `! bitte prüfen`, `✕ fehlt – bitte ergänzen`, `✎ manuell geändert`).
3. Optional:
   - **Haken „Lieferadresse entspricht der Rechnungsadresse“ entfernen** → abweichende
     Lieferadresse eingeben. Sie steht dann oben rechts als Empfänger; die
     Rechnungsadresse aus dem Angebot erscheint zusätzlich als eigener Block
     „Rechnungsadresse“.
   - **„✎ Artikel bearbeiten / Beschreibung ergänzen“** je Position → Bezeichnung und
     Beschreibung der Artikelspalte ändern (z. B. SKU, EAN, Charge ergänzen).
     „Auf Angebot zurücksetzen“ stellt den Originaltext wieder her.
   - Menge/Einheit anpassen (z. B. Teillieferung), Positionen sortieren, entfernen, hinzufügen.
   - Angebotsnummer und Kunden-USt-IDNr. auf dem Lieferschein ein-/ausblenden.
4. „Lieferschein als PDF herunterladen“ → Datei `TPC-L-JJJJ-NNNN.pdf`.

Ausweichwege, falls das PDF nicht gelesen werden kann: **Text einfügen** (aus dem
PDF-Viewer kopiert) oder **Manuell ausfüllen**.

## Was übernommen wird

| Lieferschein                 | Quelle im Angebot                                     |
| ---------------------------- | ----------------------------------------------------- |
| Lieferscheinnummer           | Angebotsnummer `A-2026-0346` → `TPC-L-2026-0346` (änderbar) |
| Ausstellungsdatum            | heute (änderbar), Format `TT/MM/JJJJ` wie im Muster   |
| Angebotsnummer, Kunden-USt-IDNr. | Kopfdaten des Angebots (abschaltbar)              |
| Empfänger / Rechnungsadresse | Kundenadresse des Angebots                            |
| Artikel (fett, unterstrichen) + Beschreibung | erste Zeile + Folgezeilen der Position |
| Menge                        | Menge der Position (`15000` → `15.000`)               |
| Einheit                      | Einheit aus dem Angebot, sonst „Stück“                |

**Nicht übernommen:** Einzelpreis, MwSt., Nettobetrag, Summen – das Angebot ist nicht
final. Ein Test stellt sicher, dass kein `€` im Lieferschein landet.

Absenderblock und Fußzeile (Bank, USt-IdNr., Steuernummer, Pressezeile) kommen aus
`src/config/company.js` bzw. `public/img/presse-logos.png` – 1:1 wie im Muster.

## Erkennung (deterministisch, mehrstufig)

1. **PDF-Layout** (`src/parser/offer-parser.js`): pdf.js liefert Text mit Positionen.
   Kopfdaten über Label → Wert rechts daneben; Empfänger = linker Block unter der
   Absenderzeile; Tabelle über die Kopfzeile *Artikel / Menge / …*. Positionen werden
   an den größten vertikalen Abständen getrennt (genau eine Menge je Position) und
   auf Plausibilität geprüft; mehrseitige Tabellen werden unterstützt.
2. **Textmuster**: reguläre Ausdrücke über den reinen Text für alles, was Stufe 1
   nicht gefunden hat.
3. **Dateiname**: Angebotsnummer z. B. aus `26-10-A-2026-0346-Lab2-GmbH.pdf`.
4. **Manuell**: Was danach fehlt, ist rot markiert; nur diese Felder müssen ergänzt
   werden. Der Download ist gesperrt, solange Pflichtangaben fehlen.

Das Ergebnisformat (`fields.offerNumber`, `offerDate`, `customerVatId`, `customerName`,
`customerAddress[]`, `items[{ title, description[], quantity, unit, unitPrice, vatRate, net, flags }]`)
entspricht dem AB-Generator.

## PDF-Ausgabe

`src/pdf/render.js` (pdf-lib) mit Maßen aus dem Muster (`src/pdf/layout.js`, per
pdf.js/pdfplumber gemessen; im Überlagerungsvergleich mit dem Muster weichen bei
100 dpi nur einzelne Glyphen um ≤ 1 px ab – Kerning-Unterschiede zu Google Docs):

- Schriften: **LexendTPC-Regular** (Vorgabe) für Normaltext, **Lexend Bold** (Google
  Fonts, metrisch identisch) für Fettes, **Roboto** in der Fußzeile – alle eingebettet (OFL).
- Logo: `assets/tpc-logo-wortmarke.svg` als Vektor (`node scripts/build-logo.mjs`
  erzeugt daraus `src/pdf/logo-paths.js`).
- Lange Texte werden umbrochen, Positionen nicht zerrissen, Folgeseiten mit Kopf und
  „Seite x/y“.
- Gleiche Eingabe → byte-identisches PDF.

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Parser, Modell, PDF (synthetische Angebote, keine Kundendaten im Repo)
npm run build      # statische Dateien in dist/ – auf beliebigen Webspace kopieren
```

Echtes Angebot zusätzlich prüfen (wird nicht eingecheckt):

```bash
OFFER_PDF=/pfad/zu/26-10-A-2026-0346-Lab2-GmbH.pdf npm test
```

## Aufbau

```
index.html, src/main.js, src/styles.css   Oberfläche (Stil wie AB-Generator)
src/app/                                  Assets laden, Vorschau (pdf.js → canvas)
src/parser/                               pdf-text, offer-parser (Layout+Text+Dateiname), offer-text (eingefügt)
src/delivery-note/model.js                Angebot → Lieferschein, Validierung, Nummer, Dateiname
src/pdf/                                  Layout-Maße, Renderer, Logo-Pfade
src/config/company.js                     Absender- und Fußzeilendaten
public/fonts, public/img                  Schriften (inkl. Lizenzen), Pressezeile
test/                                     node:test + Generator für synthetische Angebots-PDFs
```

## Offene Punkte

- Fetter Schnitt der Hausschrift: Es liegt nur `LexendTPC-Regular.ttf` vor. Sobald
  `LexendTPC-Bold.ttf` existiert, in `public/fonts/` ablegen und in
  `src/pdf/render.js` (`ASSET_FILES.bold`) sowie im `@font-face` in `index.html` eintragen.
- Gemeinsamen Kern mit dem AB-Generator zusammenführen (Parser, Assets, Styles).
