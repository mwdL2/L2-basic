// Lädt Firmendaten, Schriften und Logo – ausschließlich vom eigenen Server.
// In der Einzeldatei-Version (tools/build-single.mjs) sind alle Dateien in
// window.__AB_INLINE__ eingebettet; dann wird gar nichts nachgeladen.

import { normalizeConfig } from '../core/abModel.js';

const INLINE = globalThis.__AB_INLINE__ || {};

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fetchBytes(url) {
  if (typeof INLINE[url] === 'string') return base64ToBytes(INLINE[url]);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchJson(url) {
  if (url in INLINE) return structuredClone(INLINE[url]);
  if (Object.keys(INLINE).length) throw new Error(`${url}: nicht eingebettet`);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Firmendaten: zuerst firmendaten.json, sonst die Vorlage (mit Warnung).
 * @returns {Promise<{ config: object, source: 'firmendaten.json'|'firmendaten.example.json', warning: string|null }>}
 */
export async function loadConfig() {
  try {
    return { config: normalizeConfig(await fetchJson('firmendaten.json')), source: 'firmendaten.json', warning: null };
  } catch (err) {
    const config = normalizeConfig(await fetchJson('firmendaten.example.json'));
    return {
      config,
      source: 'firmendaten.example.json',
      warning:
        'Es sind noch keine echten Firmendaten hinterlegt (firmendaten.json fehlt) – Absender und Fußzeile zeigen Platzhalter. ' +
        'Bitte public/firmendaten.json nach Vorlage von firmendaten.example.json anlegen.',
      error: String(err?.message || err),
    };
  }
}

export async function loadAssets(config) {
  const [lexendRegular, lexendBold, robotoRegular, robotoBold] = await Promise.all(
    ['Lexend-Regular.ttf', 'Lexend-Bold.ttf', 'Roboto-Regular.ttf', 'Roboto-Bold.ttf'].map((f) =>
      fetchBytes(`fonts/${f}`),
    ),
  );
  let logo = null;
  let warning = null;
  if (config.ab.logo) {
    try {
      logo = await fetchBytes(config.ab.logo);
    } catch {
      warning = `Logo „${config.ab.logo}“ konnte nicht geladen werden – AB wird ohne Logo erzeugt.`;
    }
  }
  return { assets: { fonts: { lexendRegular, lexendBold, robotoRegular, robotoBold }, logo }, warning };
}
