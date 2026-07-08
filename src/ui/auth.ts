import { registerWithPasskey }          from '../auth/passkey.js';
import { loginWithPasskey }             from '../auth/passkey.js';
import {
  sendMagicLink,
  verifyMagicTokenResilient,
  peekMagicTokenFromUrl,
  clearMagicTokenFromUrl,
} from '../auth/magic.js';
import {
  sendPasskeySetupEmail,
  verifyPasskeySetupTokenResilient,
  peekPasskeySetupTokenFromUrl,
  clearPasskeySetupTokenFromUrl,
} from '../auth/passkey-setup.js';
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
  if (panel === 'register') {
    resetRegisterPanel();
    setTimeout(() => document.getElementById('reg-email')?.focus(), 50);
  }
}

function resetRegisterPanel(): void {
  const emailEl = document.getElementById('reg-email') as HTMLInputElement | null;
  const btn     = document.getElementById('register-btn') as HTMLButtonElement | null;
  const success = document.getElementById('register-success');
  if (emailEl) emailEl.style.display = '';
  if (btn) {
    btn.style.display = '';
    btn.disabled      = false;
    btn.textContent   = 'Send confirmation email';
  }
  success?.classList.remove('show');
  if (success) success.textContent = '';
}

// ── Auth screen visibility ────────────────────────────────────────────────────

export function showAuthScreen(): void {
  document.getElementById('auth-screen')!.style.display    = 'flex';
  document.getElementById('magic-verifying')!.style.display = 'none';
  document.getElementById('main-app')!.style.display        = 'none';
}

export function showVerifyingScreen(label = 'Signing you in…'): void {
  document.getElementById('auth-screen')!.style.display    = 'none';
  const verifying = document.getElementById('magic-verifying')!;
  verifying.style.display = 'flex';
  const p = verifying.querySelector('p');
  if (p) p.textContent = label;
  document.getElementById('main-app')!.style.display        = 'none';
}

// ── Error / success banners ───────────────────────────────────────────────────

export function showAuthError(panel: Panel, msg: string): void {
  const el = document.getElementById(`${panel}-error`);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 8000);
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

// ── Passkey register (email confirmation first) ───────────────────────────────

export async function handleRegisterSendEmail(): Promise<void> {
  const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
  if (!email || !email.includes('@')) {
    showAuthError('register', 'Please enter a valid email address');
    return;
  }
  setLoading('register-btn', true, 'Send confirmation email');
  try {
    const { ok, error, detail } = await sendPasskeySetupEmail(email);
    if (error === 'ACCOUNT_EXISTS') {
      showAuthError(
        'register',
        detail ?? 'An account with this email already exists. Sign in, then add a passkey from your profile.',
      );
      return;
    }
    if (error || !ok) {
      showAuthError('register', detail ?? error ?? 'Could not send email');
      return;
    }
    const emailEl = document.getElementById('reg-email') as HTMLInputElement;
    const btn     = document.getElementById('register-btn') as HTMLButtonElement;
    emailEl.style.display = 'none';
    btn.style.display     = 'none';
    showAuthSuccess(
      'register',
      `✉️ Confirmation link sent to ${email}. Open it on this device to register your passkey. Expires in 15 minutes.`,
    );
  } catch {
    showAuthError('register', 'Could not send email. Check your connection.');
  } finally {
    setLoading('register-btn', false, 'Send confirmation email');
  }
}

/** After ?passkey-setup= link verify — create passkey and sign in. */
export async function handlePasskeySetupAndRegister(setupToken: string): Promise<AuthResponse | null> {
  showVerifyingScreen('Creating your passkey…');
  try {
    const result = await registerWithPasskey(setupToken);
    if (result.error) {
      showAuthScreen();
      showPanel('register');
      showAuthError('register', result.error);
      return null;
    }
    return result;
  } catch (e) {
    const err = e as Error;
    showAuthScreen();
    showPanel('register');
    showAuthError(
      'register',
      err.name === 'NotAllowedError' ? 'Biometric prompt cancelled.' : err.message,
    );
    return null;
  }
}

// ── Passkey login ─────────────────────────────────────────────────────────────

export async function handleLogin(): Promise<AuthResponse | null> {
  setLoading('login-btn', true, 'Sign in with Passkey');
  try {
    const result = await loginWithPasskey();
    if (result.error) {
      const msg = result.error === 'Signature verification failed'
        ? 'Passkey sign-in failed on this device. Try a magic link, or sign in in Safari and add a passkey for this app from your profile.'
        : result.error;
      showAuthError('login', msg);
      return null;
    }
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
  const token = peekMagicTokenFromUrl();
  if (!token) return null;

  showVerifyingScreen();
  try {
    const outcome = await verifyMagicTokenResilient(token);
    if (outcome.kind === 'fail') {
      showAuthScreen();
      showPanel('magic');
      const msg =
        outcome.error === 'Link expired or already used' || outcome.error === 'Link expired'
          ? 'This link has expired or was already used. Please request a new one.'
          : outcome.error;
      showAuthError('magic', msg);
      if (outcome.clearUrl) clearMagicTokenFromUrl();
      return null;
    }
    clearMagicTokenFromUrl();
    return outcome.data;
  } catch {
    showAuthScreen();
    showPanel('magic');
    showAuthError('magic', 'Verification failed — please try again.');
    return null;
  }
}

// ── Passkey setup link verify (?passkey-setup=) ───────────────────────────────

export async function handlePasskeySetupVerify(): Promise<AuthResponse | null> {
  const token = peekPasskeySetupTokenFromUrl();
  if (!token) return null;

  showVerifyingScreen('Confirming your email…');
  try {
    const outcome = await verifyPasskeySetupTokenResilient(token);
    if (outcome.kind === 'fail') {
      showAuthScreen();
      showPanel('register');
      showAuthError('register', outcome.error);
      if (outcome.clearUrl) clearPasskeySetupTokenFromUrl();
      return null;
    }
    clearPasskeySetupTokenFromUrl();
    return handlePasskeySetupAndRegister(outcome.setupToken);
  } catch {
    showAuthScreen();
    showPanel('register');
    showAuthError('register', 'Verification failed — please try again.');
    return null;
  }
}

// ── Sign out ──────────────────────────────────────────────────────────────────

export function handleSignOut(onDone: () => void): void {
  if (!confirm('Sign out?')) return;
  clearSession();
  onDone();
}
