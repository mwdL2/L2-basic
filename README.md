# AB-Generator

Firmeninternes Tool: **Angebot (PDF) rein → Auftragsbestätigung (PDF) raus.**
Läuft komplett im Browser – es gibt keinen Server, keine Datenbank, keinen Upload.

## Was es macht

1. Angebot (wie von Qonto erzeugt) per Drag & Drop laden.
2. Das Tool liest Kunde, Angebotsnummer/-datum, USt-IdNr., Hinweise (z. B. „Exkl. Versand“),
   alle Positionen (Text, Menge, Einzelpreis, MwSt.) und die Zahlungsbedingungen aus.
3. Alles wird **rechnerisch geprüft** (Menge × Preis = Betrag, Summe = Nettobetrag, MwSt., Gesamt).
4. Jedes Feld zeigt seinen Status: **✓ erkannt**, **! bitte prüfen**, **✕ fehlt**. Nur fehlende/unsichere
   Felder müssen angefasst werden – der Rest wird übernommen.
5. Live-Vorschau, dann **„AB als PDF herunterladen“** (Dateiname z. B. `TPC-AB-2026-0346.pdf`).

Das Layout der AB entspricht der bisherigen Google-Docs-Vorlage (Lexend/Roboto, Petrol `#1FA7AA`,
Logo, Tabelle, Fußzeile) – Positionen und Schriftgrößen wurden aus `TPC-AB-2026-0340.pdf` vermessen.

## Einschätzung: Ist das so machbar?

**Ja – und zwar zuverlässig**, weil die Angebote digital erzeugt werden (Qonto/Chromium) und echten,
auslesbaren Text mit Positionsangaben enthalten. Es wird keine KI und kein OCR benötigt; die Erkennung
ist **deterministisch**: gleiche Datei → gleiches Ergebnis, gleiche Eingaben → byte-identisches PDF.

| Thema           | Bewertung                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Felder auslesen | Sehr stabil. Die Erkennung orientiert sich an Beschriftungen („Angebotsnummer“, Spaltenköpfe …) und deren Position, nicht an festen Koordinaten. Längere Adressen, mehr Positionen oder mehrere Seiten sind kein Problem.                                                             |
| Kontrolle       | Jede Position und alle Summen werden nachgerechnet. Stimmt etwas nicht, wird es markiert statt still übernommen.                                                                                                                                                                      |
| Design          | Nahezu deckungsgleich mit der bisherigen AB (überlagert geprüft).                                                                                                                                                                                                                     |
| Datenschutz     | Verarbeitung nur im Browser-Tab; eine Content-Security-Policy verbietet technisch jede Verbindung zu fremden Servern. Kein localStorage, keine Cookies.                                                                                                                               |
| Risiko          | Ändert Qonto das Angebotslayout grundlegend (z. B. andere Spaltennamen), kann die Layout-Erkennung leiden. Dann greifen die Ersatzstrategien bzw. die Felder werden als „fehlt“ markiert – es entsteht nie unbemerkt eine falsche AB. Ggf. Muster in `src/core/patterns.js` anpassen. |
| Grenzen         | Eingescannte Angebote (ohne Textebene) werden erkannt, aber nicht gelesen → Text einfügen oder manuell. Bei Positionen gilt die **erste Zeile als Bezeichnung** (fett), der Rest als Beschreibung – Qonto unterscheidet beides im PDF nicht.                                          |

## Ersatzstrategien (Fallbacks)

Die Erkennung läuft in mehreren unabhängigen Stufen; jedes Feld wird einzeln zusammengeführt:

1. **PDF-Layout** – Textbausteine mit Koordinaten (Spalten, Abstände, Beschriftungen).
2. **Textmuster** – reguläre Ausdrücke auf dem reinen Text; bestätigt Stufe 1 oder springt ein, wenn
   Stufe 1 ein Feld nicht findet oder komplett abbricht.
3. **Dateiname** – Angebotsnummer aus z. B. `26-10-A-2026-0346-Lab2-GmbH.pdf`.
4. **Text einfügen** – Angebot im PDF-Viewer öffnen, alles markieren, kopieren, einfügen. Funktioniert mit
   zeilen- und spaltenweise kopiertem Text (verschiedene PDF-Viewer).
5. **Manuell** – jedes Feld ist editierbar; Positionen hinzufügen/entfernen/sortieren.

Weitere Absicherungen: Weichen die Strategien voneinander ab, wird das Feld als „bitte prüfen“ markiert
(mit Anzeige des abweichenden Werts). Zeichen, die die Schrift nicht kennt, werden ersetzt statt als Kästchen
gedruckt. Fehlt das Logo, wird ohne Logo erzeugt. Die Vorschau rendert mit pdf.js und funktioniert auch,
wenn der PDF-Viewer des Browsers per Firmenrichtlinie deaktiviert ist.

## Einrichtung

```bash
npm install
cp public/firmendaten.example.json public/firmendaten.json   # echte Firmendaten eintragen
npm run dev        # lokal starten (http://localhost:5173)
npm test           # Tests
npm run build      # fertige Website in dist/
```

### Firmendaten (`public/firmendaten.json`)

Absender, Fußzeile (mit `**fett**`-Markierung), AB-Nummernvorlage, Datumsformat, Einleitungssatz,
Standard-Einheit und Standard-Optionen. Die Datei ist in `.gitignore`, damit IBAN/Steuernummer **nicht im
öffentlichen Repository** landen. Fehlt sie, zeigt das Tool einen Hinweis und nutzt die Vorlage.

**AB-Nummer:** Da nichts gespeichert wird, kann das Tool keinen fortlaufenden Zähler führen. Standard ist
daher die eindeutige Ableitung aus der Angebotsnummer (`A-2026-0346` → `TPC-AB-2026-0346`, Vorlage
`"nummernVorlage": "TPC-AB-{jahr}-{nr}"`). Die Nummer bleibt im Formular frei änderbar.

**Optionen** (pro AB umschaltbar, Standard in `optionen`): Angebotsnummer nennen · USt-IdNr. des Kunden
drucken · „Deutschland“ weglassen · Summen drucken · weitere Hinweise (z. B. AGB-Verweis) drucken.

## Hosting

`npm run build` erzeugt einen statischen Ordner `dist/` (relative Pfade). Der kann auf **jeden Webspace**
oder z. B. Netlify / Cloudflare Pages / Vercel hochgeladen werden – es läuft dort kein Code und es werden
keine Daten gespeichert. `public/firmendaten.json` muss beim Hosting mit hochgeladen werden.

Empfehlung: Seite per Passwort/Zugriffsschutz des Hosters (Basic Auth, Cloudflare Access o. ä.) nur
intern erreichbar machen, da die Firmendaten-Datei sonst öffentlich abrufbar ist.

## Kommandozeile (optional)

```bash
node tools/convert.mjs angebot.pdf [ausgabe.pdf] [--datum=2026-10-16] [--json]
```

Bricht ab, wenn Pflichtangaben fehlen (dann die Web-Oberfläche nutzen). `--json` zeigt das komplette
Erkennungsergebnis inkl. Quelle und Status je Feld.

## Tests

- `test/fixtures/` – **anonymisierte** Test-Angebote im Qonto-Aufbau (Standard, Ausland/Einheit/7 %,
  zweiseitig, Vorlage ohne Beschriftungen) plus kopierte Textvarianten. Neu erzeugen:
  `npm run fixtures` (benötigt Playwright).
- `test/private/` – echte Angebote nur lokal ablegen (in `.gitignore`); `npm test` prüft sie automatisch.

## Aufbau

```
index.html, src/main.js      Oberfläche (ohne Framework)
src/core/pdfText.js           PDF → Textbausteine/Zeilen (pdf.js)
src/core/parseLayout.js       Strategie A: Layout
src/core/parseText.js         Strategie B: Textmuster / eingefügter Text
src/core/merge.js             Zusammenführung, Status je Feld, Rechenprüfungen
src/core/abModel.js           Firmendaten, Formular, AB-Dokumentmodell
src/core/renderAB.js          AB-PDF (pdf-lib, eingebettete Schriften)
src/core/decimal.js           exakte Dezimalrechnung (deutsches Zahlenformat)
public/                       Schriften (OFL), Logo, Firmendaten
tools/convert.mjs             Kommandozeile
```

Schriften: Lexend und Roboto, SIL Open Font License (siehe `public/fonts/`).
