/**
 * Cardex — Cloudflare Worker
 * Auth: WebAuthn (Passkeys) + Magic Link (email via Brevo)
 * Storage: Cloudflare KV
 *
 * KV namespace bindings (wrangler.toml):
 *   CARDEX_KV
 *
 * Secrets (wrangler secret put <name>):
 *   JWT_SECRET      — long random string for signing JWTs
 *   BREVO_API_KEY   — from app.brevo.com → SMTP & API → API Keys
 *
 * Environment variables (wrangler.toml [vars]):
 *   FRONTEND_ORIGIN — e.g. https://vibecoded-stocard.pages.dev
 *   FRONTEND_RP_ID  — e.g. vibecoded-stocard.pages.dev  (passkeys)
 *   EMAIL_FROM      — e.g. noreply@yourdomain.com
 *   EMAIL_FROM_NAME — e.g. Cardex
 *
 * KV key schema:
 *   user:{userId}          → { id, username, email?, createdAt }
 *   cred:{credentialId}    → { userId, publicKeyCose, counter, transports }
 *   challenge:{token}      → { userId?, username?, type, expires }   TTL 5m
 *   magiclink:{token}      → { userId, email, expires }              TTL 15m
 *   email:{email}          → userId                                  (index)
 *   username:{username}    → userId                                  (index)
 *   cards:{userId}         → [ ...card objects ]
 */

// ── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin':  env.FRONTEND_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const CORS = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const path = new URL(request.url).pathname;

    try {
      // ── Passkey routes ──
      if (path === '/auth/register/begin')  return await registerBegin(request, env);
      if (path === '/auth/register/finish') return await registerFinish(request, env);
      if (path === '/auth/login/begin')     return await loginBegin(request, env);
      if (path === '/auth/login/finish')    return await loginFinish(request, env);

      // ── Magic link routes ──
      if (path === '/auth/magic/send')      return await magicSend(request, env);
      if (path === '/auth/magic/verify')    return await magicVerify(request, env);

      // ── Session ──
      if (path === '/auth/me')              return await getMe(request, env);

      // ── Cards ──
      if (path === '/cards' && request.method === 'GET')  return await getCards(request, env);
      if (path === '/cards' && request.method === 'POST') return await setCards(request, env);

      return json({ error: 'Not found' }, 404, env);
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error', detail: err.message }, 500, env);
    }
  }
};

// ════════════════════════════════════════════════════════════════════════════
//  MAGIC LINK — SEND
// ════════════════════════════════════════════════════════════════════════════

async function magicSend(request, env) {
  const { email } = await request.json();
  if (!email || !email.includes('@')) return json({ error: 'Invalid email' }, 400, env);

  const normalEmail = email.toLowerCase().trim();

  let userId = await env.CARDEX_KV.get(`email:${normalEmail}`);
  if (!userId) {
    userId = crypto.randomUUID();
    const username = normalEmail.split('@')[0].replace(/[^a-z0-9_]/gi, '').slice(0, 20) || 'user';
    await env.CARDEX_KV.put(`user:${userId}`, JSON.stringify({
      id: userId, username, email: normalEmail, createdAt: new Date().toISOString(),
    }));
    await env.CARDEX_KV.put(`email:${normalEmail}`, userId);
  }

  const token   = generateToken();
  const expires = Date.now() + 15 * 60 * 1000;

  await env.CARDEX_KV.put(
    `magiclink:${token}`,
    JSON.stringify({ userId, email: normalEmail, expires }),
    { expirationTtl: 900 }
  );

  const frontendOrigin = env.FRONTEND_ORIGIN || 'https://vibecoded-stocard.pages.dev';
  const magicUrl = `${frontendOrigin}/?magic=${token}`;

  const emailResult = await sendBrevoEmail({
    apiKey:    env.BREVO_API_KEY,
    to:        normalEmail,
    fromEmail: env.EMAIL_FROM      || 'noreply@cardex.app',
    fromName:  env.EMAIL_FROM_NAME || 'Cardex',
    subject:   'Your Cardex sign-in link',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9fb;border-radius:12px">
        <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0a0a0f">Sign in to Cardex</h1>
        <p style="color:#555;margin:0 0 28px;line-height:1.6">
          Click the button below to sign in. This link expires in <strong>15 minutes</strong> and can only be used once.
        </p>
        <a href="${magicUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c6dfa,#fa6d9a);color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">
          Sign in to Cardex
        </a>
        <p style="color:#999;font-size:12px;margin:28px 0 0;line-height:1.6">
          If you didn't request this, ignore this email.<br/>
          Or copy this link: <a href="${magicUrl}" style="color:#7c6dfa;word-break:break-all">${magicUrl}</a>
        </p>
      </div>`,
  });

  if (!emailResult.ok) {
    console.error('Brevo error:', emailResult.body);
    return json({ error: 'Failed to send email. Check BREVO_API_KEY.' }, 502, env);
  }

  return json({ ok: true }, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  MAGIC LINK — VERIFY
// ════════════════════════════════════════════════════════════════════════════

async function magicVerify(request, env) {
  const { token } = await request.json();
  if (!token) return json({ error: 'Missing token' }, 400, env);

  const data = await env.CARDEX_KV.get(`magiclink:${token}`, 'json');
  if (!data) return json({ error: 'Link expired or already used' }, 401, env);

  await env.CARDEX_KV.delete(`magiclink:${token}`);

  if (Date.now() > data.expires) return json({ error: 'Link expired' }, 401, env);

  const user = await env.CARDEX_KV.get(`user:${data.userId}`, 'json');
  if (!user) return json({ error: 'User not found' }, 404, env);

  const jwtToken = await issueToken(data.userId, env);
  return json({ token: jwtToken, userId: data.userId, username: user.username }, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  BREVO
// ════════════════════════════════════════════════════════════════════════════

async function sendBrevoEmail({ apiKey, to, fromEmail, fromName, subject, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender:      { email: fromEmail, name: fromName },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// ════════════════════════════════════════════════════════════════════════════
//  PASSKEY — REGISTER BEGIN
// ════════════════════════════════════════════════════════════════════════════

async function registerBegin(request, env) {
  const { username } = await request.json();
  if (!username || username.length < 2) return json({ error: 'Username too short' }, 400, env);

  const existing = await env.CARDEX_KV.get(`username:${username.toLowerCase()}`);
  if (existing) return json({ error: 'Username already taken' }, 409, env);

  const userId    = crypto.randomUUID();
  const challenge = generateChallenge();

  await env.CARDEX_KV.put(
    `challenge:${challenge}`,
    JSON.stringify({ userId, username, type: 'register' }),
    { expirationTtl: 300 }
  );

  return json({ options: {
    challenge,
    rp: { name: 'Cardex Loyalty Wallet', id: getRpId(env) },
    user: { id: userId, name: username, displayName: username },
    pubKeyCredParams: [
      { alg: -7,   type: 'public-key' },
      { alg: -257, type: 'public-key' },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey:             'required',
      requireResidentKey:      true,
      userVerification:        'required',
    },
    timeout:     60000,
    attestation: 'none',
  }}, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  PASSKEY — REGISTER FINISH
// ════════════════════════════════════════════════════════════════════════════

async function registerFinish(request, env) {
  const { credential, challengeToken } = await request.json();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'register')
    return json({ error: 'Invalid or expired challenge' }, 400, env);

  const { userId, username } = challengeData;

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData     = JSON.parse(new TextDecoder().decode(clientDataJSON));

  if (clientData.type     !== 'webauthn.create') return json({ error: 'Wrong ceremony type' }, 400, env);
  if (clientData.challenge !== challengeToken)   return json({ error: 'Challenge mismatch' }, 400, env);
  if (!verifyOrigin(clientData.origin, env))     return json({ error: 'Origin mismatch' }, 400, env);

  const authData = parseAttestationObject(base64urlDecode(credential.response.attestationObject));
  const credId   = bufferToBase64url(authData.credentialId);

  await env.CARDEX_KV.put(`cred:${credId}`, JSON.stringify({
    userId,
    publicKeyCose: bufferToBase64url(authData.credentialPublicKey),
    counter:       authData.counter,
    transports:    credential.response.transports || [],
  }));

  await env.CARDEX_KV.put(`user:${userId}`, JSON.stringify({ id: userId, username, createdAt: new Date().toISOString() }));
  await env.CARDEX_KV.put(`username:${username.toLowerCase()}`, userId);

  const token = await issueToken(userId, env);
  return json({ token, userId, username }, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  PASSKEY — LOGIN BEGIN
// ════════════════════════════════════════════════════════════════════════════

async function loginBegin(request, env) {
  const challenge = generateChallenge();
  await env.CARDEX_KV.put(
    `challenge:${challenge}`,
    JSON.stringify({ type: 'login' }),
    { expirationTtl: 300 }
  );

  return json({ options: {
    challenge,
    rpId:             getRpId(env),
    timeout:          60000,
    userVerification: 'required',
    allowCredentials: [],
  }}, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  PASSKEY — LOGIN FINISH
// ════════════════════════════════════════════════════════════════════════════

async function loginFinish(request, env) {
  const { credential, challengeToken } = await request.json();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'login')
    return json({ error: 'Invalid or expired challenge' }, 400, env);

  const credEntry = await env.CARDEX_KV.get(`cred:${credential.id}`, 'json');
  if (!credEntry) return json({ error: 'Credential not found' }, 404, env);

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData     = JSON.parse(new TextDecoder().decode(clientDataJSON));

  if (clientData.type     !== 'webauthn.get') return json({ error: 'Wrong ceremony type' }, 400, env);
  if (clientData.challenge !== challengeToken) return json({ error: 'Challenge mismatch' }, 400, env);
  if (!verifyOrigin(clientData.origin, env))   return json({ error: 'Origin mismatch' }, 400, env);

  const authDataBuf = base64urlDecode(credential.response.authenticatorData);
  const authData    = parseAuthenticatorData(authDataBuf);

  if (authData.counter > 0 && authData.counter <= credEntry.counter)
    return json({ error: 'Counter replay detected' }, 400, env);

  const valid = await verifyCoseSignature(
    base64urlDecode(credEntry.publicKeyCose),
    concat(authDataBuf, await sha256(clientDataJSON)),
    base64urlDecode(credential.response.signature)
  );
  if (!valid) return json({ error: 'Signature verification failed' }, 401, env);

  await env.CARDEX_KV.put(`cred:${credential.id}`, JSON.stringify({ ...credEntry, counter: authData.counter }));

  const user  = await env.CARDEX_KV.get(`user:${credEntry.userId}`, 'json');
  const token = await issueToken(credEntry.userId, env);
  return json({ token, userId: credEntry.userId, username: user?.username }, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  ME
// ════════════════════════════════════════════════════════════════════════════

async function getMe(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401, env);
  const user = await env.CARDEX_KV.get(`user:${userId}`, 'json');
  if (!user) return json({ error: 'User not found' }, 404, env);
  return json(user, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  CARDS
// ════════════════════════════════════════════════════════════════════════════

async function getCards(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401, env);
  const cards = await env.CARDEX_KV.get(`cards:${userId}`, 'json') || [];
  return json({ cards }, 200, env);
}

async function setCards(request, env) {
  const { userId, error } = await verifyToken(request, env);
  if (error) return json({ error }, 401, env);
  const { cards } = await request.json();
  if (!Array.isArray(cards)) return json({ error: 'cards must be an array' }, 400, env);
  await env.CARDEX_KV.put(`cards:${userId}`, JSON.stringify(cards));
  return json({ ok: true, count: cards.length }, 200, env);
}

// ════════════════════════════════════════════════════════════════════════════
//  JWT
// ════════════════════════════════════════════════════════════════════════════

async function getJwtKey(env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET || 'changeme-set-JWT_SECRET-in-wrangler'),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

async function issueToken(userId, env) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  }));
  const msg = `${header}.${payload}`;
  const key = await getJwtKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${msg}.${bufferToBase64url(new Uint8Array(sig))}`;
}

async function verifyToken(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Missing token' };
  try {
    const [hB64, pB64, sB64] = token.split('.');
    const key   = await getJwtKey(env);
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64urlDecode(sB64), new TextEncoder().encode(`${hB64}.${pB64}`)
    );
    if (!valid) return { error: 'Invalid token' };
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(pB64)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return { error: 'Token expired' };
    return { userId: payload.sub };
  } catch {
    return { error: 'Malformed token' };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  WEBAUTHN CRYPTO
// ════════════════════════════════════════════════════════════════════════════

function generateChallenge() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bufferToBase64url(buf);
}

function generateToken() {
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

function parseAttestationObject(buf) {
  const dv   = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;

  function readCborItem() {
    const byte      = dv.getUint8(offset++);
    const majorType = byte >> 5;
    const addInfo   = byte & 0x1f;
    let len = addInfo;
    if (addInfo === 24)      { len = dv.getUint8(offset++); }
    else if (addInfo === 25) { len = dv.getUint16(offset); offset += 2; }
    else if (addInfo === 26) { len = dv.getUint32(offset); offset += 4; }

    if (majorType === 2) { const b = new Uint8Array(buf.buffer, buf.byteOffset + offset, len); offset += len; return b; }
    if (majorType === 3) { const b = new Uint8Array(buf.buffer, buf.byteOffset + offset, len); offset += len; return new TextDecoder().decode(b); }
    if (majorType === 5) { const m = {}; for (let i = 0; i < len; i++) { const k = readCborItem(); m[k] = readCborItem(); } return m; }
    if (majorType === 4) { const a = []; for (let i = 0; i < len; i++) a.push(readCborItem()); return a; }
    if (majorType === 0) return len;
    if (majorType === 1) return -1 - len;
    return null;
  }

  return parseAuthenticatorData(readCborItem()['authData'], true);
}

function parseAuthenticatorData(buf, includeCredential = false) {
  const counter = new DataView(buf.buffer, buf.byteOffset + 33, 4).getUint32(0);
  const AT      = (buf[32] & 0x40) !== 0;
  let credentialId = null, credentialPublicKey = null;
  if (includeCredential && AT) {
    let off = 37 + 16;
    const credIdLen     = (buf[off] << 8) | buf[off + 1]; off += 2;
    credentialId        = buf.slice(off, off + credIdLen); off += credIdLen;
    credentialPublicKey = buf.slice(off);
  }
  return { counter, credentialId, credentialPublicKey };
}

async function verifyCoseSignature(coseKey, data, signature) {
  const dv   = new DataView(coseKey.buffer, coseKey.byteOffset, coseKey.byteLength);
  let offset = 0;

  function readItem() {
    const byte      = dv.getUint8(offset++);
    const majorType = byte >> 5;
    const addInfo   = byte & 0x1f;
    let len = addInfo;
    if (addInfo === 24)      { len = dv.getUint8(offset++); }
    else if (addInfo === 25) { len = dv.getUint16(offset); offset += 2; }
    if (majorType === 2) { const b = new Uint8Array(coseKey.buffer, coseKey.byteOffset + offset, len); offset += len; return b; }
    if (majorType === 0) return len;
    if (majorType === 1) return -1 - len;
    if (majorType === 5) { const m = {}; for (let i = 0; i < len; i++) { const k = readItem(); m[k] = readItem(); } return m; }
    return null;
  }

  const cose = readItem();
  const kty  = cose[1];
  const alg  = cose[3];

  if (kty === 2 && alg === -7) {
    const key = await crypto.subtle.importKey(
      'raw', concat(new Uint8Array([0x04]), cose[-2], cose[-3]),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data);
  }
  if (kty === 3 && alg === -257) {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: bufferToBase64url(cose[-1]), e: bufferToBase64url(cose[-2]), alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }
  throw new Error(`Unsupported COSE alg: kty=${kty} alg=${alg}`);
}

// ════════════════════════════════════════════════════════════════════════════
//  MISC HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getRpId(env) {
  return env.FRONTEND_RP_ID || 'vibecoded-stocard.pages.dev';
}

function verifyOrigin(origin, env) {
  const allowed = [
    env.FRONTEND_ORIGIN || 'https://vibecoded-stocard.pages.dev',
    'http://localhost:5500',
    'http://localhost:8787',
  ];
  return allowed.includes(origin);
}

async function getAndDeleteChallenge(env, token) {
  const data = await env.CARDEX_KV.get(`challenge:${token}`, 'json');
  if (data) await env.CARDEX_KV.delete(`challenge:${token}`);
  return data;
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function bufferToBase64url(buf) {
  let str = '';
  for (const byte of buf) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function json(data, status = 200, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}