// Optional: echte Angebote lokal prüfen, ohne sie ins Repository zu legen.
// Einfach PDFs nach test/private/ kopieren (Ordner ist in .gitignore) und
// `npm test` ausführen. Verwendet public/firmendaten.json, falls vorhanden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePdf } from '../src/core/pipeline.js';
import { loadConfig } from '../tools/convert.mjs';
import { pdfjs, root } from './helpers.js';

const dir = join(root, 'test/private');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.pdf$/i.test(f)) : [];
const { config } = loadConfig();

test('Echte Angebote (test/private/)', { skip: files.length ? false : 'keine Dateien in test/private/' }, async (t) => {
  for (const file of files) {
    await t.test(file, async () => {
      const { draft } = await analyzePdf(pdfjs, new Uint8Array(readFileSync(join(dir, file))), {
        fileName: file,
        config,
      });
      for (const check of draft.checks) assert.ok(check.ok, `${check.label}: ${check.detail}`);
      for (const [key, f] of Object.entries(draft.fields)) assert.ok(f.status !== 'missing', `${key} fehlt`);
      assert.equal(draft.items.status, 'ok', draft.items.note);
    });
  }
});
