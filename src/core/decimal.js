// Exakte Dezimalarithmetik für deutsche Zahlenformate ("17.850,00", "1,19", "15000").
// Werte werden als { u: BigInt, s: Nachkommastellen } gehalten – keine Gleitkommafehler,
// damit Prüfsummen (Menge × Preis = Betrag) deterministisch und exakt sind.

const GERMAN_NUMBER = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

/** "17.850,00" → { u: 1785000n, s: 2 }; ungültige Eingaben → null */
export function parseDecimal(input) {
  if (input == null) return null;
  let str = String(input).replace(/[\s\u00a0\u202f€%]/g, '');
  if (!str) return null;
  // Erlaube auch "1234.56" (Punkt als Dezimaltrenner), wenn eindeutig kein Tausenderpunkt
  if (/^[+-]?\d+\.\d{1,2}$/.test(str) && !/^[+-]?\d{1,3}\.\d{3}$/.test(str)) {
    str = str.replace('.', ',');
  }
  if (!GERMAN_NUMBER.test(str)) return null;
  const negative = str.startsWith('-');
  str = str.replace(/^[+-]/, '').replace(/\./g, '');
  const [intPart, fracPart = ''] = str.split(',');
  const u = BigInt(intPart + fracPart) * (negative ? -1n : 1n);
  return { u, s: fracPart.length };
}

export function isDecimal(input) {
  return parseDecimal(input) !== null;
}

function pow10(n) {
  return 10n ** BigInt(n);
}

/** Skaliert auf s Nachkommastellen (kaufmännisch gerundet, half-up). */
export function rescale(d, s) {
  if (d.s === s) return d;
  if (d.s < s) return { u: d.u * pow10(s - d.s), s };
  const div = pow10(d.s - s);
  const neg = d.u < 0n;
  const abs = neg ? -d.u : d.u;
  let q = abs / div;
  if ((abs % div) * 2n >= div) q += 1n;
  return { u: neg ? -q : q, s };
}

export function mul(a, b) {
  return { u: a.u * b.u, s: a.s + b.s };
}

export function add(a, b) {
  const s = Math.max(a.s, b.s);
  return { u: rescale(a, s).u + rescale(b, s).u, s };
}

export function sum(list) {
  return list.reduce((acc, d) => add(acc, d), { u: 0n, s: 0 });
}

/** Prozentwert: betrag × satz / 100 */
export function percentOf(amount, rate) {
  return { u: amount.u * rate.u, s: amount.s + rate.s + 2 };
}

/** |a − b| ≤ toleranz (Toleranz in Cent bei 2 Nachkommastellen) */
export function approxEqual(a, b, toleranceCents = 1) {
  const s = Math.max(a.s, b.s, 2);
  const diff = rescale(a, s).u - rescale(b, s).u;
  const tol = BigInt(toleranceCents) * pow10(s - 2);
  return (diff < 0n ? -diff : diff) <= tol;
}

/**
 * Formatiert im deutschen Format mit Tausenderpunkten.
 * minFrac/maxFrac steuern die Nachkommastellen (Rundung bei maxFrac).
 */
export function formatDecimal(d, { minFrac = 0, maxFrac = Math.max(d.s, minFrac) } = {}) {
  let v = d.s > maxFrac ? rescale(d, maxFrac) : d;
  // überflüssige Nullen bis minFrac entfernen
  while (v.s > minFrac && v.u % 10n === 0n) v = { u: v.u / 10n, s: v.s - 1 };
  if (v.s < minFrac) v = rescale(v, minFrac);
  const neg = v.u < 0n;
  const digits = (neg ? -v.u : v.u).toString().padStart(v.s + 1, '0');
  const intPart = digits.slice(0, digits.length - v.s);
  const frac = digits.slice(digits.length - v.s);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + grouped + (v.s > 0 ? ',' + frac : '');
}

export function formatMoney(d) {
  return formatDecimal(d, { minFrac: 2, maxFrac: Math.max(2, d.s) }) + ' €';
}

/** Menge: ganze Zahlen mit Tausenderpunkt ("15.000"), Dezimalmengen mit Komma */
export function formatQuantity(d) {
  return formatDecimal(d, { minFrac: 0 });
}
