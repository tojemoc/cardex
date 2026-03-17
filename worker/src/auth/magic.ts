import type { Env }              from '../types.js';
import { jsonResponse }          from '../lib/http.js';
import { generateRandomToken }   from '../lib/encoding.js';
import { upsertUserByEmail, getUser, putMagicLink, getAndDeleteMagicLink } from '../lib/kv.js';
import { issueToken }            from './jwt.js';

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

  const origin   = env.FRONTEND_ORIGIN || 'https://vibecoded-stocard.pages.dev';
  const magicUrl = `${origin}/?magic=${token}`;

  const result = await sendBrevoEmail({
    apiKey:    env.BREVO_API_KEY,
    to:        email,
    fromEmail: env.EMAIL_FROM      || 'noreply@cardex.app',
    fromName:  env.EMAIL_FROM_NAME || 'Cardex',
    subject:   'Your Cardex sign-in link',
    html:      buildEmailHtml(magicUrl),
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

// ── Brevo helper ──────────────────────────────────────────────────────────────

interface BrevoOptions {
  apiKey:    string;
  to:        string;
  fromEmail: string;
  fromName:  string;
  subject:   string;
  html:      string;
}

async function sendBrevoEmail(opts: BrevoOptions): Promise<{ ok: boolean; body: string }> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method:  'POST',
    headers: {
      'api-key':      opts.apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({
      sender:      { email: opts.fromEmail, name: opts.fromName },
      to:          [{ email: opts.to }],
      subject:     opts.subject,
      htmlContent: opts.html,
    }),
  });
  return { ok: res.ok, body: await res.text() };
}

function buildEmailHtml(magicUrl: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9fb;border-radius:12px">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0a0a0f">Sign in to Cardex</h1>
      <p style="color:#555;margin:0 0 28px;line-height:1.6">
        Click the button below to sign in. This link expires in <strong>15 minutes</strong> and can only be used once.
      </p>
      <a href="${magicUrl}"
         style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c6dfa,#fa6d9a);color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">
        Sign in to Cardex
      </a>
      <p style="color:#999;font-size:12px;margin:28px 0 0;line-height:1.6">
        If you didn't request this, you can safely ignore this email.<br/>
        Or copy this link:<br/>
        <a href="${magicUrl}" style="color:#7c6dfa;word-break:break-all">${magicUrl}</a>
      </p>
    </div>`;
}
