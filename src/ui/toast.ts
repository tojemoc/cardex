import type { SyncStatus } from '../types.js';

let _toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

export function setSyncState(state: SyncStatus, label: string): void {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (!dot || !lbl) return;
  dot.className  = `sync-dot ${state}`;
  lbl.textContent = label;
}
