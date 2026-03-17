/**
 * Cardex — Cloudflare Worker
 * WebAuthn (Passkeys) auth + KV card sync
 *
 * KV namespace bindings required (wrangler.toml):
 *   CARDEX_KV  — main data store
 *
 * KV key schema:
 *   user:{userId}            → { id, username, createdAt }
 *   cred:{credentialId}      → { userId, publicKey, counter, transports }
 *   challenge:{token}        → { userId?, expires }   (TTL 5 min)
 *   cards:{userId}           → [ ...card objects ]
 *   username:{username}      → userId   (index for lookup)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',   // tighten to your domain in production
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Entry point ────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      // Auth routes
      if (path === '/auth/register/begin')   return await registerBegin(request, env);
      if (path === '/auth/register/finish')  return await registerFinish(request, env);
      if (path === '/auth/login/begin')      return await loginBegin(request, env);
      if (path === '/auth/login/finish')     return await loginFinish(request, env);
      if (path === '/auth/me')               return await getMe(request, env);

      // Cards routes (require JWT)
      if (path === '/cards' && request.method === 'GET')  return await getCards(request, env);
      if (path === '/cards' && request.method === 'POST') return await setCards(request, env);

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error', detail: err.message }, 500);
    }
  }
};

// ════════════════════════════════════════════════════════════════
//  REGISTRATION
// ════════════════════════════════════════════════════════════════

async function registerBegin(request, env) {
  const { username } = await request.json();
  if (!username || username.length < 2) return json({ error: 'Username too short' }, 400);

  // Check username taken
  const existing = await env.CARDEX_KV.get(`username:${username.toLowerCase()}`);
  if (existing) return json({ error: 'Username already taken' }, 409);

  const userId    = crypto.randomUUID();
  const challenge = generateChallenge();

  // Store challenge with 5-min TTL
  await env.CARDEX_KV.put(
    `challenge:${challenge}`,
    JSON.stringify({ userId, username, type: 'register', expires: Date.now() + 300_000 }),
    { expirationTtl: 300 }
  );

  const options = {
    challenge,                          // base64url string
    rp: {
      name: 'Cardex Loyalty Wallet',
      id:   getRpId(request),
    },
    user: {
      id:          userId,              // base64url of user id
      name:        username,
      displayName: username,
    },
    pubKeyCredParams: [
      { alg: -7,   type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' },   // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',  // device biometrics
      residentKey:             'required',
      requireResidentKey:      true,
      userVerification:        'required',
    },
    timeout:     60000,
    attestation: 'none',
  };

  return json({ options });
}

async function registerFinish(request, env) {
  const { credential, challengeToken } = await request.json();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'register') return json({ error: 'Invalid or expired challenge' }, 400);

  const { userId, username } = challengeData;

  // Decode attestation
  const clientDataJSON   = base64urlDecode(credential.response.clientDataJSON);
  const clientData       = JSON.parse(new TextDecoder().decode(clientDataJSON));

  if (clientData.type !== 'webauthn.create')          return json({ error: 'Wrong ceremony type' }, 400);
  if (clientData.challenge !== challengeToken)        return json({ error: 'Challenge mismatch' }, 400);
  if (!verifyOrigin(clientData.origin, request))      return json({ error: 'Origin mismatch' }, 400);

  // Parse authenticatorData from attestationObject
  const attObj        = base64urlDecode(credential.response.attestationObject);
  const authData      = parseAttestationObject(attObj);
  const publicKeyCose = authData.credentialPublicKey;
  const credId        = bufferToBase64url(authData.credentialId);

  // Persist credential
  await env.CARDEX_KV.put(`cred:${credId}`, JSON.stringify({
    userId,
    publicKeyCose: bufferToBase64url(publicKeyCose),
    counter:       authData.counter,
    transports:    credential.response.transports || [],
  }));

  // Persist user
  await env.CARDEX_KV.put(`user:${userId}`, JSON.stringify({ id: userId, username, createdAt: new Date().toISOString() }));
  await env.CARDEX_KV.put(`username:${username.toLowerCase()}`, userId);

  // Issue JWT session token
  const token = await issueToken(userId, env);
  return json({ token, userId, username });
}

// ════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════

async function loginBegin(request, env) {
  // Discoverable credential flow — no username needed
  const challenge = generateChallenge();
  await env.CARDEX_KV.put(
    `challenge:${challenge}`,
    JSON.stringify({ type: 'login', expires: Date.now() + 300_000 }),
    { expirationTtl: 300 }
  );

  const options = {
    challenge,
    rpId:            getRpId(request),
    timeout:         60000,
    userVerification: 'required',
    allowCredentials: [],  // empty = discoverable (resident key)
  };

  return json({ options });
}

async function loginFinish(request, env) {
  const { credential, challengeToken } = await request.json();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'login') return json({ error: 'Invalid or expired challenge' }, 400);

  const credId    = credential.id;
  const credEntry = await env.CARDEX_KV.get(`cred:${credId}`, 'json');
  if (!credEntry) return json({ error: 'Credential not found' }, 404);

  // Decode clientDataJSON
  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData     = JSON.parse(new TextDecoder().decode(clientDataJSON));

  if (clientData.type !== 'webauthn.get')         return json({ error: 'Wrong ceremony type' }, 400);
  if (clientData.challenge !== challengeToken)    return json({ error: 'Challenge mismatch' }, 400);
  if (!verifyOrigin(clientData.origin, request))  return json({ error: 'Origin mismatch' }, 400);

  // Decode authenticatorData
  const authDataBuf = base64urlDecode(credential.response.authenticatorData);
  const authData    = parseAuthenticatorData(authDataBuf);

  if (authData.counter > 0 && authData.counter <= credEntry.counter) {
    return json({ error: 'Counter replay detected' }, 400);
  }

  // Verify signature
  const publicKeyCose  = base64urlDecode(credEntry.publicKeyCose);
  const signatureBuf   = base64urlDecode(credential.response.signature);
  const clientDataHash = await sha256(clientDataJSON);
  const signedData     = concat(authDataBuf, clientDataHash);

  const valid = await verifyCoseSignature(publicKeyCose, signedData, signatureBuf);
  if (!valid) return json({ error: 'Signature verification failed' }, 401);

  // Update counter
  await env.CARDEX_KV.put(`cred:${credId}`, JSON.stringify({ ...credEntry, counter: authData.counter }));

  const user  = await env.CARDEX_KV.get(`user:${credEntry.userId}`, 'json');
  const token = await issueToken(credEntry.userId, env);
  return json({ token, userId: credEntry.userId, username: user?.username });
}

// ════════════════════════════════════════════════════════════════
//  ME
// ════════════════════════════════════════════════════════════════

async function getMe(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401);
  const user = await env.CARDEX_KV.get(`user:${userId}`, 'json');
  if (!user) return json({ error: 'User not found' }, 404);
  return json(user);
}

// ════════════════════════════════════════════════════════════════
//  CARDS
// ════════════════════════════════════════════════════════════════

async function getCards(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401);
  const cards = await env.CARDEX_KV.get(`cards:${userId}`, 'json') || [];
  return json({ cards });
}

async function setCards(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401);
  const { cards } = await request.json();
  if (!Array.isArray(cards)) return json({ error: 'cards must be an array' }, 400);
  await env.CARDEX_KV.put(`cards:${userId}`, JSON.stringify(cards));
  return json({ ok: true, count: cards.length });
}

// ════════════════════════════════════════════════════════════════
//  JWT  (HS256 using Web Crypto HMAC-SHA256)
// ════════════════════════════════════════════════════════════════

async function getJwtKey(env) {
  const secret = env.JWT_SECRET || 'changeme-set-JWT_SECRET-in-wrangler';
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function issueToken(userId, env) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 86400*30 }));
  const msg     = `${header}.${payload}`;
  const key     = await getJwtKey(env);
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${msg}.${bufferToBase64url(new Uint8Array(sig))}`;
}

async function verifyToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Missing token' };
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const key  = await getJwtKey(env);
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      base64urlDecode(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return { error: 'Invalid token' };
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    if (payload.exp < Math.floor(Date.now()/1000)) return { error: 'Token expired' };
    return { userId: payload.sub };
  } catch {
    return { error: 'Malformed token' };
  }
}

// ════════════════════════════════════════════════════════════════
//  WEBAUTHN CRYPTO HELPERS
// ════════════════════════════════════════════════════════════════

function generateChallenge() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bufferToBase64url(buf);
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function concat(...bufs) {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

/**
 * Parse CBOR-encoded attestationObject (minimal — fmt=none only).
 * Returns { counter, credentialId, credentialPublicKey }
 */
function parseAttestationObject(buf) {
  // CBOR decode (minimal: just enough for fmt=none packed structure)
  // attestationObject = { fmt, attStmt, authData }
  // We skip fmt/attStmt and find authData bytes via CBOR map walking
  const dv     = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset   = 0;

  function readCborItem() {
    const byte      = dv.getUint8(offset++);
    const majorType = byte >> 5;
    const addInfo   = byte & 0x1f;

    let len = addInfo;
    if (addInfo === 24) { len = dv.getUint8(offset++); }
    else if (addInfo === 25) { len = dv.getUint16(offset); offset += 2; }
    else if (addInfo === 26) { len = dv.getUint32(offset); offset += 4; }

    if (majorType === 2) { // bytes
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset + offset, len);
      offset += len;
      return bytes;
    }
    if (majorType === 3) { // text
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset + offset, len);
      offset += len;
      return new TextDecoder().decode(bytes);
    }
    if (majorType === 5) { // map
      const map = {};
      for (let i = 0; i < len; i++) {
        const k = readCborItem();
        map[k]  = readCborItem();
      }
      return map;
    }
    if (majorType === 4) { // array
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(readCborItem());
      return arr;
    }
    if (majorType === 0) return len; // uint
    if (majorType === 1) return -1 - len; // negint
    return null;
  }

  const attObj  = readCborItem();
  const authData = attObj['authData'];
  return parseAuthenticatorData(authData, true);
}

function parseAuthenticatorData(buf, includeCredential = false) {
  // rpIdHash(32) | flags(1) | counter(4) | [attData if AT flag set]
  const counter = new DataView(buf.buffer, buf.byteOffset + 33, 4).getUint32(0);
  const flags   = buf[32];
  const AT      = (flags & 0x40) !== 0;

  let credentialId = null, credentialPublicKey = null;

  if (includeCredential && AT) {
    let off = 37;
    off += 16; // aaguid
    const credIdLen = (buf[off] << 8) | buf[off + 1]; off += 2;
    credentialId = buf.slice(off, off + credIdLen); off += credIdLen;
    // rest is COSE public key (variable length — take remainder)
    credentialPublicKey = buf.slice(off);
  }

  return { counter, credentialId, credentialPublicKey };
}

async function verifyCoseSignature(coseKey, data, signature) {
  // Decode COSE key (CBOR map)
  // kty(1), alg(3), crv(-1), x(-2), y(-3)  for EC2/ES256
  // kty(1), n(-1), e(-2)                    for RSA/RS256
  const dv    = new DataView(coseKey.buffer, coseKey.byteOffset, coseKey.byteLength);
  let offset  = 0;

  function readItem() {
    const byte      = dv.getUint8(offset++);
    const majorType = byte >> 5;
    const addInfo   = byte & 0x1f;
    let len = addInfo;
    if (addInfo === 24) { len = dv.getUint8(offset++); }
    else if (addInfo === 25) { len = dv.getUint16(offset); offset += 2; }

    if (majorType === 2) {
      const b = new Uint8Array(coseKey.buffer, coseKey.byteOffset + offset, len);
      offset += len; return b;
    }
    if (majorType === 0) return len;
    if (majorType === 1) return -1 - len;
    if (majorType === 5) {
      const m = {};
      for (let i = 0; i < len; i++) { const k = readItem(); m[k] = readItem(); }
      return m;
    }
    return null;
  }

  const cose = readItem();
  const kty  = cose[1];
  const alg  = cose[3];

  if (kty === 2 && alg === -7) {
    // EC P-256 / ES256
    const x = cose[-2], y = cose[-3];
    const key = await crypto.subtle.importKey(
      'raw',
      concat(new Uint8Array([0x04]), x, y),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify']
    );
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data);
  }

  if (kty === 3 && alg === -257) {
    // RSA-PKCS1v15 / RS256
    const n = cose[-1], e = cose[-2];
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty:'RSA', n: bufferToBase64url(n), e: bufferToBase64url(e), alg:'RS256', ext:true },
      { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
      false, ['verify']
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }

  throw new Error(`Unsupported COSE alg: kty=${kty} alg=${alg}`);
}

// ════════════════════════════════════════════════════════════════
//  MISC HELPERS
// ════════════════════════════════════════════════════════════════

function getRpId(request) {
  return new URL(request.url).hostname;
}

function verifyOrigin(origin, request) {
  const expected = new URL(request.url).origin;
  return origin === expected;
}

async function getAndDeleteChallenge(env, token) {
  const data = await env.CARDEX_KV.get(`challenge:${token}`, 'json');
  if (data) await env.CARDEX_KV.delete(`challenge:${token}`);
  return data;
}

function b64url(str) {
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function bufferToBase64url(buf) {
  let str = '';
  for (const byte of buf) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function base64urlDecode(str) {
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
