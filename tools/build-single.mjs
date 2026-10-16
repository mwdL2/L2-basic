#!/usr/bin/env node
// Baut aus dist/ eine einzige, eigenständige HTML-Datei (Programm, pdf.js-Worker,
// Schriften, Logo und Firmendaten eingebettet). Die Datei läuft per Doppelklick
// in jedem aktuellen Browser – ohne Server, ohne Installation, ohne Internet.
//   npm run build:single   →   dist/AB-Generator.html
//
// Achtung: Liegt public/firmendaten.json vor, steckt sie (inkl. IBAN/Steuernummer)
// in der Datei. Die Datei also nur intern weitergeben.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(dist, 'AB-Generator.html');

const read = (p) => readFileSync(join(dist, p));
const b64 = (p) => read(p).toString('base64');
// "</script" darf in eingebettetem Code nicht vorkommen, sonst endet das Skript-Tag
const scriptSafe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsFile = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)?.[1];
const cssFile = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)?.[1];
const workerFile = readdirSync(join(dist, 'assets')).find((f) => /^pdf\.worker.*\.mjs$/.test(f));
if (!jsFile || !cssFile || !workerFile) {
  console.error('dist/ unvollständig – bitte zuerst `npm run build` ausführen.');
  process.exit(1);
}

const config = existsSync(join(dist, 'firmendaten.json')) ? 'firmendaten.json' : null;
const inline = {
  'firmendaten.example.json': JSON.parse(read('firmendaten.example.json')),
  ...(config ? { 'firmendaten.json': JSON.parse(read(config)) } : {}),
  'pdf.worker.mjs': read(`assets/${workerFile}`).toString('utf8'),
};
for (const f of ['Lexend-Regular.ttf', 'Lexend-Bold.ttf', 'Roboto-Regular.ttf', 'Roboto-Bold.ttf']) {
  inline[`fonts/${f}`] = b64(`fonts/${f}`);
}
const logo = inline['firmendaten.json']?.ab?.logo || inline['firmendaten.example.json'].ab?.logo || 'img/logo.png';
if (existsSync(join(dist, logo))) inline[logo] = b64(logo);

const css = read(cssFile)
  .toString('utf8')
  .replace(/url\(\.\.\/fonts\/([\w-]+\.ttf)\)/g, (_, f) => `url(data:font/ttf;base64,${b64(`fonts/${f}`)})`);

// Ohne eigenen Server gibt es kein 'self' – alles ist eingebettet, Netzwerk bleibt gesperrt
const csp =
  "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; " +
  "img-src blob: data:; font-src data: blob:; connect-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

html = html
  .replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/, `$1${csp}$2`)
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${css}</style>`)
  .replace(
    /<script type="module" crossorigin src="[^"]+"><\/script>/,
    () =>
      `<script>window.__AB_INLINE__ = ${scriptSafe(JSON.stringify(inline))};</script>\n` +
      `<script type="module">${scriptSafe(read(jsFile).toString('utf8'))}</script>`,
  );

if (!html.includes('window.__AB_INLINE__') || !html.includes(csp)) {
  console.error('Einbetten fehlgeschlagen – Aufbau von dist/index.html hat sich geändert.');
  process.exit(1);
}
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB, Firmendaten: ${config || 'Vorlage'})`);
