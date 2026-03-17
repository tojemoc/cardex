import type { Env, Card }  from './types.js';
import { jsonResponse }    from './lib/http.js';
import { verifyToken }     from './auth/jwt.js';
import { getCards as kvGetCards, putCards as kvPutCards } from './lib/kv.js';

export async function getCards(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const cards = await kvGetCards(env, userId) ?? [];
  return jsonResponse({ cards }, 200, env);
}

export async function setCards(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const body = await request.json<{ cards?: Card[] }>();
  if (!Array.isArray(body.cards)) return jsonResponse({ error: 'cards must be an array' }, 400, env);

  await kvPutCards(env, userId, body.cards);
  return jsonResponse({ ok: true, count: body.cards.length }, 200, env);
}
