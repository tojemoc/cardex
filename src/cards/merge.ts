import type { Card, Tombstone } from '../types.js';

/**
 * Merge local and remote state, respecting tombstones from both sides.
 *
 * Rules:
 *  1. Build a unified tombstone set from local + remote.
 *  2. Any card whose id appears in the tombstone set is excluded,
 *     regardless of which side has it — deletions always win.
 *  3. For cards that survive: remote wins if it exists, otherwise keep local
 *     (preserves offline additions).
 *  4. Return the merged card list and the unified tombstone list separately
 *     so the caller can push both back to the server.
 */
export interface MergeResult {
  cards:      Card[];
  tombstones: Tombstone[];
}

export function mergeCards(
  localCards:       Card[],
  remoteCards:      Card[],
  localTombstones:  Tombstone[],
  remoteTombstones: Tombstone[],
): MergeResult {
  // 1. Unify tombstones — keep the earliest deletedAt per id
  const tombstoneMap = new Map<string, Tombstone>();
  for (const t of [...remoteTombstones, ...localTombstones]) {
    const existing = tombstoneMap.get(t.id);
    if (!existing || t.deletedAt < existing.deletedAt) {
      tombstoneMap.set(t.id, t);
    }
  }
  const tombstones = Array.from(tombstoneMap.values());
  const deletedIds = tombstoneMap;

  // 2. Build card map — remote wins for existing ids, local fills in additions
  const cardMap = new Map<string, Card>();
  for (const card of remoteCards) cardMap.set(card.id, card);
  for (const card of localCards)  if (!cardMap.has(card.id)) cardMap.set(card.id, card);

  // 3. Exclude any card that has been tombstoned
  const cards = Array.from(cardMap.values()).filter(c => !deletedIds.has(c.id));

  return { cards, tombstones };
}
