import type { Env }                     from '../types.js';
import { jsonResponse }                 from '../lib/http.js';
import { generateRandomToken, base64urlDecode, bufferToBase64url, concat } from '../lib/encoding.js';
import { parseAttestationObject, parseAuthenticatorData, verifyCoseSignature, sha256 } from '../lib/cose.js';
import { getAndDeleteChallenge, putChallenge, getCredential, putCredential, getUser, upsertUserByEmail } from '../lib/kv.js';
import { issueToken }                   from './jwt.js';

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

// ── Register begin ────────────────────────────────────────────────────────────

export async function registerBegin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email?: string }>();
  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Invalid email' }, 400, env);

  const userId    = await upsertUserByEmail(env, email);
  const user      = await getUser(env, userId);
  const challenge = generateRandomToken();

  await putChallenge(env, challenge, { userId, email, type: 'register' });

  return jsonResponse({
    options: {
      challenge,
      rp:   { name: 'Cardex Loyalty Wallet', id: getRpId(env) },
      user: {
        id:          userId,
        name:        email,
        displayName: user?.username ?? email.split('@')[0],
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

  await putCredential(env, credId, {
    userId:        challengeData.userId!,
    publicKeyCose: bufferToBase64url(authData.credentialPublicKey),
    counter:       authData.counter,
    transports:    credential.response.transports ?? [],
  });

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

  const user  = await getUser(env, credEntry.userId);
  const token = await issueToken(credEntry.userId, env);
  return jsonResponse({ token, userId: credEntry.userId, username: user?.username }, 200, env);
}
