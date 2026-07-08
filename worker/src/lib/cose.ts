import { cborDecode }        from './cbor.js';
import { base64urlDecode, bufferToBase64url, concat } from './encoding.js';

export interface AuthenticatorData {
  counter:             number;
  credentialId:        Uint8Array | null;
  credentialPublicKey: Uint8Array | null;
}

/**
 * Parse a raw authenticatorData buffer.
 * Layout: rpIdHash(32) | flags(1) | counter(4) | [attested credential data]
 */
export function parseAuthenticatorData(
  buf:               Uint8Array,
  includeCredential = false,
): AuthenticatorData {
  const counter   = new DataView(buf.buffer, buf.byteOffset + 33, 4).getUint32(0);
  const flagsByte = buf[32] ?? 0;
  const AT        = (flagsByte & 0x40) !== 0;

  let credentialId: Uint8Array | null        = null;
  let credentialPublicKey: Uint8Array | null = null;

  if (includeCredential && AT) {
    let off           = 37 + 16; // rpIdHash(32) + flags(1) + counter(4) + aaguid(16)
    const hi          = buf[off] ?? 0;
    const lo          = buf[off + 1] ?? 0;
    const credIdLen   = (hi << 8) | lo;
    off += 2;
    credentialId      = buf.slice(off, off + credIdLen); off += credIdLen;
    credentialPublicKey = buf.slice(off);
  }

  return { counter, credentialId, credentialPublicKey };
}

/**
 * Parse a CBOR attestationObject and return the embedded authenticatorData.
 */
export function parseAttestationObject(buf: Uint8Array): AuthenticatorData {
  const obj      = cborDecode(buf) as Record<string, unknown>;
  const authData = obj['authData'] as Uint8Array;
  return parseAuthenticatorData(authData, true);
}

/**
 * Verify a COSE signature (ES256 or RS256).
 * ES256: WebAuthn authenticators often emit ASN.1 DER signatures; Web Crypto
 * expects IEEE P1363 (raw r||s). We try both encodings.
 */
export async function verifyCoseSignature(
  coseKeyBytes: Uint8Array,
  data:         Uint8Array,
  signature:    Uint8Array,
): Promise<boolean> {
  const cose = cborDecode(coseKeyBytes) as Record<number, unknown>;
  const kty  = cose[1]  as number;
  const alg  = cose[3]  as number;

  // EC P-256 / ES256
  if (kty === 2 && alg === -7) {
    const x   = cose[-2] as Uint8Array;
    const y   = cose[-3] as Uint8Array;
    const key = await crypto.subtle.importKey(
      'raw',
      concat(new Uint8Array([0x04]), x, y),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const params = { name: 'ECDSA' as const, hash: 'SHA-256' as const };

    if (await crypto.subtle.verify(params, key, signature, data)) return true;

    const raw = ecdsaDerToRaw(signature, 32);
    if (raw && raw.length === 64) {
      return crypto.subtle.verify(params, key, raw, data);
    }
    return false;
  }

  // RSA-PKCS1v15 / RS256
  if (kty === 3 && alg === -257) {
    const n   = cose[-1] as Uint8Array;
    const e   = cose[-2] as Uint8Array;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: bufferToBase64url(n), e: bufferToBase64url(e), alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }

  throw new Error(`Unsupported COSE alg: kty=${kty} alg=${alg}`);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** SHA-256 of the RP ID — must match the first 32 bytes of authenticatorData. */
export async function rpIdHash(rpId: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(rpId));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Convert ASN.1 DER ECDSA signature to IEEE P1363 (r||s) for Web Crypto verify. */
export function ecdsaDerToRaw(der: Uint8Array, fieldSize: number): Uint8Array | null {
  try {
    if (der[0] !== 0x30) return null;
    let offset = 2;
    if ((der[1]! & 0x80) !== 0) offset = 2 + (der[1]! & 0x7f);

    const readInt = (): Uint8Array | null => {
      if (der[offset] !== 0x02) return null;
      const len = der[offset + 1]!;
      const val = der.slice(offset + 2, offset + 2 + len);
      offset += 2 + len;
      return val;
    };

    const r = readInt();
    const s = readInt();
    if (!r || !s) return null;

    const raw = new Uint8Array(fieldSize * 2);
    const pad = (src: Uint8Array, dest: Uint8Array, destOff: number) => {
      const trimmed = src[0] === 0x00 && src.length > fieldSize ? src.slice(1) : src;
      const start   = destOff + fieldSize - trimmed.length;
      dest.set(trimmed, start);
    };
    pad(r, raw, 0);
    pad(s, raw, fieldSize);
    return raw;
  } catch {
    return null;
  }
}

// Re-export decode for use in passkey handler
export { base64urlDecode };
