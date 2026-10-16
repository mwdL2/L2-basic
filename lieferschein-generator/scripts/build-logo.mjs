// Wandelt assets/tpc-logo-wortmarke.svg in Pfaddaten für pdf-lib um
// (src/pdf/logo-paths.js). Nur nötig, wenn sich das Logo ändert:
//   node scripts/build-logo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}assets/tpc-logo-wortmarke.svg`, 'utf8');

const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
const classes = Object.fromEntries(
  [...svg.matchAll(/\.([\w-]+)\s*\{\s*fill:\s*(#[0-9a-fA-F]{3,6})\s*;?\s*\}/g)].map((m) => [m[1], m[2].toLowerCase()]),
);

const shapes = [];
for (const m of svg.matchAll(/<(path|polygon)\b([^>]*)\/?>/g)) {
  const [, tag, attrs] = m;
  const cls = attrs.match(/class="([^"]+)"/)?.[1];
  const color = classes[cls] || attrs.match(/fill="(#[0-9a-fA-F]{3,6})"/)?.[1] || '#000000';
  let d;
  if (tag === 'path') d = attrs.match(/\bd="([^"]+)"/)[1];
  else {
    const pts = attrs.match(/points="([^"]+)"/)[1].trim().split(/[\s,]+/).map(Number);
    const pairs = [];
    for (let i = 0; i < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`);
    d = `M${pairs.join(' L')} Z`;
  }
  shapes.push({ d: d.replace(/\s+/g, ' ').trim(), color });
}

const out = `// Automatisch erzeugt aus assets/tpc-logo-wortmarke.svg – nicht von Hand ändern.
// Neu erzeugen mit: node scripts/build-logo.mjs
export const LOGO_VIEWBOX = ${JSON.stringify(viewBox)};
export const LOGO_SHAPES = ${JSON.stringify(shapes, null, 2)};
`;
writeFileSync(`${root}src/pdf/logo-paths.js`, out);
console.log(`${shapes.length} Formen, Farben: ${[...new Set(shapes.map((s) => s.color))].join(', ')}`);
