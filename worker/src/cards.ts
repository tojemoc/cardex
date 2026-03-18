import type { Env, Card, Tombstone } from './types.js';
import { jsonResponse }              from './lib/http.js';
import { verifyToken }               from './auth/jwt.js';
import {
  getCards      as kvGetCards,
  putCards      as kvPutCards,
  getTombstones as kvGetTombstones,
  putTombstones as kvPutTombstones,
} from './lib/kv.js';

const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function getCards(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const cards      = await kvGetCards(env, userId)      ?? [];
  const tombstones = await kvGetTombstones(env, userId) ?? [];

  return jsonResponse({ cards, tombstones }, 200, env);
}

export async function setCards(request: Request, env: Env): Promise<Response> {
  const { userId, error } = await verifyToken(request, env);
  if (error || !userId) return jsonResponse({ error: error ?? 'Unauthorized' }, 401, env);

  const body = await request.json<{ cards?: Card[]; tombstones?: Tombstone[] }>();
  if (!Array.isArray(body.cards)) return jsonResponse({ error: 'cards must be an array' }, 400, env);

  // Merge incoming tombstones with existing ones, keeping earliest deletedAt per id
  const existing   = await kvGetTombstones(env, userId) ?? [];
  const incoming   = body.tombstones ?? [];
  const merged     = mergeTombstones(existing, incoming);
  const pruned     = pruneTombstones(merged);

  await kvPutCards(env, userId, body.cards);
  await kvPutTombstones(env, userId, pruned);

  return jsonResponse({ ok: true, count: body.cards.length }, 200, env);
}

function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const ex = map.get(t.id);
    if (!ex || t.deletedAt < ex.deletedAt) map.set(t.id, t);
  }
  return Array.from(map.values());
}

function pruneTombstones(tombstones: Tombstone[]): Tombstone[] {
  const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
  return tombstones.filter(t => new Date(t.deletedAt).getTime() > cutoff);
}
