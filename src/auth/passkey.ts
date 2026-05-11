import {
  authRegisterBegin, authRegisterFinish,
  authLoginBegin,    authLoginFinish,
} from '../api.js';
import type { AuthResponse } from '../types.js';

// ── Encoding helpers ──────────────────────────────────────────────────────────

function ab2b64url(buf: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(s: string): ArrayBuffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ── Register ──────────────────────────────────────────────────────────────────

/** Pass `email` on the sign-up screen; omit when signed in to pair another passkey. */
export async function registerWithPasskey(email?: string): Promise<AuthResponse> {
  const { options, error } = await authRegisterBegin(email) as { options?: any; error?: string };
  if (error || !options) throw new Error(error ?? 'Registration failed');

  const cred = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: b64urlDecode(options.challenge),
      user: { ...options.user, id: b64urlDecode(options.user.id) },
    },
  }) as PublicKeyCredential & { response: AuthenticatorAttestationResponse };

  const out = await authRegisterFinish({
    challengeToken: options.challenge,
    credential: {
      id:   cred.id,
      type: cred.type,
      response: {
        clientDataJSON:    ab2b64url(cred.response.clientDataJSON),
        attestationObject: ab2b64url(cred.response.attestationObject),
        transports:        cred.response.getTransports?.() ?? [],
      },
    },
  });
  if (out.error || !out.token) throw new Error(out.error ?? 'Registration failed');
  return out;
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginWithPasskey(): Promise<AuthResponse> {
  const { options, error } = await authLoginBegin() as { options?: any; error?: string };
  if (error || !options) throw new Error(error ?? 'Login failed');

  const cred = await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge:        b64urlDecode(options.challenge),
      allowCredentials: [],
    },
  }) as PublicKeyCredential & { response: AuthenticatorAssertionResponse };

  return authLoginFinish({
    challengeToken: options.challenge,
    credential: {
      id:   cred.id,
      type: cred.type,
      response: {
        clientDataJSON:    ab2b64url(cred.response.clientDataJSON),
        authenticatorData: ab2b64url(cred.response.authenticatorData),
        signature:         ab2b64url(cred.response.signature),
        userHandle:        cred.response.userHandle ? ab2b64url(cred.response.userHandle) : null,
      },
    },
  });
}
