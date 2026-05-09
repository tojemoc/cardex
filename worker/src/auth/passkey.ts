import type { Env, PasskeyMeta, User }  from '../types.js';
import { jsonResponse }                 from '../lib/http.js';
import { generateRandomToken, base64urlDecode, bufferToBase64url, concat } from '../lib/encoding.js';
import { parseAttestationObject, parseAuthenticatorData, verifyCoseSignature, sha256 } from '../lib/cose.js';
import {
  getAndDeleteChallenge, putChallenge, getCredential, putCredential, getUser, putUser,
  upsertUserByEmail, deleteCredential,
} from '../lib/kv.js';
import { issueToken, verifyToken }      from './jwt.js';

function getRpId(env: Env): string {
  return env.FRONTEND_RP_ID || 'vibecoded-stocard.pages.dev';
}

function verifyOrigin(origin: string, env: Env): boolean {
  const allowed = [
    env.FRONTEND_ORIGIN || 'https://vibecoded-stocard.pages.dev',
    'http://localhost:5173',
    'http://localhost:4173',
  ];
  return allowed.includes(origin);
}

async function recordPasskeyMeta(
  env: Env,
  userId: string,
  credId: string,
  transports: string[],
): Promise<void> {
  const user = await getUser(env, userId);
  if (!user) return;
  const meta: PasskeyMeta = { id: credId, createdAt: new Date().toISOString(), transports };
  const list = [...(user.passkeys ?? [])];
  const i    = list.findIndex((p) => p.id === credId);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await putUser(env, { ...user, passkeys: list });
}

/** Backfill index when an older credential logs in but was never listed on the user row. */
async function ensurePasskeyMeta(
  env: Env,
  userId: string,
  credId: string,
  transports: string[],
): Promise<void> {
  const user = await getUser(env, userId);
  if (!user) return;
  if (user.passkeys?.some((p) => p.id === credId)) return;
  const list = [
    ...(user.passkeys ?? []),
    { id: credId, createdAt: new Date().toISOString(), transports },
  ];
  await putUser(env, { ...user, passkeys: list });
}

// ── Register begin ────────────────────────────────────────────────────────────

/**
 * Start passkey registration.
 * - With `Authorization: Bearer <jwt>`: add a passkey to the signed-in account (no body).
 * - Without JWT: `{ email }` required — same email reuses one account (magic link + passkeys).
 */
export async function registerBegin(request: Request, env: Env): Promise<Response> {
  let userId: string;
  let email:  string;
  let user:   User | null;

  if (/^Bearer\s+\S/i.test(request.headers.get('Authorization') ?? '')) {
    const { userId: uid, error } = await verifyToken(request, env);
    if (error || !uid) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);
    userId = uid;
    user   = await getUser(env, userId);
    if (!user) return jsonResponse({ error: 'User not found' }, 404, env);
    email = user.email;
  } else {
    let body: { email?: string } = {};
    try {
      body = await request.json<{ email?: string }>();
    } catch { /* empty body */ }
    const em = body.email?.toLowerCase().trim();
    if (!em || !em.includes('@')) return jsonResponse({ error: 'Invalid email' }, 400, env);
    email  = em;
    userId = await upsertUserByEmail(env, email);
    user   = await getUser(env, userId);
  }

  const challenge = generateRandomToken();

  await putChallenge(env, challenge, { userId, email, type: 'register' });

  return jsonResponse({
    options: {
      challenge,
      rp:   { name: 'Cardex Loyalty Wallet', id: getRpId(env) },
      user: {
        id:          userId,
        name:        email,
        displayName: user?.username ?? (email.split('@')[0] ?? email),
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey:             'required',
        requireResidentKey:      true,
        userVerification:        'required',
      },
      timeout:     60_000,
      attestation: 'none',
    },
  }, 200, env);
}

// ── Register finish ───────────────────────────────────────────────────────────

export async function registerFinish(request: Request, env: Env): Promise<Response> {
  const { credential, challengeToken } = await request.json<{
    credential:     { id: string; type: string; response: { clientDataJSON: string; attestationObject: string; transports?: string[] } };
    challengeToken: string;
  }>();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'register')
    return jsonResponse({ error: 'Invalid or expired challenge' }, 400, env);

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData     = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
    type: string; challenge: string; origin: string;
  };

  if (clientData.type      !== 'webauthn.create') return jsonResponse({ error: 'Wrong ceremony type' }, 400, env);
  if (clientData.challenge !== challengeToken)    return jsonResponse({ error: 'Challenge mismatch' }, 400, env);
  if (!verifyOrigin(clientData.origin, env))      return jsonResponse({ error: 'Origin mismatch' }, 400, env);

  const authData = parseAttestationObject(base64urlDecode(credential.response.attestationObject));
  if (!authData.credentialId || !authData.credentialPublicKey)
    return jsonResponse({ error: 'Missing credential data' }, 400, env);

  const credId = bufferToBase64url(authData.credentialId);

  const transports = credential.response.transports ?? [];

  await putCredential(env, credId, {
    userId:        challengeData.userId!,
    publicKeyCose: bufferToBase64url(authData.credentialPublicKey),
    counter:       authData.counter,
    transports,
  });

  await recordPasskeyMeta(env, challengeData.userId!, credId, transports);

  const user  = await getUser(env, challengeData.userId!);
  const token = await issueToken(challengeData.userId!, env);
  return jsonResponse({ token, userId: challengeData.userId, username: user?.username }, 200, env);
}

// ── Login begin ───────────────────────────────────────────────────────────────

export async function loginBegin(request: Request, env: Env): Promise<Response> {
  const challenge = generateRandomToken();
  await putChallenge(env, challenge, { type: 'login' });

  return jsonResponse({
    options: {
      challenge,
      rpId:             getRpId(env),
      timeout:          60_000,
      userVerification: 'required',
      allowCredentials: [],
    },
  }, 200, env);
}

// ── Login finish ──────────────────────────────────────────────────────────────

export async function loginFinish(request: Request, env: Env): Promise<Response> {
  const { credential, challengeToken } = await request.json<{
    credential: {
      id:   string;
      type: string;
      response: {
        clientDataJSON:    string;
        authenticatorData: string;
        signature:         string;
        userHandle?:       string | null;
      };
    };
    challengeToken: string;
  }>();

  const challengeData = await getAndDeleteChallenge(env, challengeToken);
  if (!challengeData || challengeData.type !== 'login')
    return jsonResponse({ error: 'Invalid or expired challenge' }, 400, env);

  const credEntry = await getCredential(env, credential.id);
  if (!credEntry) return jsonResponse({ error: 'Credential not found' }, 404, env);

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData     = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
    type: string; challenge: string; origin: string;
  };

  if (clientData.type      !== 'webauthn.get') return jsonResponse({ error: 'Wrong ceremony type' }, 400, env);
  if (clientData.challenge !== challengeToken)  return jsonResponse({ error: 'Challenge mismatch' }, 400, env);
  if (!verifyOrigin(clientData.origin, env))    return jsonResponse({ error: 'Origin mismatch' }, 400, env);

  const authDataBuf = base64urlDecode(credential.response.authenticatorData);
  const authData    = parseAuthenticatorData(authDataBuf);

  if (authData.counter > 0 && authData.counter <= credEntry.counter)
    return jsonResponse({ error: 'Counter replay detected' }, 400, env);

  const clientDataHash = await sha256(clientDataJSON);
  const signedData     = concat(authDataBuf, clientDataHash);
  const valid          = await verifyCoseSignature(
    base64urlDecode(credEntry.publicKeyCose),
    signedData,
    base64urlDecode(credential.response.signature),
  );
  if (!valid) return jsonResponse({ error: 'Signature verification failed' }, 401, env);

  await putCredential(env, credential.id, { ...credEntry, counter: authData.counter });

  await ensurePasskeyMeta(env, credEntry.userId, credential.id, credEntry.transports);

  const user  = await getUser(env, credEntry.userId);
  const token = await issueToken(credEntry.userId, env);
  return jsonResponse({ token, userId: credEntry.userId, username: user?.username }, 200, env);
}

// ── Passkey list / revoke (authenticated) ─────────────────────────────────────

export async function listPasskeys(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const user = await getUser(env, userId);
  if (!user) return jsonResponse({ error: 'User not found' }, 404, env);

  return jsonResponse({ passkeys: user.passkeys ?? [] }, 200, env);
}

export async function deletePasskey(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const credId = new URL(request.url).searchParams.get('id');
  if (!credId) return jsonResponse({ error: 'Missing credential id' }, 400, env);

  const entry = await getCredential(env, credId);
  if (!entry) return jsonResponse({ error: 'Credential not found' }, 404, env);
  if (entry.userId !== userId) return jsonResponse({ error: 'Forbidden' }, 403, env);

  await deleteCredential(env, credId);

  const user = await getUser(env, userId);
  if (user?.passkeys?.length) {
    const passkeys = user.passkeys.filter((p) => p.id !== credId);
    await putUser(env, { ...user, passkeys });
  }

  return jsonResponse({ ok: true }, 200, env);
}
