// Lädt Schriften und Bilder für den PDF-Renderer vom eigenen Server
// (relativ zur Seite, damit das Tool in jedem Unterordner läuft).
import { ASSET_FILES } from '../pdf/render.js';

export async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(ASSET_FILES).map(async ([key, path]) => {
      const res = await fetch(new URL(path, document.baseURI), { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${path} konnte nicht geladen werden (HTTP ${res.status})`);
      return [key, new Uint8Array(await res.arrayBuffer())];
    }),
  );
  return Object.fromEntries(entries);
}
