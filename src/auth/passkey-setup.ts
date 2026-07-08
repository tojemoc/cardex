import { authPasskeySetupSend, authPasskeySetupVerifyRequest } from '../api.js';

const SETUP_VERIFY_ATTEMPTS = 6;
const SETUP_VERIFY_BASE_MS  = 280;

export async function sendPasskeySetupEmail(email: string): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  return authPasskeySetupSend(email);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PasskeySetupVerifyOutcome =
  | { kind: 'ok'; setupToken: string; email: string }
  | { kind: 'fail'; clearUrl: boolean; error: string };

/**
 * Verify with exponential backoff. Transient failures keep ?passkey-setup= in the URL
 * so pull-to-refresh or a later load can succeed — same pattern as magic links on iOS PWA.
 */
export async function verifyPasskeySetupTokenResilient(token: string): Promise<PasskeySetupVerifyOutcome> {
  for (let attempt = 0; attempt < SETUP_VERIFY_ATTEMPTS; attempt++) {
    const r = await authPasskeySetupVerifyRequest(token);
    if (r.status === 'ok') return { kind: 'ok', setupToken: r.setupToken, email: r.email };
    if (!r.transient) {
      return {
        kind:     'fail',
        clearUrl: true,
        error:    r.detail ?? r.error ?? 'Verification failed',
      };
    }
    if (attempt < SETUP_VERIFY_ATTEMPTS - 1) {
      await delay(SETUP_VERIFY_BASE_MS * 2 ** attempt);
    }
  }
  return {
    kind:     'fail',
    clearUrl: false,
    error:
      'Could not reach the server. Refresh the page to try again — your confirmation link is still in the address bar.',
  };
}

export function peekPasskeySetupTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('passkey-setup');
}

export function clearPasskeySetupTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('passkey-setup')) return;
  params.delete('passkey-setup');
  const qs   = params.toString();
  const path = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  window.history.replaceState({}, '', `${window.location.origin}${path}`);
}
