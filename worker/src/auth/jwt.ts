import type { Env }                     from '../types.js';
import { b64url, base64urlDecode, bufferToBase64url } from '../lib/encoding.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function getJwtKey(env: Env): Promise<CryptoKey> {
  const secret = env.JWT_SECRET || 'changeme-set-JWT_SECRET-in-wrangler';
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueToken(userId: string, env: Env): Promise<string> {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const msg     = `${header}.${payload}`;
  const key     = await getJwtKey(env);
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${msg}.${bufferToBase64url(new Uint8Array(sig))}`;
}

export interface TokenResult {
  userId?: string;
  error?:  string;
}

export async function verifyToken(request: Request, env: Env): Promise<TokenResult> {
  const auth  = request.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Missing token' };

  try {
    const parts = token.split('.');
    const hB64  = parts[0];
    const pB64  = parts[1];
    const sB64  = parts[2];
    if (!hB64 || !pB64 || !sB64) return { error: 'Malformed token' };

    const key   = await getJwtKey(env);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sB64),
      new TextEncoder().encode(`${hB64}.${pB64}`),
    );
    if (!valid) return { error: 'Invalid token' };

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(pB64))) as { exp: number; sub: string };
    if (payload.exp < Math.floor(Date.now() / 1000)) return { error: 'Token expired' };

    return { userId: payload.sub };
  } catch {
    return { error: 'Malformed token' };
  }
}
