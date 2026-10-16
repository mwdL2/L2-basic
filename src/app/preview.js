// Vorschau: rendert das erzeugte PDF mit pdf.js auf <canvas>. Unabhängig vom
// PDF-Viewer des Browsers (der in manchen Firmenumgebungen deaktiviert ist).

export async function renderPreview(pdfjsLib, bytes, container) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const width = Math.max(240, container.clientWidth - 2);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvases = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Vorschau Seite ${p} von ${doc.numPages}`);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvases.push(canvas);
    }
    container.replaceChildren(...canvases);
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}
