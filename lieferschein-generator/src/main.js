// Oberfläche des Lieferschein-Generators. Sämtliche Daten leben nur im
// Arbeitsspeicher dieses Tabs (Variable `state`) – kein localStorage, keine
// Cookies, kein Server. Aufbau und Bedienung wie im AB-Generator.

import './styles.css';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readPdfPages } from './parser/pdf-text.js';
import { parseOfferPages } from './parser/offer-parser.js';
import { parseOfferText } from './parser/offer-text.js';
import {
  deliveryNoteFromOffer,
  deliveryNumberFromOffer,
  emptyDeliveryNote,
  emptyItem,
  fileNameFor,
  validateDeliveryNote,
} from './delivery-note/model.js';
import { renderDeliveryNote } from './pdf/render.js';
import { loadAssets } from './app/assets.js';
import { renderPreview } from './app/preview.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (sel) => document.querySelector(sel);

const state = {
  assets: null,
  ready: null, // Promise: Schriften + Bilder geladen
  offer: null, // Ergebnis des Parsers
  note: null, // Lieferschein-Daten (werden bearbeitet)
  origin: '', // 'pdf' | 'text' | 'manual'
  fileName: '',
  fieldStatus: {},
  itemStatus: [],
  itemOriginal: [], // Stand aus dem Angebot (für "zurücksetzen")
  editing: new Set(), // Positionen, deren Artikelspalte gerade bearbeitet wird
  edited: new Set(),
  version: 0,
  pdf: null, // { version, bytes }
  previewTimer: null,
};

const STATUS = {
  ok: { icon: '✓', text: 'aus Angebot' },
  warn: { icon: '!', text: 'bitte prüfen' },
  missing: { icon: '✕', text: 'fehlt – bitte ergänzen' },
  empty: { icon: '–', text: 'nicht im Angebot' },
  edited: { icon: '✎', text: 'manuell geändert' },
  default: { icon: '•', text: 'Standardwert' },
};
const SOURCE_LABELS = { layout: 'PDF-Layout', text: 'Textmuster', filename: 'Dateiname', manual: 'manuell' };

// Formularfeld → Wert im Lieferschein
const FIELDS = {
  number: [(n) => n.number, (n, v) => (n.number = v)],
  issueDate: [(n) => n.issueDate, (n, v) => (n.issueDate = v)],
  offerNumber: [(n) => n.offerNumber, (n, v) => (n.offerNumber = v)],
  customerVatId: [(n) => n.customerVatId, (n, v) => (n.customerVatId = v)],
  billingName: [(n) => n.billing.name, (n, v) => (n.billing.name = v)],
  billingLines: [(n) => n.billing.lines.join('\n'), (n, v) => (n.billing.lines = v.split('\n'))],
  deliveryName: [(n) => n.delivery.name, (n, v) => (n.delivery.name = v)],
  deliveryLines: [(n) => n.delivery.lines.join('\n'), (n, v) => (n.delivery.lines = v.split('\n'))],
  intro: [(n) => n.intro, (n, v) => (n.intro = v)],
};
// Fehlerschlüssel aus validateDeliveryNote() → Formularfeld
const ERROR_FIELD = {
  'billing.name': 'billingName',
  'billing.lines': 'billingLines',
  'delivery.name': 'deliveryName',
  'delivery.lines': 'deliveryLines',
};

function isRequired(key) {
  const n = state.note;
  if (['number', 'issueDate', 'billingName', 'billingLines'].includes(key)) return true;
  if (key === 'deliveryName' || key === 'deliveryLines') return !n.deliverySameAsBilling;
  if (key === 'offerNumber') return n.showOfferNumber;
  if (key === 'customerVatId') return n.showCustomerVatId;
  return false;
}

// ── Start ────────────────────────────────────────────────────────────────

state.ready = loadAssets()
  .then((assets) => {
    state.assets = assets;
  })
  .catch((err) => {
    showBanner(`Das Tool konnte nicht vollständig geladen werden (${err?.message || err}). Bitte Seite neu laden oder Administrator informieren.`, 'error');
    throw err;
  });

function showBanner(text, kind) {
  const b = $('#banner');
  b.textContent = text;
  b.className = `banner banner-${kind}`;
  b.hidden = false;
}

// ── Schritt 1: Laden ─────────────────────────────────────────────────────

const fileInput = $('#file-input');
const dropzone = $('#dropzone');

fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
});
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    if (!$('#step-load').hidden) dropzone.classList.add('is-drag');
  });
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragleave' && e.relatedTarget) return;
    dropzone.classList.remove('is-drag');
  });
}
document.addEventListener('drop', (e) => {
  if ($('#step-load').hidden) return;
  const file = [...(e.dataTransfer?.files || [])][0];
  if (file) handleFile(file);
});

$('#btn-paste').addEventListener('click', () => {
  const area = $('#paste-area');
  area.hidden = !area.hidden;
  if (!area.hidden) $('#paste-input').focus();
});
$('#btn-paste-go').addEventListener('click', async () => {
  const text = $('#paste-input').value;
  if (!text.trim()) return setLoadStatus('Bitte zuerst den Text des Angebots einfügen.', 'error');
  await state.ready;
  startEditing(parseOfferText(text), 'text', 'Eingefügter Text');
});
$('#btn-manual').addEventListener('click', async () => {
  await state.ready;
  startEditing(null, 'manual', '');
});
$('#btn-reset').addEventListener('click', reset);
$('#btn-download').addEventListener('click', download);

function setLoadStatus(text, kind = 'info') {
  const node = $('#load-status');
  node.textContent = text;
  node.dataset.kind = kind;
}

async function handleFile(file) {
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) return setLoadStatus(`„${file.name}“ ist keine PDF-Datei.`, 'error');
  setLoadStatus(`„${file.name}“ wird gelesen …`);
  try {
    await state.ready;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const offer = parseOfferPages(await readPdfPages(bytes, pdfjsLib), { fileName: file.name });
    if (!offer.meta.hasText) {
      setLoadStatus(
        'Dieses PDF enthält keinen auslesbaren Text (z. B. ein Scan). Bitte den Text einfügen oder die Felder manuell ausfüllen.',
        'error',
      );
      return;
    }
    setLoadStatus('');
    startEditing(offer, 'pdf', file.name);
  } catch (err) {
    const msg = /password/i.test(err?.name || err?.message || '')
      ? 'Das PDF ist passwortgeschützt.'
      : `Die Datei konnte nicht gelesen werden (${err?.message || err}).`;
    setLoadStatus(`${msg} Bitte einen der Ausweichwege unten nutzen.`, 'error');
  } finally {
    fileInput.value = '';
  }
}

// ── Schritt 2: Bearbeiten ────────────────────────────────────────────────

function startEditing(offer, origin, fileName) {
  state.offer = offer;
  state.origin = origin;
  state.fileName = fileName;
  state.edited = new Set();
  state.editing = new Set();
  state.note = offer ? deliveryNoteFromOffer(offer) : emptyDeliveryNote();
  state.fieldStatus = initialFieldStatus(offer);
  state.itemStatus = initialItemStatus(offer);
  state.itemOriginal = state.note.items.map((it) => (offer ? { ...it } : null));
  state.note.items.forEach((it, i) => {
    if (!it.title.trim()) state.editing.add(i);
  });
  state.pdf = null;

  $('#step-load').hidden = true;
  $('#step-edit').hidden = false;
  buildForm();
  renderSummary();
  renderLog();
  refresh();
  window.scrollTo({ top: 0 });
}

function statusFromSource(source, hasValue) {
  if (!hasValue) return 'missing';
  return source === 'layout' ? 'ok' : 'warn';
}

function initialFieldStatus(offer) {
  const n = state.note;
  if (!offer) {
    const st = {};
    for (const key of Object.keys(FIELDS)) st[key] = { status: isRequired(key) ? 'missing' : 'empty' };
    st.issueDate = { status: 'default', note: 'Heutiges Datum' };
    st.intro = { status: 'default', note: 'Text aus dem Muster-Lieferschein' };
    return st;
  }
  const src = offer.sources;
  const st = {
    offerNumber: { status: statusFromSource(src.offerNumber, !!n.offerNumber), source: src.offerNumber },
    customerVatId: n.customerVatId
      ? { status: statusFromSource(src.customerVatId, true), source: src.customerVatId }
      : { status: 'empty' },
    billingName: { status: statusFromSource(src.customerName, !!n.billing.name), source: src.customerName },
    billingLines: { status: statusFromSource(src.customerAddress, n.billing.lines.length > 0), source: src.customerAddress },
    deliveryName: { status: 'missing', note: 'Abweichende Lieferadresse' },
    deliveryLines: { status: 'missing' },
    issueDate: { status: 'default', note: 'Heutiges Datum' },
    intro: { status: 'default', note: 'Text aus dem Muster-Lieferschein' },
  };
  st.number = n.number
    ? { status: st.offerNumber.status === 'ok' ? 'ok' : 'warn', note: 'Aus der Angebotsnummer abgeleitet (TPC-L-…)' }
    : { status: 'missing', note: 'Konnte nicht aus einer Angebotsnummer abgeleitet werden' };
  if (src.offerNumber === 'filename') st.offerNumber.note = 'Nur im Dateinamen gefunden';
  return st;
}

function initialItemStatus(offer) {
  if (!offer) return [{ status: 'missing', flags: [] }];
  return state.note.items.map((it, i) => {
    const flags = offer.items[i]?.flags || [];
    return { status: flags.length ? 'warn' : statusFromSource(offer.sources.items, true), flags, source: offer.sources.items };
  });
}

/** DOM-Helfer: Texte immer über textContent/value – nie Inhalte aus dem PDF als HTML */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function pill(statusKey, source, note) {
  const s = STATUS[statusKey] || STATUS.ok;
  const src = source && statusKey !== 'edited' ? ` · ${SOURCE_LABELS[source] || source}` : '';
  return el('span', { class: `pill pill-${statusKey}`, title: [s.text + src, note].filter(Boolean).join('\n') }, `${s.icon} ${s.text}${src}`);
}

function field(key, label, { type = 'text', rows = 3, hint = '', placeholder = '', extra = null } = {}) {
  const id = `f-${key}`;
  const value = FIELDS[key][0](state.note) ?? '';
  const input =
    type === 'textarea'
      ? el('textarea', { id, name: key, rows, placeholder, spellcheck: 'false' })
      : el('input', { id, name: key, type, placeholder, spellcheck: 'false' });
  input.value = value;
  input.addEventListener('input', () => onFieldInput(key, input.value));
  const st = state.fieldStatus[key] || {};
  return el(
    'div',
    { class: 'field', 'data-key': key },
    el(
      'div',
      { class: 'field-head' },
      el('label', { for: id, 'data-label': key, text: label + (isRequired(key) ? ' *' : '') }),
      el('span', { 'data-pill': key }, pill(st.status, st.source, st.note)),
    ),
    input,
    extra,
    el('p', { class: 'field-note', 'data-note': key, text: st.note || hint }),
    el('p', { class: 'field-error', 'data-error': key }),
  );
}

function toggle(prop, label, onChange) {
  const input = el('input', { type: 'checkbox', id: `o-${prop}` });
  input.checked = !!state.note[prop];
  input.addEventListener('change', () => {
    state.note[prop] = input.checked;
    onChange?.(input.checked);
    refresh();
  });
  return el('label', { class: 'inline-check', for: `o-${prop}` }, input, el('span', { text: label }));
}

function section(title, ...children) {
  return el('fieldset', { class: 'section' }, el('legend', { text: title }), ...children);
}

function buildForm() {
  const form = $('#note-form');
  const sameInput = el('input', { type: 'checkbox', id: 'o-same-address' });
  sameInput.checked = state.note.deliverySameAsBilling;
  sameInput.addEventListener('change', () => {
    state.note.deliverySameAsBilling = sameInput.checked;
    $('#delivery-box').hidden = sameInput.checked;
    updateLabels();
    refresh();
    if (!sameInput.checked) $('#f-deliveryName')?.focus();
  });

  form.replaceChildren(
    section(
      'Lieferschein',
      el('div', { class: 'grid-2' }, field('number', 'Lieferscheinnummer'), field('issueDate', 'Ausstellungsdatum', { type: 'date' })),
    ),
    section(
      'Bezug & Kunde',
      el(
        'div',
        { class: 'grid-2' },
        field('offerNumber', 'Angebotsnummer', {
          placeholder: 'A-2026-0001',
          extra: toggle('showOfferNumber', 'auf dem Lieferschein angeben', updateLabels),
        }),
        field('customerVatId', 'Kunden-USt-IDNr.', {
          placeholder: 'optional',
          extra: toggle('showCustomerVatId', 'auf dem Lieferschein angeben', updateLabels),
        }),
      ),
    ),
    section(
      'Rechnungsadresse (aus dem Angebot)',
      el(
        'div',
        { class: 'grid-2' },
        field('billingName', 'Firma / Name'),
        field('billingLines', 'Anschrift (eine Zeile je Adresszeile)', { type: 'textarea', rows: 3 }),
      ),
      el(
        'label',
        { class: 'address-switch', for: 'o-same-address' },
        sameInput,
        el(
          'span',
          {},
          el('strong', { text: 'Lieferadresse entspricht der Rechnungsadresse' }),
          el('small', {
            text: 'Haken entfernen, um eine abweichende Lieferadresse einzugeben. Die Rechnungsadresse steht dann zusätzlich auf dem Lieferschein.',
          }),
        ),
      ),
      el(
        'div',
        { id: 'delivery-box', class: 'delivery-box', hidden: state.note.deliverySameAsBilling },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: copyBillingToDelivery, text: 'Rechnungsadresse als Vorlage übernehmen' }),
        el(
          'div',
          { class: 'grid-2' },
          field('deliveryName', 'Lieferadresse: Firma / Name'),
          field('deliveryLines', 'Lieferadresse: Anschrift', { type: 'textarea', rows: 3 }),
        ),
      ),
    ),
    section(
      'Positionen',
      el('p', { class: 'field-note', text: 'Artikel, Beschreibung und Menge stammen aus dem Angebot. Preise werden bewusst nicht übernommen.' }),
      el('div', { id: 'items' }),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: addItem, text: '+ Position hinzufügen' }),
    ),
    section('Text über der Tabelle', field('intro', 'Einleitungssatz')),
  );
  form.onsubmit = (e) => e.preventDefault();
  renderItems();
}

function updateLabels() {
  document.querySelectorAll('[data-label]').forEach((label) => {
    const key = label.dataset.label;
    label.textContent = label.textContent.replace(/ \*$/, '') + (isRequired(key) ? ' *' : '');
  });
}

function copyBillingToDelivery() {
  const { billing } = state.note;
  for (const [key, value] of [
    ['deliveryName', billing.name],
    ['deliveryLines', billing.lines.join('\n')],
  ]) {
    $(`#f-${key}`).value = value;
    onFieldInput(key, value);
  }
  $('#f-deliveryName').focus();
}

// ── Positionen ───────────────────────────────────────────────────────────

function renderItems() {
  const wrap = $('#items');
  const items = state.note.items;
  wrap.replaceChildren(...items.map((item, i) => renderItem(item, i, items.length)));
}

function itemInput(i, prop, label, opts = {}) {
  const id = `i-${i}-${prop}`;
  const item = state.note.items[i];
  const node =
    opts.type === 'textarea'
      ? el('textarea', { id, rows: opts.rows || 3, spellcheck: 'false', placeholder: opts.placeholder || '' })
      : el('input', { id, type: 'text', inputmode: opts.inputmode, placeholder: opts.placeholder || '', spellcheck: 'false' });
  node.value = item[prop] ?? '';
  node.addEventListener('input', () => onItemInput(i, prop, node.value));
  return el(
    'div',
    { class: `field field-${prop}` },
    el('label', { for: id, text: label }),
    node,
    opts.hint ? el('p', { class: 'field-note', text: opts.hint }) : null,
    el('p', { class: 'field-error', 'data-error': `items.${i}.${prop}` }),
  );
}

function renderItem(item, i, count) {
  const st = state.itemStatus[i] || { status: 'edited', flags: [] };
  const editing = state.editing.has(i);
  const original = state.itemOriginal[i];
  const changed = original && (original.title !== item.title || original.description !== item.description);

  const article = editing
    ? el(
        'div',
        { class: 'article-edit' },
        itemInput(i, 'title', 'Artikelbezeichnung (fett, unterstrichen)'),
        itemInput(i, 'description', 'Artikelbeschreibung (eine Zeile je Angabe)', {
          type: 'textarea',
          rows: Math.max(3, String(item.description).split('\n').length + 1),
          placeholder: 'z. B.\nSKU: …\nEAN: …\nCharge: …',
          hint: 'Wird fett unter der Bezeichnung gedruckt – z. B. SKU, EAN oder Charge ergänzen.',
        }),
        el(
          'div',
          { class: 'article-actions' },
          el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => setEditing(i, false), text: 'Fertig' }),
          changed
            ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => resetItem(i), text: 'Auf Angebot zurücksetzen' })
            : null,
        ),
      )
    : el(
        'div',
        {},
        articleView(item),
        el('p', { class: 'field-error', 'data-error': `items.${i}.title` }),
        el(
          'div',
          { class: 'article-actions' },
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            onclick: () => setEditing(i, true),
            'aria-label': `Artikel der Position ${i + 1} bearbeiten`,
            text: '✎ Artikel bearbeiten / Beschreibung ergänzen',
          }),
        ),
      );

  return el(
    'div',
    { class: 'item', 'data-index': i },
    el(
      'div',
      { class: 'item-head' },
      el('strong', { text: `Position ${i + 1}` }),
      el('span', { 'data-item-pill': i }, pill(st.status, st.source)),
      el(
        'span',
        { class: 'item-tools' },
        el('button', { type: 'button', class: 'icon-btn', title: 'Nach oben', 'aria-label': `Position ${i + 1} nach oben`, disabled: i === 0, onclick: () => moveItem(i, -1), text: '↑' }),
        el('button', { type: 'button', class: 'icon-btn', title: 'Nach unten', 'aria-label': `Position ${i + 1} nach unten`, disabled: i === count - 1, onclick: () => moveItem(i, 1), text: '↓' }),
        el('button', { type: 'button', class: 'icon-btn danger', title: 'Position entfernen', 'aria-label': `Position ${i + 1} entfernen`, onclick: () => removeItem(i), text: '✕' }),
      ),
    ),
    st.flags?.length ? el('ul', { class: 'item-flags' }, st.flags.map((f) => el('li', { text: f }))) : null,
    el(
      'div',
      { class: 'item-grid' },
      el('div', {}, editing ? null : el('span', { class: 'label-like', text: 'Artikel' }), article),
      itemInput(i, 'quantity', 'Menge', { inputmode: 'decimal' }),
      itemInput(i, 'unit', 'Einheit'),
    ),
  );
}

/** Artikelspalte so, wie sie im PDF erscheint */
function articleView(item) {
  const lines = String(item.description || '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return el(
    'div',
    { class: 'article-view' },
    item.title.trim()
      ? el('span', { class: 'article-line article-title', text: item.title })
      : el('span', { class: 'article-line article-empty', text: 'Bezeichnung fehlt' }),
    lines.map((l) => el('span', { class: 'article-line', text: l || ' ' })),
  );
}

function setEditing(i, on) {
  if (on) state.editing.add(i);
  else state.editing.delete(i);
  renderItems();
  refresh();
  if (on) $(`#i-${i}-title`)?.focus();
  else document.querySelector(`[data-index="${i}"] .article-actions button`)?.focus();
}

function resetItem(i) {
  const o = state.itemOriginal[i];
  if (!o) return;
  Object.assign(state.note.items[i], { title: o.title, description: o.description });
  renderItems();
  refresh();
}

function onFieldInput(key, value) {
  FIELDS[key][1](state.note, value);
  state.edited.add(key);
  const empty = !String(value).trim();
  state.fieldStatus[key] = {
    ...state.fieldStatus[key],
    status: empty ? (isRequired(key) ? 'missing' : 'empty') : 'edited',
    source: empty ? null : 'manual',
  };
  // Lieferscheinnummer folgt der Angebotsnummer, solange sie nicht von Hand geändert wurde
  if (key === 'offerNumber' && !state.edited.has('number')) {
    state.note.number = deliveryNumberFromOffer(value.trim());
    $('#f-number').value = state.note.number;
    state.fieldStatus.number = state.note.number
      ? { status: 'default', note: 'Aus der Angebotsnummer abgeleitet (TPC-L-…)' }
      : { status: 'missing' };
    updatePill('number');
  }
  updatePill(key);
  refresh();
}

function onItemInput(i, prop, value) {
  state.note.items[i][prop] = value;
  state.itemStatus[i] = { ...(state.itemStatus[i] || { flags: [] }), status: 'edited', source: 'manual' };
  const holder = document.querySelector(`[data-item-pill="${i}"]`);
  if (holder) holder.replaceChildren(pill('edited', 'manual'));
  refresh();
}

function addItem() {
  const i = state.note.items.length;
  state.note.items.push(emptyItem());
  state.itemStatus.push({ status: 'edited', flags: [], source: 'manual' });
  state.itemOriginal.push(null);
  state.editing.add(i);
  renderItems();
  refresh();
  $(`#i-${i}-title`)?.focus();
}

function shiftEditing(fn) {
  state.editing = new Set([...state.editing].map(fn).filter((x) => x != null));
}

function removeItem(i) {
  state.note.items.splice(i, 1);
  state.itemStatus.splice(i, 1);
  state.itemOriginal.splice(i, 1);
  shiftEditing((x) => (x === i ? null : x > i ? x - 1 : x));
  renderItems();
  refresh();
}

function moveItem(i, dir) {
  const j = i + dir;
  for (const arr of [state.note.items, state.itemStatus, state.itemOriginal]) [arr[i], arr[j]] = [arr[j], arr[i]];
  shiftEditing((x) => (x === i ? j : x === j ? i : x));
  renderItems();
  refresh();
}

function updatePill(key) {
  const holder = document.querySelector(`[data-pill="${key}"]`);
  const st = state.fieldStatus[key] || {};
  if (holder) holder.replaceChildren(pill(st.status, st.source, st.note));
  const note = document.querySelector(`[data-note="${key}"]`);
  if (note && st.status === 'edited') note.textContent = '';
}

// ── Prüfen, Vorschau, Ausgabe ────────────────────────────────────────────

function currentErrors() {
  const errors = {};
  for (const p of validateDeliveryNote(state.note)) errors[ERROR_FIELD[p.field] || p.field] = p.message;
  return errors;
}

function refresh() {
  state.version++;
  const errors = currentErrors();
  document.querySelectorAll('[data-error]').forEach((p) => {
    const key = p.dataset.error;
    p.textContent = errors[key] || '';
    p.dataset.kind = errors[key] ? 'error' : '';
    const input = p.parentElement.querySelector('input, textarea');
    if (input) input.toggleAttribute('aria-invalid', !!errors[key]);
  });
  const btn = $('#btn-download');
  const list = Object.values(errors);
  btn.disabled = list.length > 0;
  $('#action-hint').textContent = list.length
    ? `Noch ${list.length} Pflichtangabe${list.length > 1 ? 'n' : ''} offen: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ' …' : ''}`
    : 'Alle Pflichtangaben vorhanden.';
  $('#action-hint').dataset.kind = list.length ? 'error' : 'ok';
  schedulePreview();
}

function schedulePreview() {
  clearTimeout(state.previewTimer);
  $('#preview-state').textContent = 'wird aktualisiert …';
  state.previewTimer = setTimeout(updatePreview, 300);
}

async function buildPdf() {
  if (state.pdf?.version === state.version) return state.pdf.bytes;
  const version = state.version;
  const bytes = await renderDeliveryNote(state.note, state.assets);
  state.pdf = { version, bytes };
  return bytes;
}

async function updatePreview() {
  const version = state.version;
  try {
    await state.ready;
    const bytes = await buildPdf();
    if (version !== state.version) return; // inzwischen weitergetippt
    const pages = await renderPreview(pdfjsLib, bytes, $('#preview-pages'));
    if (version === state.version) $('#preview-state').textContent = pages > 1 ? `${pages} Seiten` : '1 Seite';
  } catch (err) {
    $('#preview-state').textContent = `Vorschau fehlgeschlagen: ${err?.message || err}`;
  }
}

// Als claude.ai-Vorschau eingebettet sind normale Downloads gesperrt; dort
// speichert die Plattform die Datei nach Rückfrage. Überall sonst gibt es
// kein window.claude und der Download läuft wie gewohnt über einen Link.
const hostDownloads = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

async function download() {
  if (Object.keys(currentErrors()).length) return;
  const bytes = await buildPdf();
  const filename = fileNameFor(state.note);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const host = await hostDownloads;
  if (host) {
    try {
      await host.save({ filename, data: blob });
    } catch (err) {
      if (err?.code !== 'declined') {
        $('#action-hint').textContent = `Speichern nicht möglich (${err?.message || err?.code || err}).`;
        $('#action-hint').dataset.kind = 'error';
      }
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function reset() {
  clearTimeout(state.previewTimer);
  Object.assign(state, { offer: null, note: null, fileName: '', fieldStatus: {}, itemStatus: [], itemOriginal: [], pdf: null, origin: '' });
  state.edited = new Set();
  state.editing = new Set();
  $('#note-form').replaceChildren();
  $('#preview-pages').replaceChildren();
  $('#log-content').replaceChildren();
  $('#paste-input').value = '';
  $('#paste-area').hidden = true;
  $('#step-edit').hidden = true;
  $('#step-load').hidden = false;
  setLoadStatus('');
  window.scrollTo({ top: 0 });
}

// ── Zusammenfassung & Protokoll ──────────────────────────────────────────

function renderSummary() {
  const box = $('#summary');
  const o = state.offer;
  if (!o) {
    box.dataset.kind = 'warn';
    box.replaceChildren(el('h2', { text: 'Manuelle Erfassung' }), el('p', { class: 'muted', text: 'Bitte alle Felder ausfüllen.' }));
    return;
  }
  const keys = ['number', 'offerNumber', 'billingName', 'billingLines', 'customerVatId'];
  const statuses = [...keys.map((k) => state.fieldStatus[k]?.status), ...state.itemStatus.map((s) => s.status)];
  if (!o.items.length) statuses.push('missing');
  const count = (s) => statuses.filter((x) => x === s).length;
  const missing = count('missing');
  const warn = count('warn');
  const kind = missing ? 'error' : warn || o.warnings.length ? 'warn' : 'ok';
  const headline =
    kind === 'ok'
      ? 'Alles aus dem Angebot übernommen'
      : missing
        ? `${missing} Angabe${missing > 1 ? 'n' : ''} fehlt – bitte ergänzen`
        : 'Übernommen – bitte markierte Angaben prüfen';
  const source = state.origin === 'text' ? 'Eingefügter Text' : state.fileName;
  box.dataset.kind = kind;
  box.replaceChildren(
    el('h2', { text: headline }),
    el('p', {
      class: 'muted',
      text: `Quelle: ${source}${o.fields.offerNumber ? ` · Angebot ${o.fields.offerNumber}` : ''} · ${o.items.length} Position${o.items.length === 1 ? '' : 'en'} · Preise nicht übernommen`,
    }),
    el(
      'div',
      { class: 'chips' },
      el('span', { class: 'chip chip-ok', text: `✓ ${count('ok')} übernommen` }),
      warn ? el('span', { class: 'chip chip-warn', text: `! ${warn} prüfen` }) : null,
      missing ? el('span', { class: 'chip chip-error', text: `✕ ${missing} fehlt` }) : null,
    ),
    ...o.warnings.map((w) => el('p', { class: 'summary-note', text: w })),
  );
}

function renderLog() {
  const box = $('#log-content');
  const o = state.offer;
  if (!o) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Keine automatische Erkennung durchgeführt.' }));
    return;
  }
  const show = (v) => (Array.isArray(v) ? v.join(' / ') : v) || '–';
  box.replaceChildren(
    el('h3', { text: 'Herkunft der Felder' }),
    el(
      'ul',
      { class: 'checklist' },
      Object.entries(o.fields)
        .filter(([k]) => !['customerNumber', 'validUntil'].includes(k) || o.fields[k])
        .map(([k, v]) =>
          el(
            'li',
            { class: v && (!Array.isArray(v) || v.length) ? 'is-ok' : 'is-fail' },
            el('code', { text: k }),
            el('span', { text: ` · ${show(v)} · ${SOURCE_LABELS[o.sources[k]] || 'nicht gefunden'}` }),
          ),
        ),
      el('li', { class: o.items.length ? 'is-ok' : 'is-fail' }, el('code', { text: 'items' }), el('span', { text: ` · ${o.items.length} Positionen · ${SOURCE_LABELS[o.sources.items] || 'nicht gefunden'}` })),
    ),
    o.log.length ? el('h3', { text: 'Protokoll' }) : null,
    o.log.length ? el('ul', { class: 'checklist' }, o.log.map((m) => el('li', { text: m }))) : null,
  );
}
