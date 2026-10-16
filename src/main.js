// Oberfläche des AB-Generators. Sämtliche Daten leben nur im Arbeitsspeicher
// dieses Tabs (Variable `state`) – kein localStorage, keine Cookies, kein Server.

import './styles.css';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { analyzePdf, analyzeText } from './core/pipeline.js';
import {
  draftToForm,
  emptyForm,
  emptyItem,
  validateForm,
  formToDocument,
  fileNameFor,
  deriveAbNumber,
} from './core/abModel.js';
import { renderAbPdf } from './core/renderAB.js';
import { SOURCE_LABELS } from './core/merge.js';
import { loadConfig, loadAssets } from './app/assets.js';
import { renderPreview } from './app/preview.js';

// Einzeldatei-Version: Worker-Code liegt eingebettet vor und läuft als blob:-Worker
const inlineWorker = globalThis.__AB_INLINE__?.['pdf.worker.mjs'];
pdfjsLib.GlobalWorkerOptions.workerSrc = inlineWorker
  ? URL.createObjectURL(new Blob([inlineWorker], { type: 'text/javascript' }))
  : workerUrl;

const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  assets: null,
  ready: null, // Promise: Firmendaten + Schriften geladen
  draft: null,
  form: null,
  origin: '', // 'pdf' | 'text' | 'manual'
  fileName: '',
  fieldStatus: {},
  itemStatus: [],
  edited: new Set(),
  version: 0,
  pdf: null, // { version, bytes }
  previewTimer: null,
};

const STATUS = {
  ok: { icon: '✓', text: 'erkannt' },
  warn: { icon: '!', text: 'bitte prüfen' },
  missing: { icon: '✕', text: 'fehlt – bitte ergänzen' },
  empty: { icon: '–', text: 'nicht im Angebot' },
  edited: { icon: '✎', text: 'manuell geändert' },
  default: { icon: '•', text: 'Standardwert' },
};

const REQUIRED = new Set(['abNumber', 'abDate', 'customerName']);

// ── Start ────────────────────────────────────────────────────────────────

state.ready = (async () => {
  const cfg = await loadConfig();
  state.config = cfg.config;
  $('#config-source').textContent = `Firmendaten: ${cfg.source}`;
  const { assets, warning } = await loadAssets(state.config);
  state.assets = assets;
  const warnings = [cfg.warning, warning].filter(Boolean);
  if (warnings.length) showBanner(warnings.join(' '), 'warn');
})().catch((err) => {
  showBanner(
    `Das Tool konnte nicht vollständig geladen werden (${err?.message || err}). Bitte Seite neu laden oder Administrator informieren.`,
    'error',
  );
  throw err;
});

function showBanner(text, kind) {
  const b = $('#config-banner');
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
  const { draft } = analyzeText(text, { config: state.config });
  startEditing(draft, 'text', 'Eingefügter Text');
});
$('#btn-manual').addEventListener('click', async () => {
  await state.ready;
  startEditing(null, 'manual', '');
});
$('#btn-reset').addEventListener('click', reset);
$('#btn-download').addEventListener('click', download);

function setLoadStatus(text, kind = 'info') {
  const el = $('#load-status');
  el.textContent = text;
  el.dataset.kind = kind;
}

async function handleFile(file) {
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) return setLoadStatus(`„${file.name}“ ist keine PDF-Datei.`, 'error');
  setLoadStatus(`„${file.name}“ wird gelesen …`);
  try {
    await state.ready;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { draft, noText } = await analyzePdf(pdfjsLib, bytes, { fileName: file.name, config: state.config });
    if (noText) {
      setLoadStatus(
        'Dieses PDF enthält keinen auslesbaren Text (z. B. ein Scan). Bitte den Text einfügen oder die Felder manuell ausfüllen.',
        'error',
      );
      return;
    }
    setLoadStatus('');
    startEditing(draft, 'pdf', file.name);
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

function startEditing(draft, origin, fileName) {
  state.draft = draft;
  state.origin = origin;
  state.fileName = fileName;
  state.edited = new Set();
  state.form = draft ? draftToForm(draft, state.config) : emptyForm(state.config);
  state.fieldStatus = initialFieldStatus(draft);
  state.itemStatus = initialItemStatus(draft);
  state.pdf = null;

  $('#step-load').hidden = true;
  $('#step-edit').hidden = false;
  buildForm();
  renderSummary();
  renderLog();
  refresh();
  window.scrollTo({ top: 0 });
}

function initialFieldStatus(draft) {
  const st = {};
  const f = draft?.fields || {};
  for (const key of [
    'offerNumber',
    'offerDate',
    'customerName',
    'customerAddress',
    'customerVatId',
    'notes',
    'paymentTerms',
    'closingNotes',
  ]) {
    st[key] = f[key] ? { status: f[key].status, source: f[key].source, note: f[key].note } : { status: 'missing' };
    if (!draft) st[key] = { status: REQUIRED.has(key) ? 'missing' : 'empty' };
  }
  const derived = draft && state.form.abNumber;
  st.abNumber = derived
    ? { status: f.offerNumber.status === 'ok' ? 'ok' : 'warn', note: 'Aus der Angebotsnummer abgeleitet' }
    : { status: 'missing', note: 'Konnte nicht aus einer Angebotsnummer abgeleitet werden' };
  st.abDate = { status: 'default', note: 'Heutiges Datum' };
  return st;
}

function initialItemStatus(draft) {
  if (!draft?.items) return [{ status: 'missing', flags: [] }];
  const base = draft.items.status;
  return draft.items.value.map((it) => ({
    status: it.flags.length ? 'warn' : base === 'missing' ? 'missing' : base,
    flags: it.flags,
    source: draft.items.source,
  }));
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

/** replaceChildren ohne null/undefined (würde sonst als Text "null" erscheinen) */
function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null));
}

function pill(statusKey, source, note) {
  const s = STATUS[statusKey] || STATUS.ok;
  const src = source ? ` · ${SOURCE_LABELS[source] || source}` : '';
  return el(
    'span',
    { class: `pill pill-${statusKey}`, title: [s.text + src, note].filter(Boolean).join('\n') },
    `${s.icon} ${s.text}${src}`,
  );
}

function field(key, label, { type = 'text', rows = 3, hint = '', placeholder = '' } = {}) {
  const id = `f-${key}`;
  const value = state.form[key] ?? '';
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
      el('label', { for: id, text: label + (REQUIRED.has(key) ? ' *' : '') }),
      el('span', { 'data-pill': key }, pill(st.status, st.source, st.note)),
    ),
    input,
    el('p', { class: 'field-note', 'data-note': key, text: st.note || hint }),
    el('p', { class: 'field-error', 'data-error': key }),
  );
}

function section(title, ...children) {
  return el('fieldset', { class: 'section' }, el('legend', { text: title }), ...children);
}

function buildForm() {
  const form = $('#ab-form');
  const o = state.form.options;
  const opt = (key, label) => {
    const input = el('input', { type: 'checkbox', id: `o-${key}` });
    input.checked = !!o[key];
    input.addEventListener('change', () => {
      state.form.options[key] = input.checked;
      refresh();
    });
    return el('label', { class: 'check', for: `o-${key}` }, input, el('span', { text: label }));
  };

  form.replaceChildren(
    section(
      'Auftragsbestätigung',
      el(
        'div',
        { class: 'grid-2' },
        field('abNumber', 'AB-Nummer'),
        field('abDate', 'Ausstellungsdatum', { type: 'date' }),
      ),
    ),
    section(
      'Bezug: Angebot',
      el(
        'div',
        { class: 'grid-2' },
        field('offerNumber', 'Angebotsnummer', { placeholder: 'A-2026-0001' }),
        field('offerDate', 'Angebotsdatum', { placeholder: 'TT.MM.JJJJ' }),
      ),
    ),
    section(
      'Kunde',
      field('customerName', 'Firma / Name'),
      el(
        'div',
        { class: 'grid-2' },
        field('customerAddress', 'Anschrift (eine Zeile je Adresszeile)', { type: 'textarea', rows: 3 }),
        field('customerVatId', 'USt-IdNr. des Kunden', { placeholder: 'optional' }),
      ),
    ),
    section(
      'Hinweise unter dem Einleitungssatz',
      field('notes', 'Hinweise', {
        type: 'textarea',
        rows: 2,
        hint: 'z. B. „Exkl. Versand“ – leer lassen, wenn nicht benötigt',
      }),
    ),
    section(
      'Positionen',
      el('div', { id: 'items' }),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: addItem, text: '+ Position hinzufügen' }),
    ),
    section(
      'Zahlungsbedingungen',
      field('paymentTerms', 'Zahlungsbedingungen (eine Zeile je Bedingung)', { type: 'textarea', rows: 3 }),
    ),
    section(
      'Optionen',
      el(
        'div',
        { class: 'checks' },
        opt('angebotsbezug', 'Angebotsnummer in der AB nennen'),
        opt('kundenUstId', 'USt-IdNr. des Kunden drucken'),
        opt('inlandLandWeglassen', '„Deutschland“ in der Anschrift weglassen'),
        opt('summen', 'Summen (Netto / MwSt. / Gesamt) drucken'),
        opt('weitereHinweise', 'Weitere Hinweise aus dem Angebot drucken'),
      ),
      field('closingNotes', 'Weitere Hinweise (nur mit Option oben)', { type: 'textarea', rows: 2 }),
    ),
  );
  form.onsubmit = (e) => e.preventDefault();
  renderItems();
}

function renderItems() {
  const wrap = $('#items');
  const items = state.form.items;
  wrap.replaceChildren(
    ...items.map((item, i) => {
      const st = state.itemStatus[i] || { status: 'edited', flags: [] };
      const input = (prop, label, opts = {}) => {
        const id = `i-${i}-${prop}`;
        const node =
          opts.type === 'textarea'
            ? el('textarea', { id, rows: opts.rows || 3, spellcheck: 'false' })
            : el('input', {
                id,
                type: 'text',
                inputmode: opts.inputmode,
                placeholder: opts.placeholder || '',
                spellcheck: 'false',
              });
        node.value = item[prop] ?? '';
        node.addEventListener('input', () => onItemInput(i, prop, node.value));
        return el(
          'div',
          { class: `field field-${prop}` },
          el('label', { for: id, text: label }),
          node,
          el('p', { class: 'field-error', 'data-error': `items.${i}.${prop}` }),
        );
      };
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
            el('button', {
              type: 'button',
              class: 'icon-btn',
              title: 'Nach oben',
              'aria-label': `Position ${i + 1} nach oben`,
              disabled: i === 0,
              onclick: () => moveItem(i, -1),
              text: '↑',
            }),
            el('button', {
              type: 'button',
              class: 'icon-btn',
              title: 'Nach unten',
              'aria-label': `Position ${i + 1} nach unten`,
              disabled: i === items.length - 1,
              onclick: () => moveItem(i, 1),
              text: '↓',
            }),
            el('button', {
              type: 'button',
              class: 'icon-btn danger',
              title: 'Position entfernen',
              'aria-label': `Position ${i + 1} entfernen`,
              onclick: () => removeItem(i),
              text: '✕',
            }),
          ),
        ),
        st.flags?.length
          ? el(
              'ul',
              { class: 'item-flags' },
              st.flags.map((f) => el('li', { text: f })),
            )
          : null,
        input('title', 'Bezeichnung (fett)'),
        input('description', 'Beschreibung (eine Zeile je Angabe)', {
          type: 'textarea',
          rows: Math.max(2, String(item.description).split('\n').length),
        }),
        el(
          'div',
          { class: 'grid-4' },
          input('quantity', 'Menge', { inputmode: 'decimal' }),
          input('unit', 'Einheit'),
          input('unitPrice', 'Einzelpreis netto (€)', { inputmode: 'decimal', placeholder: '0,00' }),
          input('vatRate', 'MwSt. (%)', { inputmode: 'decimal', placeholder: state.config.ab.standardMwSt }),
        ),
      );
    }),
  );
}

function onFieldInput(key, value) {
  state.form[key] = value;
  state.edited.add(key);
  const empty = !String(value).trim();
  state.fieldStatus[key] = {
    ...state.fieldStatus[key],
    status: empty ? (REQUIRED.has(key) ? 'missing' : 'empty') : 'edited',
    source: empty ? null : 'manual',
  };
  // AB-Nummer folgt der Angebotsnummer, solange sie nicht von Hand geändert wurde
  if (key === 'offerNumber' && !state.edited.has('abNumber')) {
    state.form.abNumber = deriveAbNumber(value.trim(), state.config.ab.nummernVorlage);
    $('#f-abNumber').value = state.form.abNumber;
    state.fieldStatus.abNumber = state.form.abNumber
      ? { status: 'default', note: 'Aus der Angebotsnummer abgeleitet' }
      : { status: 'missing' };
    updatePill('abNumber');
  }
  updatePill(key);
  refresh();
}

function onItemInput(i, prop, value) {
  state.form.items[i][prop] = value;
  state.itemStatus[i] = { ...(state.itemStatus[i] || { flags: [] }), status: 'edited', source: 'manual' };
  const holder = document.querySelector(`[data-item-pill="${i}"]`);
  if (holder) holder.replaceChildren(pill('edited', 'manual'));
  refresh();
}

function addItem() {
  state.form.items.push(emptyItem(state.config));
  state.itemStatus.push({ status: 'edited', flags: [], source: 'manual' });
  renderItems();
  refresh();
  document.querySelector(`#i-${state.form.items.length - 1}-title`)?.focus();
}

function removeItem(i) {
  state.form.items.splice(i, 1);
  state.itemStatus.splice(i, 1);
  renderItems();
  refresh();
}

function moveItem(i, dir) {
  const j = i + dir;
  const { items } = state.form;
  [items[i], items[j]] = [items[j], items[i]];
  [state.itemStatus[i], state.itemStatus[j]] = [state.itemStatus[j], state.itemStatus[i]];
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

function refresh() {
  state.version++;
  const { errors, warnings } = validateForm(state.form);
  document.querySelectorAll('[data-error]').forEach((p) => {
    const key = p.dataset.error;
    p.textContent = errors[key] || warnings[key] || '';
    p.dataset.kind = errors[key] ? 'error' : 'warn';
    const input = p.parentElement.querySelector('input, textarea');
    if (input) input.toggleAttribute('aria-invalid', !!errors[key]);
  });
  const btn = $('#btn-download');
  const errorList = Object.values(errors);
  btn.disabled = errorList.length > 0;
  $('#action-hint').textContent = errorList.length
    ? `Noch ${errorList.length} Pflichtangabe${errorList.length > 1 ? 'n' : ''} offen: ${errorList.slice(0, 3).join(', ')}${errorList.length > 3 ? ' …' : ''}`
    : 'Alle Pflichtangaben vorhanden.';
  $('#action-hint').dataset.kind = errorList.length ? 'error' : 'ok';
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
  const bytes = await renderAbPdf(formToDocument(state.form, state.config), state.assets);
  state.pdf = { version, bytes };
  return bytes;
}

async function updatePreview() {
  const version = state.version;
  try {
    const bytes = await buildPdf();
    if (version !== state.version) return; // inzwischen weitergetippt
    const pages = await renderPreview(pdfjsLib, bytes, $('#preview-pages'));
    if (version === state.version) $('#preview-state').textContent = pages > 1 ? `${pages} Seiten` : '1 Seite';
  } catch (err) {
    $('#preview-state').textContent = `Vorschau fehlgeschlagen: ${err?.message || err}`;
  }
}

async function download() {
  const { ok } = validateForm(state.form);
  if (!ok) return;
  const bytes = await buildPdf();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = el('a', { href: url, download: fileNameFor(state.form, state.config) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function reset() {
  clearTimeout(state.previewTimer);
  Object.assign(state, {
    draft: null,
    form: null,
    fileName: '',
    fieldStatus: {},
    itemStatus: [],
    pdf: null,
    origin: '',
  });
  state.edited = new Set();
  $('#ab-form').replaceChildren();
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
  const d = state.draft;
  if (!d) {
    const title = state.origin === 'manual' ? 'Manuelle Erfassung' : 'Text ausgewertet';
    fill(box, el('h2', { text: title }), el('p', { class: 'muted', text: 'Bitte alle Felder ausfüllen bzw. prüfen.' }));
    box.dataset.kind = 'warn';
    return;
  }
  const statuses = [
    ...['customerName', 'customerAddress', 'offerNumber', 'offerDate', 'paymentTerms', 'customerVatId', 'notes'].map(
      (k) => d.fields[k]?.status,
    ),
    d.items?.status,
  ];
  const count = (s) => statuses.filter((x) => x === s).length;
  const missing = count('missing');
  const warn = count('warn');
  const checks = d.checks.filter((c) => c.ok !== null);
  const failed = checks.filter((c) => !c.ok).length;
  const kind = missing ? 'error' : warn || failed ? 'warn' : 'ok';
  const headline =
    kind === 'ok'
      ? 'Alles erkannt und rechnerisch geprüft'
      : missing
        ? `${missing} Angabe${missing > 1 ? 'n' : ''} fehlt – bitte ergänzen`
        : 'Erkannt – bitte markierte Angaben prüfen';
  const source = state.origin === 'text' ? 'Eingefügter Text' : state.fileName;
  box.dataset.kind = kind;
  fill(
    box,
    el('h2', { text: headline }),
    el('p', {
      class: 'muted',
      text: `Quelle: ${source}${d.fields.offerNumber?.value ? ` · Angebot ${d.fields.offerNumber.value}` : ''}`,
    }),
    el(
      'div',
      { class: 'chips' },
      el('span', { class: 'chip chip-ok', text: `✓ ${count('ok')} erkannt` }),
      warn ? el('span', { class: 'chip chip-warn', text: `! ${warn} prüfen` }) : null,
      missing ? el('span', { class: 'chip chip-error', text: `✕ ${missing} fehlt` }) : null,
      checks.length
        ? el('span', {
            class: `chip ${failed ? 'chip-warn' : 'chip-ok'}`,
            text: `Rechenprüfung ${checks.length - failed}/${checks.length}`,
          })
        : null,
    ),
    d.items?.note ? el('p', { class: 'summary-note', text: d.items.note }) : null,
  );
}

function renderLog() {
  const box = $('#log-content');
  const d = state.draft;
  if (!d) {
    fill(box, el('p', { class: 'muted', text: 'Keine automatische Erkennung durchgeführt.' }));
    return;
  }
  fill(
    box,
    el('h3', { text: 'Prüfungen' }),
    el(
      'ul',
      { class: 'checklist' },
      d.checks.map((c) =>
        el(
          'li',
          { class: c.ok ? 'is-ok' : 'is-fail' },
          el('strong', { text: `${c.ok ? '✓' : '✕'} ${c.label}` }),
          el('span', { text: ` – ${c.detail}` }),
        ),
      ),
    ),
    el('h3', { text: 'Herkunft der Felder' }),
    el(
      'ul',
      { class: 'checklist' },
      Object.entries(d.fields).map(([k, f]) =>
        el(
          'li',
          {},
          el('code', { text: k }),
          el('span', {
            text: ` · ${STATUS[f.status]?.text || f.status}${f.source ? ` · ${SOURCE_LABELS[f.source]}` : ''}${f.note ? ` · ${f.note}` : ''}`,
          }),
        ),
      ),
    ),
    d.log.length ? el('h3', { text: 'Protokoll' }) : null,
    d.log.length
      ? el(
          'ul',
          { class: 'checklist' },
          d.log.map((m) => el('li', { text: m })),
        )
      : null,
  );
}
