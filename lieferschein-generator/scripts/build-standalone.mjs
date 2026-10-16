// Baut den Lieferschein-Generator als EINE HTML-Datei, die per Doppelklick
// von der Festplatte läuft (file://): Code, Styles, Schriften, Logo und
// pdf.js stecken in der Datei, eine CSP sperrt jede Netzwerkverbindung.
//   npm run build:html  →  dist-standalone/Lieferschein-Generator.html
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist-standalone/`;

await build({ root, mode: 'standalone', logLevel: 'warn' });

let html = readFileSync(`${out}index.html`, 'utf8');
const assets = readdirSync(`${out}assets`);
const read = (name) => readFileSync(`${out}assets/${name}`, 'utf8');

const jsFiles = assets.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`Erwartet genau ein JS-Bundle, gefunden: ${jsFiles.join(', ')}`);

// Skript inline: "</script" und "<!--" dürfen im Skripttext nicht vorkommen.
// In Strings, Template-Strings und Regex ist "<\/" gleichbedeutend mit "</".
let js = read(jsFiles[0]);
js = js.replace(/<\/(script)/gi, '<\\/$1');
if (/<!--/.test(js)) js = js.replace(/<!--/g, '<\\!--');

html = html.replace(/<script type="module"[^>]*src="[^"]+"><\/script>/, () => `<script type="module">${js}</script>`);
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)">/g, (_, name) => `<style>${read(name)}</style>`);

// Schriften der Oberfläche als data:-URI
html = html.replace(/url\((?:'|")?fonts\/([\w.-]+\.ttf)(?:'|")?\)/g, (_, name) => {
  const b64 = readFileSync(`${root}public/fonts/${name}`).toString('base64');
  return `url(data:font/ttf;base64,${b64})`;
});

// CSP für die Einzeldatei: nur eingebetteter Code, keine Verbindungen nach außen
const csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'";
html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>/, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);

if (/(?:src|href)="\.\/assets\//.test(html) || /url\(fonts\//.test(html)) throw new Error('Nicht alle Dateien wurden eingebettet.');

rmSync(`${out}assets`, { recursive: true, force: true });
rmSync(`${out}index.html`);
writeFileSync(`${out}Lieferschein-Generator.html`, html);
console.log(`dist-standalone/Lieferschein-Generator.html (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
