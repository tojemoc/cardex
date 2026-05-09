import type { Env, User, Credential, ChallengeData, MagicLinkData, Card, Tombstone } from '../types.js';

// ── User ─────────────────────────────────────────────────────────────────────

export const getUser = (env: Env, userId: string) =>
  env.CARDEX_KV.get<User>(`user:${userId}`, 'json');

export const putUser = (env: Env, user: User) =>
  env.CARDEX_KV.put(`user:${user.id}`, JSON.stringify(user));

export const getUserIdByEmail = (env: Env, email: string) =>
  env.CARDEX_KV.get(`email:${email}`);

export const putEmailIndex = (env: Env, email: string, userId: string) =>
  env.CARDEX_KV.put(`email:${email}`, userId);

// ── Credential ────────────────────────────────────────────────────────────────

export const getCredential = (env: Env, credId: string) =>
  env.CARDEX_KV.get<Credential>(`cred:${credId}`, 'json');

export const putCredential = (env: Env, credId: string, cred: Credential) =>
  env.CARDEX_KV.put(`cred:${credId}`, JSON.stringify(cred));

export const deleteCredential = (env: Env, credId: string) =>
  env.CARDEX_KV.delete(`cred:${credId}`);

// ── Challenge ─────────────────────────────────────────────────────────────────

export const putChallenge = (env: Env, token: string, data: ChallengeData) =>
  env.CARDEX_KV.put(`challenge:${token}`, JSON.stringify(data), { expirationTtl: 300 });

export async function getAndDeleteChallenge(
  env:   Env,
  token: string,
): Promise<ChallengeData | null> {
  const data = await env.CARDEX_KV.get<ChallengeData>(`challenge:${token}`, 'json');
  if (data) await env.CARDEX_KV.delete(`challenge:${token}`);
  return data;
}

// ── Magic link ────────────────────────────────────────────────────────────────

export const putMagicLink = (env: Env, token: string, data: MagicLinkData) =>
  env.CARDEX_KV.put(`magiclink:${token}`, JSON.stringify(data), { expirationTtl: 900 });

export async function getAndDeleteMagicLink(
  env:   Env,
  token: string,
): Promise<MagicLinkData | null> {
  const data = await env.CARDEX_KV.get<MagicLinkData>(`magiclink:${token}`, 'json');
  if (data) await env.CARDEX_KV.delete(`magiclink:${token}`);
  return data;
}

// ── Cards ─────────────────────────────────────────────────────────────────────

export const getCards = (env: Env, userId: string) =>
  env.CARDEX_KV.get<Card[]>(`cards:${userId}`, 'json');

export const putCards = (env: Env, userId: string, cards: Card[]) =>
  env.CARDEX_KV.put(`cards:${userId}`, JSON.stringify(cards));

// ── Tombstones ────────────────────────────────────────────────────────────────

export const getTombstones = (env: Env, userId: string) =>
  env.CARDEX_KV.get<Tombstone[]>(`tombstones:${userId}`, 'json');

export const putTombstones = (env: Env, userId: string, tombstones: Tombstone[]) =>
  env.CARDEX_KV.put(`tombstones:${userId}`, JSON.stringify(tombstones));

// ── User upsert (shared by passkey + magic link registration) ─────────────────

export async function upsertUserByEmail(
  env:   Env,
  email: string,
): Promise<string> {
  const existing = await getUserIdByEmail(env, email);
  if (existing) return existing;

  const userId   = crypto.randomUUID();
  const username = (email.split('@')[0] ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 20) || 'user';

  await putUser(env, { id: userId, username, email, createdAt: new Date().toISOString() });
  await putEmailIndex(env, email, userId);

  return userId;
}
