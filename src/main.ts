import { loadSession, saveSession, clearSession, getSession } from './auth/session.js';
import { syncOnOpen }                from './cards/sync.js';
import { loadFromLocalStorage }     from './cards/store.js';
import {
  showPanel, showAuthScreen, handleRegister,
  handleLogin, handleMagicSend, handleMagicVerify,
} from './ui/auth.js';
import {
  renderCards, filterByCategory, openDetail,
  openAddSheet, openEditSheet, saveCard, deleteCurrentCard,
  updateFormPreview, buildEmojiPicker, buildColorPicker,
  exportCards, importCards, openSheet, closeSheet,
  closeOnBackdrop, showPage, toggleSearch, switchBarcodeView,
} from './ui/cards.js';
import { showToast }                from './ui/toast.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  buildEmojiPicker();
  buildColorPicker();
  loadFromLocalStorage();

  // 1. Check for ?magic= token first
  const magicResult = await handleMagicVerify();
  if (magicResult) {
    saveSession(magicResult);
    await bootMainApp();
    return;
  }

  // 2. Restore existing session
  const session = loadSession();
  if (session) {
    await bootMainApp();
    return;
  }

  // 3. No session — show auth
  showAuthScreen();
  showPanel('login');
}

async function bootMainApp(): Promise<void> {
  const session = getSession();
  if (!session) { showAuthScreen(); return; }

  // Update user UI
  const initials = session.username.slice(0, 2).toUpperCase();
  setText('user-avatar-mini', initials);
  setText('user-name-mini',   session.username);
  setText('account-avatar',   initials);
  setText('account-name',     session.username);

  // Stamp the version into the About row
  setText('app-version', `v${__APP_VERSION__}`);

  document.getElementById('auth-screen')!.style.display    = 'none';
  document.getElementById('magic-verifying')!.style.display = 'none';
  document.getElementById('main-app')!.style.display        = 'flex';

  renderCards();
  await syncOnOpen();
}

// ── Global event wiring ───────────────────────────────────────────────────────
// Attaching handlers here keeps the UI modules free of direct DOM event binding.

function wire(): void {
  // Auth panels
  on('login-btn',        'click', async () => {
    const r = await handleLogin();
    if (r) { saveSession(r); await bootMainApp(); }
  });
  on('register-btn',     'click', async () => {
    const r = await handleRegister();
    if (r) { saveSession(r); await bootMainApp(); }
  });
  on('magic-btn',        'click', () => handleMagicSend());
  on('show-register',    'click', () => showPanel('register'));
  on('show-login',       'click', () => showPanel('login'));
  on('show-magic-login', 'click', () => showPanel('magic'));
  on('show-magic-login-2','click',() => showPanel('magic'));
  on('back-to-login',    'click', () => showPanel('login'));
  on('back-to-login-2',  'click', () => showPanel('login'));

  // Magic email — submit on Enter
  on('magic-email', 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleMagicSend();
  });
  on('reg-email', 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      document.getElementById('register-btn')?.click();
    }
  });

  // Account / sign out
  on('user-pill',    'click', () => openSheet('account-overlay'));
  on('account-avatar','click',() => openSheet('account-overlay'));
  on('sign-out-btn', 'click', () => {
    if (!confirm('Sign out?')) return;
    clearSession();
    showAuthScreen();
    showPanel('login');
  });

  // Logo — always goes home
  on('logo', 'click', () => showPage('home'));
  on('settings-btn', 'click', () => {
    const settingsPage = document.getElementById('page-settings');
    const isActive = settingsPage?.classList.contains('active');
    showPage(isActive ? 'home' : 'settings');
  });

  // Search
  on('search-btn',   'click', () => toggleSearch());
  on('search-input', 'input', () => renderCards());

  // Sync now button in settings
  on('manual-sync-settings', 'click', async () => {
    await syncOnOpen();
    showToast('Sync complete ✓');
  });

  // FAB + sheets
  on('fab-add', 'click', () => openAddSheet());

  // Backdrop close
  on('detail-overlay',  'click', e => closeOnBackdrop(e as MouseEvent, 'detail-overlay'));
  on('add-overlay',     'click', e => closeOnBackdrop(e as MouseEvent, 'add-overlay'));
  on('account-overlay', 'click', e => closeOnBackdrop(e as MouseEvent, 'account-overlay'));

  // Sheet close buttons
  document.querySelectorAll<HTMLElement>('[data-close-sheet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset['closeSheet'];
      if (target) closeSheet(target);
    });
  });

  // Category chips
  document.querySelectorAll<HTMLElement>('.chip').forEach(chip => {
    chip.addEventListener('click', () => filterByCategory(chip, chip.dataset['cat'] ?? 'all'));
  });

  // Add form
  on('f-number', 'input',  () => updateFormPreview());
  on('f-format', 'change', () => updateFormPreview());
  on('save-card-btn',    'click', () => saveCard());
  on('edit-card-btn',    'click', () => openEditSheet());
  on('delete-card-btn',  'click', () => deleteCurrentCard());

  // Barcode view toggle
  on('btn-barcode', 'click', () => switchBarcodeView('barcode'));
  on('btn-qr',      'click', () => switchBarcodeView('qr'));

  // Settings
  on('export-btn',  'click', () => exportCards());
  on('import-input','change', e => importCards(e));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function on(id: string, event: string, handler: (e: Event) => void): void {
  document.getElementById(id)?.addEventListener(event, handler);
}

function setText(id: string, val: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Run ───────────────────────────────────────────────────────────────────────

wire();
init();

// ── Background sync ───────────────────────────────────────────────────────────
// Re-sync whenever the user switches back to the tab/app. This is the main
// mechanism that makes "open on mobile and see desktop changes" work without
// manually tapping Sync.

let _lastSync = 0;
const MIN_SYNC_INTERVAL_MS = 10_000; // don't hammer the API if user tab-switches rapidly

function syncIfSession(): void {
  const session = getSession();
  if (!session) return;
  const now = Date.now();
  if (now - _lastSync < MIN_SYNC_INTERVAL_MS) return;
  _lastSync = now;
  syncOnOpen();
}

// Page becomes visible again (tab switch, app resume on mobile)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncIfSession();
});

// Device comes back online after being offline
window.addEventListener('online', () => syncIfSession());

