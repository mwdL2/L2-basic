#!/usr/bin/env node
// Kommandozeilen-Variante (Fallback ohne Browser, z. B. für Tests oder Stapelverarbeitung):
//   node tools/convert.mjs <angebot.pdf> [ausgabe.pdf] [--datum=2026-10-16] [--json]
// Bricht ab, wenn Pflichtfelder fehlen – dann bitte die Web-Oberfläche verwenden.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyzePdf } from '../src/core/pipeline.js';
import { normalizeConfig, draftToForm, validateForm, formToDocument, fileNameFor } from '../src/core/abModel.js';
import { renderAbPdf } from '../src/core/renderAB.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(path) {
  const candidates = [path, join(root, 'public/firmendaten.json'), join(root, 'public/firmendaten.example.json')];
  const file = candidates.find((p) => p && existsSync(p));
  return { config: normalizeConfig(JSON.parse(readFileSync(file, 'utf8'))), file };
}

export function loadAssets(config) {
  const font = (name) => readFileSync(join(root, 'public/fonts', name));
  const logoPath = join(root, 'public', config.ab.logo || 'img/logo.png');
  return {
    fonts: {
      lexendRegular: font('Lexend-Regular.ttf'),
      lexendBold: font('Lexend-Bold.ttf'),
      robotoRegular: font('Roboto-Regular.ttf'),
      robotoBold: font('Roboto-Bold.ttf'),
    },
    logo: existsSync(logoPath) ? readFileSync(logoPath) : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [key, ...value] = a.slice(2).split('=');
        return [key, value.length ? value.join('=') : true];
      }),
  );
  const [input, output] = args.filter((a) => !a.startsWith('--'));
  if (!input) {
    console.error(
      'Aufruf: node tools/convert.mjs <angebot.pdf> [ausgabe.pdf] [--datum=JJJJ-MM-TT] [--json] [--config=pfad]',
    );
    process.exit(2);
  }
  const { config, file } = loadConfig(flags.config);
  const { draft, noText } = await analyzePdf(pdfjs, new Uint8Array(readFileSync(input)), {
    fileName: basename(input),
    config,
  });
  if (flags.json) {
    console.log(JSON.stringify(draft, null, 2));
    return;
  }
  const form = draftToForm(draft, config, flags.datum);
  const check = validateForm(form);
  for (const c of draft.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`);
  for (const [k, f] of Object.entries(draft.fields))
    if (f.status === 'warn' || f.status === 'missing') console.log(`! ${k}: ${f.status} ${f.note}`);
  if (noText || !check.ok) {
    console.error('Nicht alle Pflichtfelder erkannt:', check.errors);
    process.exit(1);
  }
  const pdf = await renderAbPdf(formToDocument(form, config), loadAssets(config));
  const target = output || fileNameFor(form, config);
  writeFileSync(target, pdf);
  console.log(`→ ${target} (Firmendaten: ${basename(file)})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
