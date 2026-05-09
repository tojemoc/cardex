import type { Env }          from './types.js';
import { corsHeaders, jsonResponse } from './lib/http.js';
import {
  registerBegin, registerFinish, loginBegin, loginFinish,
  listPasskeys, deletePasskey,
} from './auth/passkey.js';
import { magicSend, magicVerify }    from './auth/magic.js';
import { verifyToken }               from './auth/jwt.js';
import { getCards, setCards }        from './cards.js';
import { getUser }                   from './lib/kv.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get('Origin') ?? undefined;
    const cors          = corsHeaders(env, requestOrigin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const { pathname } = new URL(request.url);

    let response: Response;

    try {
      // ── Auth — passkey ──────────────────────────────────────────────────────
      if (pathname === '/auth/register/begin'  && request.method === 'POST') response = await registerBegin(request, env);
      else if (pathname === '/auth/register/finish' && request.method === 'POST') response = await registerFinish(request, env);
      else if (pathname === '/auth/login/begin'     && request.method === 'POST') response = await loginBegin(request, env);
      else if (pathname === '/auth/login/finish'    && request.method === 'POST') response = await loginFinish(request, env);
      else if (pathname === '/auth/passkeys'       && request.method === 'GET') response = await listPasskeys(request, env);
      else if (pathname === '/auth/passkeys'       && request.method === 'DELETE') response = await deletePasskey(request, env);

      // ── Auth — magic link ───────────────────────────────────────────────────
      else if (pathname === '/auth/magic/send'   && request.method === 'POST') response = await magicSend(request, env);
      else if (pathname === '/auth/magic/verify' && request.method === 'POST') response = await magicVerify(request, env);

      // ── Session ─────────────────────────────────────────────────────────────
      else if (pathname === '/auth/me' && request.method === 'GET') {
        const { userId, error } = await verifyToken(request, env);
        if (error || !userId) response = jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);
        else {
          const user = await getUser(env, userId);
          if (!user) response = jsonResponse({ error: 'User not found' }, 404, env);
          else {
            const { passkeys: _omitPasskeys, ...publicUser } = user;
            response = jsonResponse(publicUser, 200, env);
          }
        }
      }

      // ── Cards ────────────────────────────────────────────────────────────────
      else if (pathname === '/cards' && request.method === 'GET')  response = await getCards(request, env);
      else if (pathname === '/cards' && request.method === 'POST') response = await setCards(request, env);

      else response = jsonResponse({ error: 'Not found' }, 404, env);

    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      response = jsonResponse({ error: 'Internal error', detail }, 500, env);
    }

    // Stamp CORS headers onto every response — single place, covers all handlers.
    const patched = new Response(response.body, response);
    Object.entries(cors).forEach(([k, v]) => patched.headers.set(k, v));
    return patched;
  },
};

