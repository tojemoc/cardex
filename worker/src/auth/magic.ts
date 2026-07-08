import type { Env }              from '../types.js';
import { jsonResponse }          from '../lib/http.js';
import { generateRandomToken }   from '../lib/encoding.js';
import { upsertUserByEmail, getUser, putMagicLink, getAndDeleteMagicLink } from '../lib/kv.js';
import { issueToken }            from './jwt.js';
import { sendBrevoEmail, requestOrigin, buildMagicEmailHtml } from '../lib/email.js';

const MAGIC_TTL_MS      = 15 * 60 * 1_000; // 15 minutes
const MAGIC_TTL_SECONDS = 900;

// ── Send ──────────────────────────────────────────────────────────────────────

export async function magicSend(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email?: string }>();
  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Invalid email' }, 400, env);

  const userId = await upsertUserByEmail(env, email);
  const token  = generateRandomToken();

  await putMagicLink(env, token, { userId, email, expires: Date.now() + MAGIC_TTL_MS });

  const origin   = requestOrigin(request, env);
  const magicUrl = `${origin}/?magic=${token}`;

  const result = await sendBrevoEmail({
    apiKey:    env.BREVO_API_KEY,
    to:        email,
    fromEmail: env.EMAIL_FROM      || 'noreply@cardex.app',
    fromName:  env.EMAIL_FROM_NAME || 'Cardex',
    subject:   'Your Cardex sign-in link',
    html:      buildMagicEmailHtml(magicUrl),
  });

  if (!result.ok) {
    console.error('Brevo error:', result.body);
    return jsonResponse({ error: 'Failed to send email. Check BREVO_API_KEY.' }, 502, env);
  }

  return jsonResponse({ ok: true }, 200, env);
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function magicVerify(request: Request, env: Env): Promise<Response> {
  const { token } = await request.json<{ token?: string }>();
  if (!token) return jsonResponse({ error: 'Missing token' }, 400, env);

  const data = await getAndDeleteMagicLink(env, token);
  if (!data)                    return jsonResponse({ error: 'Link expired or already used' }, 401, env);
  if (Date.now() > data.expires) return jsonResponse({ error: 'Link expired' }, 401, env);

  const user = await getUser(env, data.userId);
  if (!user) return jsonResponse({ error: 'User not found' }, 404, env);

  const jwtToken = await issueToken(data.userId, env);
  return jsonResponse({ token: jwtToken, userId: data.userId, username: user.username }, 200, env);
}

