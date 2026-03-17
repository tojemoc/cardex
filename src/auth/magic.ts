import { authMagicSend, authMagicVerify } from '../api.js';
import type { AuthResponse }              from '../types.js';

export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  return authMagicSend(email);
}

export async function verifyMagicToken(token: string): Promise<AuthResponse> {
  return authMagicVerify(token);
}

/** Read ?magic= from the current URL, strip it, return token or null. */
export function consumeMagicTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('magic');
  if (!token) return null;

  // Remove token from URL immediately so refresh doesn't re-attempt
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, '', clean);

  return token;
}
