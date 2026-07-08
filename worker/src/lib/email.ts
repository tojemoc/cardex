import type { Env } from '../types.js';

interface BrevoOptions {
  apiKey:    string;
  to:        string;
  fromEmail: string;
  fromName:  string;
  subject:   string;
  html:      string;
}

export async function sendBrevoEmail(opts: BrevoOptions): Promise<{ ok: boolean; body: string }> {
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

export function requestOrigin(request: Request, env: Env): string {
  return request.headers.get('Origin') || env.FRONTEND_ORIGIN || 'https://vibecoded-stocard.pages.dev';
}

export function buildMagicEmailHtml(magicUrl: string): string {
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

export function buildPasskeySetupEmailHtml(setupUrl: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9fb;border-radius:12px">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0a0a0f">Confirm your Cardex account</h1>
      <p style="color:#555;margin:0 0 28px;line-height:1.6">
        Click below to verify your email and register a passkey. This link expires in <strong>15 minutes</strong> and can only be used once.
      </p>
      <a href="${setupUrl}"
         style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c6dfa,#fa6d9a);color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">
        Verify &amp; register passkey
      </a>
      <p style="color:#999;font-size:12px;margin:28px 0 0;line-height:1.6">
        If you didn't request this, you can safely ignore this email.<br/>
        Or copy this link:<br/>
        <a href="${setupUrl}" style="color:#7c6dfa;word-break:break-all">${setupUrl}</a>
      </p>
    </div>`;
}
