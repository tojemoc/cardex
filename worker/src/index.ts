import type { Env }          from './types.js';
import { corsHeaders, jsonResponse } from './lib/http.js';
import { registerBegin, registerFinish, loginBegin, loginFinish } from './auth/passkey.js';
import { magicSend, magicVerify }    from './auth/magic.js';
import { verifyToken }               from './auth/jwt.js';
import { getCards, setCards }        from './cards.js';
import { getUser }                   from './lib/kv.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const { pathname } = new URL(request.url);

    try {
      // ── Auth — passkey ──────────────────────────────────────────────────────
      if (pathname === '/auth/register/begin'  && request.method === 'POST') return registerBegin(request, env);
      if (pathname === '/auth/register/finish' && request.method === 'POST') return registerFinish(request, env);
      if (pathname === '/auth/login/begin'     && request.method === 'POST') return loginBegin(request, env);
      if (pathname === '/auth/login/finish'    && request.method === 'POST') return loginFinish(request, env);

      // ── Auth — magic link ───────────────────────────────────────────────────
      if (pathname === '/auth/magic/send'   && request.method === 'POST') return magicSend(request, env);
      if (pathname === '/auth/magic/verify' && request.method === 'POST') return magicVerify(request, env);

      // ── Session ─────────────────────────────────────────────────────────────
      if (pathname === '/auth/me' && request.method === 'GET') {
        const { userId, error } = await verifyToken(request, env);
        if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);
        const user = await getUser(env, userId);
        if (!user) return jsonResponse({ error: 'User not found' }, 404, env);
        return jsonResponse(user, 200, env);
      }

      // ── Cards ────────────────────────────────────────────────────────────────
      if (pathname === '/cards' && request.method === 'GET')  return getCards(request, env);
      if (pathname === '/cards' && request.method === 'POST') return setCards(request, env);

      return jsonResponse({ error: 'Not found' }, 404, env);
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: 'Internal error', detail }, 500, env);
    }
  },
};
