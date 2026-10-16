// Ablauf: PDF → Text mit Positionen → beide Strategien (unabhängig, jeweils
// abgesichert) → feldweise Zusammenführung mit Prüfungen.

import { extractPdf, hasTextLayer, pagesToTextLines } from './pdfText.js';
import { parseLayout } from './parseLayout.js';
import { parseText } from './parseText.js';
import { buildDraft } from './merge.js';
import { parserOptions } from './abModel.js';

export async function analyzePdf(pdfjsLib, bytes, { fileName = '', config }) {
  const opts = parserOptions(config);
  const { pages } = await extractPdf(pdfjsLib, bytes);
  if (!hasTextLayer(pages)) {
    const draft = buildDraft({ fileName });
    draft.log.push('Das PDF enthält keinen auslesbaren Text (z. B. eingescannt).');
    return { draft, noText: true };
  }
  const errors = [];
  const run = (name, fn) => {
    try {
      return fn();
    } catch (err) {
      errors.push(`[${name}] Abbruch: ${err?.message || err}`);
      return null;
    }
  };
  const layout = run('PDF-Layout', () => parseLayout(pages, opts));
  const text = run('Textmuster', () => parseText(pagesToTextLines(pages), opts));
  const draft = buildDraft({ layout, text, fileName });
  draft.log.push(...errors);
  return { draft, noText: false };
}

/** Fallback: aus dem PDF kopierter und eingefügter Text */
export function analyzeText(input, { fileName = '', config }) {
  const opts = parserOptions(config);
  let text = null;
  const draft0 = [];
  try {
    text = parseText(input, opts);
  } catch (err) {
    draft0.push(`[Textmuster] Abbruch: ${err?.message || err}`);
  }
  const draft = buildDraft({ text, fileName });
  draft.log.push(...draft0);
  return { draft };
}
