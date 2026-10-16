// Liest die Textbausteine eines PDFs mit pdf.js und fasst sie zu Zeilen und
// Zellen zusammen. Koordinaten: x von links, y = Grundlinie von OBEN (pt).
//
// Das pdf.js-Modul wird übergeben, damit derselbe Code im Browser
// (pdfjs-dist mit Worker) und in Node (legacy-Build, Tests) läuft.

import { normalizeSpaces } from './format.js';

/**
 * @param {Uint8Array} data  PDF-Bytes (wird von pdf.js übernommen – ggf. Kopie übergeben)
 * @param {object} pdfjs     pdfjs-dist-Modul
 * @returns {Promise<Array<{number:number,width:number,height:number,items:Array}>>}
 */
export async function readPdfPages(data, pdfjs) {
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (typeof it.str !== 'string') continue;
        const [, , c, d, e, f] = it.transform;
        const [x, y] = vp.convertToViewportPoint(e, f);
        items.push({
          str: it.str,
          x,
          y,
          w: it.width,
          size: Math.hypot(c, d) || it.height || 0,
          font: it.fontName || '',
        });
      }
      pages.push({ number: n, width: vp.width, height: vp.height, items });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * Textbausteine einer Seite zu Zeilen gruppieren. Jede Zeile besteht aus
 * Zellen; eine neue Zelle beginnt bei einer horizontalen Lücke, die deutlich
 * größer als ein Wortabstand ist (Tabellenspalten, Label/Wert-Paare).
 */
export function buildLines(items) {
  const visible = items
    .filter((it) => normalizeSpaces(it.str) !== '' && it.size > 0)
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);

  const rows = [];
  for (const it of visible) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row.y) <= Math.max(0.6, 0.15 * Math.max(it.size, row.size))) {
      row.items.push(it);
      row.size = Math.max(row.size, it.size);
    } else {
      rows.push({ y: it.y, size: it.size, items: [it] });
    }
  }

  return rows.map((row) => {
    const sorted = row.items.sort((a, b) => a.x - b.x || a.i - b.i);
    const cells = [];
    for (const it of sorted) {
      const cell = cells[cells.length - 1];
      const gap = cell ? it.x - cell.x1 : Infinity;
      if (cell && gap <= Math.max(1.2 * it.size, 4)) {
        const glue = gap > 0.12 * it.size && !cell.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '';
        cell.text += glue + it.str;
        cell.x1 = Math.max(cell.x1, it.x + it.w);
        cell.size = Math.max(cell.size, it.size);
      } else {
        cells.push({ x0: it.x, x1: it.x + it.w, y: it.y, size: it.size, text: it.str });
      }
    }
    for (const c of cells) c.text = normalizeSpaces(c.text);
    const kept = cells.filter((c) => c.text);
    return {
      y: row.y,
      size: row.size,
      x0: kept.length ? kept[0].x0 : 0,
      x1: kept.length ? kept[kept.length - 1].x1 : 0,
      cells: kept,
      text: kept.map((c) => c.text).join('  '),
    };
  }).filter((l) => l.cells.length);
}

/** Reiner Text (eine Zeile pro Textzeile, Zellen durch zwei Leerzeichen getrennt) */
export function pagesToText(pages) {
  return pages.map((p) => buildLines(p.items).map((l) => l.text).join('\n')).join('\n');
}
