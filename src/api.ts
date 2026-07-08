import type { Card, Tombstone, AuthResponse, PasskeyMeta } from './types.js';

// ⚠️  Set this to your deployed Worker URL
export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');

let _token: string | null = null;

export function setToken(t: string | null): void {
  _token = t;
}

async function request<T>(
  path:    string,
  method:  string,
  body?:   unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Signed in: omit body. After email setup verify: pass `setupToken`. */
export const authRegisterBegin = (setupToken?: string) =>
  request<{ options: PublicKeyCredentialCreationOptionsJSON; error?: string; detail?: string }>(
    '/auth/register/begin',
    'POST',
    setupToken !== undefined ? { setupToken } : {},
  );
export const authRegisterFinish = (body: unknown)    => request<AuthResponse & { error?: string; detail?: string }>('/auth/register/finish', 'POST', body);
export const authLoginBegin     = ()                  => request<{ options: PublicKeyCredentialRequestOptionsJSON; error?: string }>('/auth/login/begin',     'POST', {});
export const authLoginFinish    = (body: unknown)    => request<AuthResponse & { error?: string }>('/auth/login/finish',    'POST', body);
export const authMagicSend      = (email: string)    => request<{ ok: boolean; error?: string }>('/auth/magic/send',   'POST', { email });
export const authMagicVerify    = (token: string)    => request<AuthResponse & { error?: string }>('/auth/magic/verify', 'POST', { token });

export const authPasskeySetupSend = (email: string) =>
  request<{ ok?: boolean; error?: string; detail?: string }>('/auth/passkey/setup/send', 'POST', { email });
export const authPasskeySetupVerify = (token: string) =>
  request<{ setupToken?: string; email?: string; error?: string; detail?: string }>('/auth/passkey/setup/verify', 'POST', { token });

/** Passkey setup verify with HTTP status — Safari / PWA retry (keep ?passkey-setup= until success). */
export type PasskeySetupVerifyRequestResult =
  | { status: 'ok'; setupToken: string; email: string }
  | { status: 'fail'; transient: boolean; error?: string; detail?: string };

export async function authPasskeySetupVerifyRequest(token: string): Promise<PasskeySetupVerifyRequestResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/passkey/setup/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    let data: { setupToken?: string; email?: string; error?: string; detail?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      const transient =
        res.status >= 500 || res.status === 0 || res.status === 429 || res.status === 408;
      return { status: 'fail', transient };
    }
    if (
      res.ok
      && data
      && typeof data === 'object'
      && data.setupToken
      && data.email
    ) {
      return { status: 'ok', setupToken: data.setupToken, email: data.email };
    }
    const transient = res.status >= 500 || res.status === 429 || res.status === 408;
    const errBody   = data && typeof data === 'object' ? data : undefined;
    return { status: 'fail', transient, error: errBody?.error ?? 'Invalid server response', detail: errBody?.detail };
  } catch {
    return { status: 'fail', transient: true };
  }
}

/** Magic verify with HTTP status — used for Safari / PWA retry logic (do not strip ?magic= until success). */
export type MagicVerifyRequestResult =
  | { status: 'ok'; data: AuthResponse }
  | { status: 'fail'; transient: boolean; error?: string };

export async function authMagicVerifyRequest(token: string): Promise<MagicVerifyRequestResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/magic/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    let data: AuthResponse & { error?: string };
    try {
      data = (await res.json()) as AuthResponse & { error?: string };
    } catch {
      const transient =
        res.status >= 500 || res.status === 0 || res.status === 429 || res.status === 408;
      return { status: 'fail', transient };
    }
    if (res.ok && data.token && data.userId) {
      return {
        status: 'ok',
        data:   { token: data.token, userId: data.userId, username: data.username },
      };
    }
    const transient = res.status >= 500 || res.status === 429 || res.status === 408;
    return { status: 'fail', transient, error: data.error };
  } catch {
    return { status: 'fail', transient: true };
  }
}
export const authMe             = ()                  => request<{ id: string; username: string; email: string }>('/auth/me', 'GET');
export const authPasskeysList   = ()                  => request<{ passkeys: PasskeyMeta[]; error?: string }>('/auth/passkeys', 'GET');
export const authPasskeyDelete  = (id: string)      =>
  request<{ ok?: boolean; error?: string }>(`/auth/passkeys?id=${encodeURIComponent(id)}`, 'DELETE');

// ── Cards ─────────────────────────────────────────────────────────────────────

export const fetchCards = ()                                        => request<{ cards: Card[]; tombstones: Tombstone[]; error?: string }>('/cards', 'GET');
export const pushCards  = (cards: Card[], tombstones: Tombstone[]) => request<{ ok: boolean; error?: string }>('/cards', 'POST', { cards, tombstones });

// ── WebAuthn JSON types (not yet in all TS libs) ──────────────────────────────
// These mirror the browser API shapes but as plain JSON (serialised over the wire).

export interface PublicKeyCredentialCreationOptionsJSON {
  challenge:              string;
  rp:                     { name: string; id: string };
  user:                   { id: string; name: string; displayName: string };
  pubKeyCredParams:       { alg: number; type: string }[];
  authenticatorSelection: Record<string, unknown>;
  timeout:                number;
  attestation:            string;
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge:        string;
  rpId:             string;
  timeout:          number;
  userVerification: string;
  allowCredentials: unknown[];
}
