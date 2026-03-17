export function b64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function bufferToBase64url(buf: Uint8Array): string {
  let str = '';
  for (const byte of buf) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

export function concat(...bufs: Uint8Array[]): Uint8Array {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

export function generateRandomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bufferToBase64url(buf);
}
