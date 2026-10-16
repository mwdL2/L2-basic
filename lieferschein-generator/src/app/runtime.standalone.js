// Laufzeit für die Einzeldatei-Variante (Lieferschein-Generator.html):
// läuft per Doppelklick von der Festplatte (file://), ohne Server und ohne
// Netzwerk. Schriften und Bilder stecken als Base64 im Code, pdf.js arbeitet
// ohne separaten Worker im Haupt-Thread (globalThis.pdfjsWorker).
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import regular from '../../public/fonts/LexendTPC-Regular.ttf?inline';
import bold from '../../public/fonts/Lexend-Bold.ttf?inline';
import footerRegular from '../../public/fonts/Roboto-Regular.ttf?inline';
import footerBold from '../../public/fonts/Roboto-Bold.ttf?inline';
import pressLogos from '../../public/img/presse-logos.png?inline';

globalThis.pdfjsWorker = pdfjsWorker;

const EMBEDDED = { regular, bold, footerRegular, footerBold, pressLogos };

/** data:…;base64,… → Uint8Array (ohne fetch, damit keine Verbindung nötig ist) */
function decode(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadAssets() {
  return Object.fromEntries(Object.entries(EMBEDDED).map(([key, url]) => [key, decode(url)]));
}

export { pdfjsLib };
