import { authMagicSend, authMagicVerify, authMagicVerifyRequest } from '../api.js';
import type { AuthResponse }                                      from '../types.js';

const MAGIC_VERIFY_ATTEMPTS = 6;
const MAGIC_VERIFY_BASE_MS  = 280;

export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  return authMagicSend(email);
}

export async function verifyMagicToken(token: string): Promise<AuthResponse> {
  return authMagicVerify(token);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MagicVerifyOutcome =
  | { kind: 'ok'; data: AuthResponse }
  | { kind: 'fail'; clearUrl: boolean; error: string };

/**
 * Verify with exponential backoff. Transient failures (network, 5xx) keep the
 * magic token in the URL so pull-to-refresh or a later load can succeed — important
 * for Safari tab vs Home Screen web app timing.
 */
export async function verifyMagicTokenResilient(token: string): Promise<MagicVerifyOutcome> {
  for (let attempt = 0; attempt < MAGIC_VERIFY_ATTEMPTS; attempt++) {
    const r = await authMagicVerifyRequest(token);
    if (r.status === 'ok') return { kind: 'ok', data: r.data };
    if (!r.transient) {
      return { kind: 'fail', clearUrl: true, error: r.error ?? 'Verification failed' };
    }
    if (attempt < MAGIC_VERIFY_ATTEMPTS - 1) {
      await delay(MAGIC_VERIFY_BASE_MS * 2 ** attempt);
    }
  }
  return {
    kind:     'fail',
    clearUrl: false,
    error:
      'Could not reach the server. Refresh the page to try again — your sign-in link is still in the address bar.',
  };
}

/** Read ?magic= without removing it (caller clears after success or definitive failure). */
export function peekMagicTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('magic');
}

/** Remove ?magic= from the address bar after a finished sign-in attempt. */
export function clearMagicTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('magic')) return;
  params.delete('magic');
  const qs   = params.toString();
  const path = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  window.history.replaceState({}, '', `${window.location.origin}${path}`);
}
