import { registerWithPasskey }          from '../auth/passkey.js';
import { loginWithPasskey }             from '../auth/passkey.js';
import { sendMagicLink, verifyMagicToken, consumeMagicTokenFromUrl } from '../auth/magic.js';
import { saveSession, clearSession }   from '../auth/session.js';
import type { AuthResponse }           from '../types.js';

// ── Panel switching ───────────────────────────────────────────────────────────

type Panel = 'login' | 'register' | 'magic';

export function showPanel(panel: Panel): void {
  const ids: Record<Panel, string> = {
    login:    'auth-login-panel',
    register: 'auth-register-panel',
    magic:    'auth-magic-panel',
  };
  for (const [key, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.style.display = key === panel ? 'flex' : 'none';
  }
  if (panel === 'magic') {
    setTimeout(() => document.getElementById('magic-email')?.focus(), 50);
  }
}

// ── Auth screen visibility ────────────────────────────────────────────────────

export function showAuthScreen(): void {
  document.getElementById('auth-screen')!.style.display    = 'flex';
  document.getElementById('magic-verifying')!.style.display = 'none';
  document.getElementById('main-app')!.style.display        = 'none';
}

export function showVerifyingScreen(): void {
  document.getElementById('auth-screen')!.style.display    = 'none';
  document.getElementById('magic-verifying')!.style.display = 'flex';
  document.getElementById('main-app')!.style.display        = 'none';
}

// ── Error / success banners ───────────────────────────────────────────────────

export function showAuthError(panel: Panel, msg: string): void {
  const el = document.getElementById(`${panel}-error`);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

function showAuthSuccess(panel: Panel, msg: string): void {
  const el = document.getElementById(`${panel}-success`);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

// ── Loading state ─────────────────────────────────────────────────────────────

function setLoading(btnId: string, on: boolean, label: string): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? 'Please wait…' : label;
}

// ── Passkey register ──────────────────────────────────────────────────────────

export async function handleRegister(): Promise<AuthResponse | null> {
  const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
  if (!email || !email.includes('@')) {
    showAuthError('register', 'Please enter a valid email address');
    return null;
  }
  setLoading('register-btn', true, 'Register Passkey');
  try {
    const result = await registerWithPasskey(email);
    if (result.error) { showAuthError('register', result.error); return null; }
    return result;
  } catch (e) {
    const err = e as Error;
    showAuthError('register', err.name === 'NotAllowedError' ? 'Biometric prompt cancelled.' : err.message);
    return null;
  } finally {
    setLoading('register-btn', false, 'Register Passkey');
  }
}

// ── Passkey login ─────────────────────────────────────────────────────────────

export async function handleLogin(): Promise<AuthResponse | null> {
  setLoading('login-btn', true, 'Sign in with Passkey');
  try {
    const result = await loginWithPasskey();
    if (result.error) { showAuthError('login', result.error); return null; }
    return result;
  } catch (e) {
    const err = e as Error;
    showAuthError('login', err.name === 'NotAllowedError' ? 'Biometric prompt cancelled.' : err.message);
    return null;
  } finally {
    setLoading('login-btn', false, 'Sign in with Passkey');
  }
}

// ── Magic link send ───────────────────────────────────────────────────────────

export async function handleMagicSend(): Promise<void> {
  const emailEl = document.getElementById('magic-email') as HTMLInputElement;
  const email   = emailEl.value.trim();
  if (!email || !email.includes('@')) {
    showAuthError('magic', 'Please enter a valid email address');
    return;
  }
  const btn = document.getElementById('magic-btn') as HTMLButtonElement;
  btn.disabled    = true;
  btn.textContent = 'Sending…';

  try {
    const { ok, error } = await sendMagicLink(email);
    if (error) { showAuthError('magic', error); return; }
    if (ok) {
      emailEl.style.display = 'none';
      btn.style.display     = 'none';
      showAuthSuccess('magic', `✉️ Link sent to ${email} — check your inbox. Expires in 15 minutes.`);
    }
  } catch {
    showAuthError('magic', 'Could not send email. Check your connection.');
  } finally {
    if (btn.style.display !== 'none') {
      btn.disabled    = false;
      btn.textContent = 'Send Magic Link';
    }
  }
}

// ── Magic link verify (called on page load if ?magic= present) ────────────────

export async function handleMagicVerify(): Promise<AuthResponse | null> {
  const token = consumeMagicTokenFromUrl();
  if (!token) return null;

  showVerifyingScreen();
  try {
    const result = await verifyMagicToken(token);
    if (result.error) {
      showAuthScreen();
      showPanel('magic');
      showAuthError('magic',
        result.error === 'Link expired or already used'
          ? 'This link has expired or was already used. Please request a new one.'
          : result.error,
      );
      return null;
    }
    return result;
  } catch {
    showAuthScreen();
    showPanel('magic');
    showAuthError('magic', 'Verification failed — please try again.');
    return null;
  }
}

// ── Sign out ──────────────────────────────────────────────────────────────────

export function handleSignOut(onDone: () => void): void {
  if (!confirm('Sign out?')) return;
  clearSession();
  onDone();
}
