// Zahlen und Datumswerte im deutschen Format lesen und schreiben.

/** "15000" → 15000, "1.920" → 1920, "2,5" → 2.5, "15.000,50" → 15000.5; sonst null */
export function parseGermanNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s/g, '');
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** 15000 → "15.000", 2.5 → "2,5" */
export function formatGermanNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + grouped + (frac ? `,${frac}` : '');
}

/**
 * Menge als Anzeige-Text normalisieren: reine Zahlen werden mit
 * Tausenderpunkt formatiert ("15000" → "15.000"), alles andere bleibt stehen.
 */
export function normalizeQuantityText(raw) {
  const text = String(raw ?? '').trim();
  const n = parseGermanNumber(text);
  return n == null ? text : formatGermanNumber(n);
}

/** "15000 Stk." → { number: 15000, unit: 'Stk.', raw } */
export function splitQuantity(raw) {
  const text = String(raw ?? '').trim();
  const m = text.match(/^(-?[\d.,]+)\s*(.*)$/);
  if (!m) return { number: null, unit: '', raw: text };
  const number = parseGermanNumber(m[1]);
  if (number == null) return { number: null, unit: '', raw: text };
  return { number, unit: m[2].trim(), raw: text };
}

/** "09.10.2026" → "2026-10-09" (ISO); ungültig → null */
export function germanDateToIso(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "2026-09-28" → "28/09/2026" (Schreibweise des Muster-Lieferscheins) */
export function isoToSlashDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Lokales Datum als ISO-String, ohne Zeitzonen-Verschiebung */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Unicode-Leerzeichen vereinheitlichen, Steuerzeichen entfernen */
export function normalizeSpaces(s) {
  return String(s ?? '')
    .replace(/[​‌‍⁠﻿]/g, '')
    .replace(/[  -   　\t]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
