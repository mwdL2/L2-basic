#!/usr/bin/env node
// Erzeugt anonymisierte Test-Angebote im Aufbau der echten (Qonto-)Angebote.
// Wie das Original wird das PDF von Chromium gedruckt, d. h. die Textbausteine
// entstehen auf dieselbe Weise. Benötigt Playwright (nur für Entwickler):
//   npm run fixtures   (ggf. vorher: npm i -D playwright)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CASES } from './cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = join(root, 'test/fixtures');
const tmpDir = join(here, '.tmp');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cssStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ')}"`;

function html(c, company) {
  const fonts = pathToFileURL(join(root, 'public/fonts')).href;
  const logo = pathToFileURL(join(root, 'public/img/logo.png')).href;
  const footLeft = [
    company.name,
    'Musterstraße 1,',
    '12345 Musterstadt, DE',
    company.email,
    `Registergericht: Musterstadt · ${company.register}`,
  ].join('\n');
  const footMid = [
    'Geschäftsführung: Max Mustermann',
    `Steuernummer: ${company.steuernummer}`,
    `USt-IDNr. ${company.ustId}`,
  ].join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: Fx; src: url('${fonts}/Lexend-Regular.ttf'); font-weight: 400; }
@font-face { font-family: Fx; src: url('${fonts}/Lexend-Bold.ttf'); font-weight: 600; }
@page {
  size: 792px 1124px; margin: 40px 0 150px 0;
  @bottom-left { content: ${cssStr(footLeft)}; white-space: pre; font: 7.5px/11px Fx; color: #444; padding-left: 84px; vertical-align: top; padding-top: 34px; width: 216px; }
  @bottom-center { content: ${cssStr(footMid)}; white-space: pre; font: 7.5px/11px Fx; color: #444; vertical-align: top; padding-top: 34px; text-align: left; }
  @bottom-right { content: "Seite " counter(page) "/" counter(pages); font: 7.5px Fx; color: #444; vertical-align: top; padding-top: 6px; padding-right: 60px; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 84px; font: 10px/16px Fx; color: #222; }
header { display: flex; justify-content: space-between; align-items: flex-start; height: 150px; }
h1 { font-size: 22px; font-weight: 600; margin: 40px 0 0; }
header img { width: 110px; margin-top: 40px; }
.sender { font-size: 7.5px; margin: 0 0 20px; }
.top { display: grid; grid-template-columns: 337px 1fr; }
.name { font-size: 11px; font-weight: 600; margin-bottom: 10px; }
.addr div { line-height: 10px; }
.meta td { padding: 0 0 6px; } .meta td:first-child { font-weight: 600; width: 110px; }
p { margin: 0 0 16px; }
.intro { margin-top: 22px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 18px; }
table.items th { background: #1fa7aa; color: #fff; font-weight: 600; text-align: right; padding: 8px 12px; }
table.items th:first-child, table.items td:first-child { text-align: left; }
table.items td { padding: 18px 12px; border-bottom: 1px solid #ddd; vertical-align: middle; text-align: right; }
table.items td:first-child div { line-height: 16px; }
tr { break-inside: avoid; }
.sum { width: 50%; margin-left: 50%; border-collapse: collapse; margin-top: 8px; }
.sum td { padding: 10px 12px; } .sum td:first-child { font-weight: 600; } .sum td:last-child { text-align: right; }
.sum tr.total td { background: #eef8f8; font-weight: 600; }
.after { margin-top: 24px; }
</style></head><body>
<header><h1>Angebot</h1><img src="${logo}" alt=""></header>
<div class="sender">${esc(company.name)} · Musterstraße 1, 12345 Musterstadt, DE</div>
<div class="top">
  <div><div class="name">${esc(c.customer.name)}</div><div class="addr">${c.customer.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>
  <table class="meta">${c.meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
</div>
<p class="intro">Gerne bieten wir die unten aufgeführten Artikel zu folgenden Preisen an.</p>
${c.notes.map((n) => `<p>${esc(n)}</p>`).join('')}
<table class="items">
  <thead><tr><th>Artikel</th><th>Menge</th><th>Einzelpreis</th><th>MwSt. (%)</th><th>Nettobetrag</th></tr></thead>
  <tbody>${c.items
    .map(
      (it) =>
        `<tr><td>${[it.title, ...it.description].map((l) => `<div>${esc(l)}</div>`).join('')}</td><td>${esc(it.quantity)}</td><td>${esc(it.unitPrice)}</td><td>${esc(it.vat)}</td><td>${esc(it.net)}</td></tr>`,
    )
    .join('')}</tbody>
</table>
<table class="sum">
  <tr><td>Nettobetrag</td><td>${esc(c.totals.net)}</td></tr>
  <tr><td>MwSt.-Betrag insgesamt</td><td>${esc(c.totals.vat)}</td></tr>
  <tr class="total"><td>Gesamt (inkl. MwSt.)</td><td>${esc(c.totals.gross)}</td></tr>
</table>
<div class="after">
  <p>${esc(c.validity)}</p>
  ${c.payment.length ? `<div>Zahlungsbedingungen:</div>${c.payment.map((l) => `<div>${esc(l)}</div>`).join('')}` : ''}
  ${c.closing.map((l) => `<p style="margin-top:16px">${esc(l)}</p>`).join('')}
</div>
</body></html>`;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    try {
      // ESM ignoriert NODE_PATH – globale Installation über require auflösen
      const require = createRequire(import.meta.url);
      const paths = (process.env.NODE_PATH || '').split(':').filter(Boolean);
      ({ chromium } = require(require.resolve('playwright', { paths })));
    } catch {
      console.error('Playwright fehlt: npm i -D playwright (oder NODE_PATH auf eine globale Installation setzen).');
      process.exit(1);
    }
  }
  const company = JSON.parse(readFileSync(join(root, 'public/firmendaten.example.json'), 'utf8'));
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  for (const c of CASES) {
    const file = join(tmpDir, c.file.replace(/\.pdf$/, '.html'));
    writeFileSync(file, html(c, company.firma));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: join(outDir, c.file), printBackground: true, preferCSSPageSize: true });
    console.log('✓', c.file);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
