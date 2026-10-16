// Laufzeit für den normalen Betrieb auf einem Webserver: pdf.js mit eigenem
// Worker, Schriften und Bilder werden vom selben Server nachgeladen.
// Die Einzeldatei-Variante (npm run build:html) ersetzt dieses Modul durch
// runtime.standalone.js.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export { loadAssets } from './assets.js';
