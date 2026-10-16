// Zeichnet das erzeugte PDF mit pdf.js seitenweise in <canvas>-Elemente.
// Erst wenn alle Seiten fertig sind, wird die alte Vorschau ersetzt (kein Flackern).

export async function renderPreview(pdfjs, bytes, container) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  try {
    const doc = await task.promise;
    const cssWidth = Math.max(280, container.clientWidth - 20);
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const canvases = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Vorschau Seite ${n} von ${doc.numPages}`);
      await page.render({ canvas, viewport }).promise;
      canvases.push(canvas);
    }
    container.replaceChildren(...canvases);
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}
