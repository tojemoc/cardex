import type { Env } from '../types.js';
import { jsonResponse } from '../lib/http.js';
import { generateRandomToken } from '../lib/encoding.js';
import {
  getUserIdByEmail,
  upsertUserByEmail,
  getAndDeletePasskeySetupLink,
  putPasskeySetupLink,
  putPasskeySetupGrant,
} from '../lib/kv.js';
import {
  sendBrevoEmail,
  requestOrigin,
  buildPasskeySetupEmailHtml,
} from '../lib/email.js';

const SETUP_TTL_MS = 15 * 60 * 1_000;
const GRANT_TTL_MS = 10 * 60 * 1_000;

// ── Send confirmation email (new accounts only) ───────────────────────────────

export async function passkeySetupSend(request: Request, env: Env): Promise<Response> {
  let body: { email?: string } = {};
  try {
    body = await request.json<{ email?: string }>();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, env);
  }
  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Invalid email' }, 400, env);

  const existing = await getUserIdByEmail(env, email);
  if (existing) {
    return jsonResponse({
      error:  'ACCOUNT_EXISTS',
      detail: 'An account with this email already exists. Sign in, then add a passkey from your profile.',
    }, 409, env);
  }

  const token = generateRandomToken();
  await putPasskeySetupLink(env, token, { email, expires: Date.now() + SETUP_TTL_MS });

  const origin   = requestOrigin(request, env);
  const setupUrl = `${origin}/?passkey-setup=${token}`;

  const result = await sendBrevoEmail({
    apiKey:    env.BREVO_API_KEY,
    to:        email,
    fromEmail: env.EMAIL_FROM      || 'noreply@cardex.app',
    fromName:  env.EMAIL_FROM_NAME || 'Cardex',
    subject:   'Confirm your Cardex passkey registration',
    html:      buildPasskeySetupEmailHtml(setupUrl),
  });

  if (!result.ok) {
    console.error('Brevo error:', result.body);
    return jsonResponse({ error: 'Failed to send email. Check BREVO_API_KEY.' }, 502, env);
  }

  return jsonResponse({ ok: true }, 200, env);
}

// ── Verify email link → short-lived registration grant ────────────────────────

export async function passkeySetupVerify(request: Request, env: Env): Promise<Response> {
  let body: { token?: string } = {};
  try {
    body = await request.json<{ token?: string }>();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, env);
  }
  const token = body.token?.trim();
  if (!token) return jsonResponse({ error: 'Missing token' }, 400, env);

  const data = await getAndDeletePasskeySetupLink(env, token);
  if (!data)                    return jsonResponse({ error: 'Link expired or already used' }, 401, env);
  if (Date.now() > data.expires) return jsonResponse({ error: 'Link expired' }, 401, env);

  // Re-check: account may have been created since the email was sent.
  const existing = await getUserIdByEmail(env, data.email);
  if (existing) {
    return jsonResponse({
      error:  'ACCOUNT_EXISTS',
      detail: 'An account with this email already exists. Sign in, then add a passkey from your profile.',
    }, 409, env);
  }

  const userId      = await upsertUserByEmail(env, data.email);
  const setupToken  = generateRandomToken();

  await putPasskeySetupGrant(env, setupToken, {
    userId,
    email:   data.email,
    expires: Date.now() + GRANT_TTL_MS,
  });

  return jsonResponse({ setupToken, email: data.email }, 200, env);
}
