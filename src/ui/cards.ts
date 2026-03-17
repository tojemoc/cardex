import type { Card }                    from '../types.js';
import { getCards, addCard, updateCard, removeCard, makeCard, touchCard } from '../cards/store.js';
import { pushToRemote }                from '../cards/sync.js';
import { renderBarcode, renderQR }     from './barcode.js';
import { showToast }                   from './toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const COLORS = [
  'linear-gradient(135deg,#7c6dfa,#a855f7)',
  'linear-gradient(135deg,#fa6d9a,#f43f5e)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#38bdf8,#3b82f6)',
  'linear-gradient(135deg,#fbbf24,#f97316)',
  'linear-gradient(135deg,#6366f1,#4f46e5)',
  'linear-gradient(135deg,#f472b6,#ec4899)',
  'linear-gradient(135deg,#2dd4bf,#14b8a6)',
  'linear-gradient(135deg,#64748b,#475569)',
];

export const EMOJIS = ['🛒','💊','👗','☕','⛽','✈️','🍔','🎮','📦','🏥','💄','👟','🏠','🎵','🐾','💪','🍕','🌟'];

// ── State ─────────────────────────────────────────────────────────────────────

let currentCardId: string | null = null;
let currentFilter = 'all';
let barcodeView: 'barcode' | 'qr' = 'barcode';
let editMode = false;
let selectedColor = COLORS[0]!;
let selectedEmoji = EMOJIS[0]!;

// ── Card grid ─────────────────────────────────────────────────────────────────

export function renderCards(): void {
  const grid  = document.getElementById('card-grid');
  const count = document.getElementById('cards-count');
  if (!grid) return;

  const query = ((document.getElementById('search-input') as HTMLInputElement)?.value ?? '').toLowerCase();
  let filtered = getCards();
  if (currentFilter !== 'all') filtered = filtered.filter(c => c.category === currentFilter);
  if (query) filtered = filtered.filter(c =>
    c.name.toLowerCase().includes(query) || c.number.toLowerCase().includes(query)
  );

  if (count) count.textContent = `${filtered.length} card${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    const allEmpty = getCards().length === 0;
    grid.innerHTML = `
      <div style="grid-column:1/-1">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="5" width="20" height="14" rx="3"/><line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
          <h3>${allEmpty ? 'No cards yet' : 'No matches'}</h3>
          <p>${allEmpty ? 'Tap + to add your first loyalty card.' : 'Try a different search or category.'}</p>
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => `
    <div class="card-tile" style="background:${c.color}" data-card-id="${c.id}">
      <div>
        <div class="card-tile-icon">${c.emoji}</div>
        <div class="card-tile-name">${esc(c.name)}</div>
        <div class="card-tile-number">${esc(c.number)}</div>
      </div>
      ${c.notes ? `<div class="card-tile-points">${esc(c.notes)}</div>` : ''}
    </div>`).join('');

  grid.querySelectorAll<HTMLElement>('.card-tile').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset['cardId'];
      if (id) openDetail(id);
    });
  });
}

export function filterByCategory(el: HTMLElement, cat: string): void {
  currentFilter = cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderCards();
}

// ── Detail sheet ──────────────────────────────────────────────────────────────

export function openDetail(id: string): void {
  const card = getCards().find(c => c.id === id);
  if (!card) return;
  currentCardId = id;
  barcodeView = card.format === 'QR' ? 'qr' : 'barcode';

  setText('detail-icon',           card.emoji);
  setText('detail-name',           card.name);
  setText('detail-sub',            cap(card.category));
  setText('detail-points',         card.notes);
  setText('detail-barcode-number', card.number);

  const hdr = document.getElementById('detail-card-header');
  if (hdr) hdr.style.background = card.color;

  const hint = document.getElementById('brightness-hint');
  if (hint) hint.style.display = 'block';

  openSheet('detail-overlay');
  setTimeout(() => renderDetailBarcode(card), 50);

  if ('wakeLock' in navigator) {
    (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<unknown> } })
      .wakeLock.request('screen').catch(() => {});
  }
}

export function switchBarcodeView(view: 'barcode' | 'qr'): void {
  barcodeView = view;
  const card = getCards().find(c => c.id === currentCardId);
  if (card) renderDetailBarcode(card);
}

function renderDetailBarcode(card: Card): void {
  const barcodeContainer = document.getElementById('barcode-container');
  const qrContainer      = document.getElementById('qr-container');
  const btnBarcode       = document.getElementById('btn-barcode');
  const btnQr            = document.getElementById('btn-qr');
  if (!barcodeContainer || !qrContainer) return;

  if (barcodeView === 'qr' || card.format === 'QR') {
    barcodeContainer.style.display = 'none';
    qrContainer.style.display      = 'block';
    btnBarcode?.classList.remove('active');
    btnQr?.classList.add('active');
    renderQR('qr-container', card.number);
  } else {
    barcodeContainer.style.display = 'block';
    qrContainer.style.display      = 'none';
    btnBarcode?.classList.add('active');
    btnQr?.classList.remove('active');
    const svg = document.getElementById('barcode-svg');
    if (svg) svg.innerHTML = '';
    if (!renderBarcode('barcode-svg', card.number, card.format)) {
      barcodeContainer.innerHTML =
        '<p style="color:#999;font-size:13px;text-align:center;padding:20px">Could not render — switch to QR.</p>';
    }
  }
}

// ── Add / Edit form ───────────────────────────────────────────────────────────

export function openAddSheet(prefill?: Card): void {
  editMode = !!prefill;
  setText('add-sheet-title', editMode ? 'Edit Card' : 'Add Card');

  setValue('f-name',     prefill?.name     ?? '');
  setValue('f-number',   prefill?.number   ?? '');
  setValue('f-format',   prefill?.format   ?? 'CODE128');
  setValue('f-category', prefill?.category ?? 'grocery');
  setValue('f-notes',    prefill?.notes    ?? '');

  selectedColor = prefill?.color ?? COLORS[0]!;
  selectedEmoji = prefill?.emoji ?? EMOJIS[0]!;

  buildEmojiPicker();
  buildColorPicker();

  const preview = document.getElementById('form-barcode-preview');
  if (preview) preview.innerHTML = '<p class="preview-error">Enter a card number above</p>';
  if (prefill?.number) setTimeout(updateFormPreview, 50);

  openSheet('add-overlay');
}

export function openEditSheet(): void {
  const card = getCards().find(c => c.id === currentCardId);
  if (!card) return;
  closeSheet('detail-overlay');
  setTimeout(() => openAddSheet(card), 200);
}

export async function saveCard(): Promise<void> {
  const name     = getVal('f-name');
  const number   = getVal('f-number');
  const format   = getVal('f-format');
  const category = getVal('f-category');
  const notes    = getVal('f-notes');

  if (!name)   { showToast('Please enter a store name'); return; }
  if (!number) { showToast('Please enter a card number'); return; }

  if (editMode && currentCardId) {
    const existing = getCards().find(c => c.id === currentCardId);
    if (existing) {
      updateCard(touchCard({ ...existing, name, number, format, category, notes, color: selectedColor, emoji: selectedEmoji }));
      showToast('Card updated!');
    }
  } else {
    addCard(makeCard({ name, number, format, category, notes, color: selectedColor, emoji: selectedEmoji }));
    showToast('Card added! 🎉');
  }

  closeSheet('add-overlay');
  renderCards();
  await pushToRemote();
}

export async function deleteCurrentCard(): Promise<void> {
  if (!currentCardId || !confirm('Delete this card?')) return;
  removeCard(currentCardId);
  closeSheet('detail-overlay');
  renderCards();
  showToast('Card deleted');
  await pushToRemote();
}

// ── Form preview ──────────────────────────────────────────────────────────────

export function updateFormPreview(): void {
  const number  = getVal('f-number');
  const format  = getVal('f-format');
  const wrap    = document.getElementById('form-barcode-preview');
  if (!wrap) return;

  if (!number) { wrap.innerHTML = '<p class="preview-error">Enter a card number above</p>'; return; }

  if (format === 'QR') {
    wrap.innerHTML = '<div id="form-qr-preview"></div>';
    renderQR('form-qr-preview', number);
    return;
  }

  wrap.innerHTML = '<svg id="form-barcode-svg"></svg>';
  if (!renderBarcode('form-barcode-svg', number, format))
    wrap.innerHTML = `<p class="preview-error">⚠️ Invalid for ${format}. Try CODE 128 or QR.</p>`;
}

// ── Pickers ───────────────────────────────────────────────────────────────────

export function buildEmojiPicker(): void {
  const el = document.getElementById('emoji-picker');
  if (!el) return;
  el.innerHTML = EMOJIS.map(e =>
    `<div class="emoji-opt ${e === selectedEmoji ? 'selected' : ''}" data-emoji="${e}">${e}</div>`
  ).join('');
  el.querySelectorAll<HTMLElement>('.emoji-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedEmoji = opt.dataset['emoji'] ?? EMOJIS[0]!;
      el.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

export function buildColorPicker(): void {
  const el = document.getElementById('color-picker');
  if (!el) return;
  el.innerHTML = COLORS.map(c =>
    `<div class="color-swatch ${c === selectedColor ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`
  ).join('');
  el.querySelectorAll<HTMLElement>('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      selectedColor = sw.dataset['color'] ?? COLORS[0]!;
      el.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

export function openSheet(id: string): void {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeSheet(id: string): void {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

export function closeOnBackdrop(e: MouseEvent, id: string): void {
  if ((e.target as HTMLElement).id === id) closeSheet(id);
}

// ── Nav ───────────────────────────────────────────────────────────────────────

export function showPage(page: string): void {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`nav-${page}`)?.classList.add('active');
  const fab = document.querySelector<HTMLElement>('.fab');
  if (fab) fab.style.display = page === 'home' ? 'flex' : 'none';
}

export function toggleSearch(): void {
  const bar = document.getElementById('search-bar');
  if (!bar) return;
  const vis = bar.style.display !== 'none';
  bar.style.display = vis ? 'none' : 'block';
  if (!vis) document.getElementById('search-input')?.focus();
  else {
    (document.getElementById('search-input') as HTMLInputElement).value = '';
    renderCards();
  }
}

// ── Export / Import ───────────────────────────────────────────────────────────

export function exportCards(): void {
  const blob = new Blob([JSON.stringify(getCards(), null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'cardex-backup.json';
  a.click();
  showToast('Cards exported!');
}

export async function importCards(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text) as Card[];
    if (!Array.isArray(imported)) throw new Error('Not an array');
    const existing = new Set(getCards().map(c => c.id));
    let added = 0;
    for (const c of imported) {
      if (c.id && c.name && c.number && !existing.has(c.id)) {
        addCard(c);
        added++;
      }
    }
    renderCards();
    showToast(`Imported ${added} card(s)`);
    await pushToRemote();
  } catch {
    showToast('Import failed: invalid file');
  }
  (e.target as HTMLInputElement).value = '';
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setText(id: string, val: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setValue(id: string, val: string): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (el) el.value = val;
}

function getVal(id: string): string {
  return ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
