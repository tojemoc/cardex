import type { Card } from '../types.js';

/**
 * Merge local and remote card arrays.
 *
 * Strategy: remote wins for any card id that exists in both sets
 * (server is source of truth after a successful push). Local-only
 * cards are appended so offline additions are never lost.
 *
 * TODO for family-sync: compare updatedAt timestamps and keep newer,
 * or move to a proper CRDT (e.g. Last-Write-Wins element set).
 */
export function mergeCards(local: Card[], remote: Card[]): Card[] {
  const map = new Map<string, Card>();

  // Remote first — authoritative for shared/synced cards
  for (const card of remote) map.set(card.id, card);

  // Local additions that don't exist remotely
  for (const card of local) {
    if (!map.has(card.id)) map.set(card.id, card);
  }

  return Array.from(map.values());
}
