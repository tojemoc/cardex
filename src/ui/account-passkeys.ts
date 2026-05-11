import { authPasskeysList, authPasskeyDelete } from '../api.js';
import { registerWithPasskey }                 from '../auth/passkey.js';
import { saveSession, getSession }             from '../auth/session.js';
import { showToast }                           from './toast.js';
import type { PasskeyMeta }                    from '../types.js';

export async function refreshAccountPasskeys(): Promise<void> {
  const listEl = document.getElementById('passkeys-list');
  if (!listEl) return;

  const { passkeys, error } = await authPasskeysList();
  if (error) {
    listEl.replaceChildren();
    const p = document.createElement('p');
    p.className = 'passkeys-error';
    p.textContent = error;
    listEl.appendChild(p);
    return;
  }
  renderPasskeysList(passkeys ?? []);
}

function renderPasskeysList(items: PasskeyMeta[]): void {
  const el = document.getElementById('passkeys-list');
  if (!el) return;
  el.replaceChildren();

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'passkeys-empty';
    p.textContent = 'No passkeys yet. Add one to sign in with biometrics on this or another device.';
    el.appendChild(p);
    return;
  }

  for (const pk of items) {
    const row = document.createElement('div');
    row.className = 'passkeys-row';

    const left = document.createElement('div');
    left.className = 'passkeys-row-text';
    const dateStr = new Date(pk.createdAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const title = document.createElement('div');
    title.className = 'passkeys-row-title';
    title.textContent = `Added ${dateStr}`;
    left.appendChild(title);
    if (pk.transports?.length) {
      const sub = document.createElement('div');
      sub.className = 'passkeys-row-sub';
      sub.textContent = pk.transports.join(', ');
      left.appendChild(sub);
    }

    const rm = document.createElement('button');
    rm.type            = 'button';
    rm.className       = 'passkeys-remove-btn';
    rm.textContent     = 'Remove';
    rm.dataset.credId = pk.id;

    row.append(left, rm);
    el.appendChild(row);
  }
}

export async function handleAccountAddPasskey(): Promise<void> {
  if (!getSession()) return;
  const btn = document.getElementById('add-passkey-btn') as HTMLButtonElement | null;
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Follow the prompt…';
  }
  try {
    const result = await registerWithPasskey();
    if (result.error || !result.token) {
      showToast(result.error ?? 'Could not add passkey');
      return;
    }
    saveSession(result);
    await refreshAccountPasskeys();
    showToast('Passkey added');
  } catch (e) {
    const err = e as Error;
    showToast(err.name === 'NotAllowedError' ? 'Cancelled' : err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      if (prev) btn.textContent = prev;
    }
  }
}

export async function handleAccountRemovePasskey(credId: string): Promise<void> {
  if (!confirm('Remove this passkey? You can register it again on that device later.')) return;
  const { ok, error } = await authPasskeyDelete(credId);
  if (!ok || error) {
    showToast(error ?? 'Could not remove passkey');
    return;
  }
  await refreshAccountPasskeys();
  showToast('Passkey removed');
}
