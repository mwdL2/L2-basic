// Liest Textbausteine samt Position aus einem PDF (über pdf.js) und baut daraus
// Zeilen und Zellen. Die pdf.js-Bibliothek wird übergeben, damit derselbe Code
// im Browser und in den Node-Tests läuft.

/**
 * @returns {Promise<{ pages: Array<{ width:number, height:number, items:Array }>, info: object }>}
 */
export async function extractPdf(pdfjsLib, data) {
  const task = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (typeof it.str !== 'string') continue;
        const [a, b, , d, e, f] = it.transform;
        // Drehungen ignorieren wir – unsere Angebote enthalten nur waagrechten Text
        if (Math.abs(b) > 0.01) continue;
        const size = Math.abs(d) || Math.abs(a) || it.height || 0;
        items.push({
          str: it.str,
          x: e,
          y: viewport.height - f, // Grundlinie, von oben gemessen
          w: it.width,
          size,
          font: it.fontName || '',
        });
      }
      pages.push({ width: viewport.width, height: viewport.height, items });
      page.cleanup();
    }
    let info = {};
    try {
      info = (await doc.getMetadata())?.info || {};
    } catch {
      info = {};
    }
    return { pages, info };
  } finally {
    await task.destroy();
  }
}

const isBlank = (s) => !s || !s.replace(/[\s\u200b\u00a0]/g, '');

/**
 * Gruppiert Textbausteine einer Seite zu Zeilen (gleiche Grundlinie) und
 * innerhalb der Zeile zu Zellen (getrennt durch große horizontale Lücken).
 */
export function buildLines(items, { yTolerance = 1.0, cellGapFactor = 1.0 } = {}) {
  const visible = items
    .filter((it) => !isBlank(it.str))
    .map((it) => ({ ...it, str: it.str.replace(/\u200b/g, '') }))
    .sort((p, q) => p.y - q.y || p.x - q.x);

  const lines = [];
  for (const it of visible) {
    const line = lines.length ? lines[lines.length - 1] : null;
    if (line && Math.abs(it.y - line.y) <= yTolerance) {
      line.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it] });
    }
  }

  return lines.map((line) => {
    const sorted = line.items.sort((p, q) => p.x - q.x);
    const cells = [];
    for (const it of sorted) {
      const cell = cells.length ? cells[cells.length - 1] : null;
      const gap = cell ? it.x - cell.x1 : Infinity;
      const size = Math.max(it.size, cell ? cell.size : 0) || 8;
      if (cell && gap <= cellGapFactor * size) {
        const needsSpace = gap > 0.12 * size && !cell.text.endsWith(' ') && !it.str.startsWith(' ');
        cell.text += (needsSpace ? ' ' : '') + it.str;
        cell.x1 = Math.max(cell.x1, it.x + it.w);
        cell.size = Math.max(cell.size, it.size);
        cell.fonts.add(it.font);
      } else {
        cells.push({ text: it.str, x0: it.x, x1: it.x + it.w, y: it.y, size: it.size, fonts: new Set([it.font]) });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
    const size = Math.max(...cells.map((c) => c.size));
    return {
      y: line.y,
      size,
      cells,
      x0: cells[0].x0,
      x1: cells[cells.length - 1].x1,
      text: cells.map((c) => c.text).join('  '),
    };
  });
}

/** Text einer Zeile als einfache Zeichenkette (Zellen mit Leerzeichen verbunden) */
export function lineText(line) {
  return line.cells.map((c) => c.text).join(' ');
}

/** Alle Seiten als reine Textzeilen – Eingabe für die textbasierte Ersatzstrategie */
export function pagesToTextLines(pages) {
  const out = [];
  for (const page of pages) {
    for (const line of buildLines(page.items, { yTolerance: 2.0 })) out.push(lineText(line));
  }
  return out;
}

export function hasTextLayer(pages) {
  return pages.some((p) => p.items.some((it) => !isBlank(it.str)));
}
