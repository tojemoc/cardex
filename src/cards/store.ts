import type { Card, Tombstone } from '../types.js';

const STORE_KEY      = 'cardex_v2_cards';
const TOMBSTONE_KEY  = 'cardex_v2_tombstones';

// Tombstones older than 30 days are pruned — enough time for any device to sync.
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let _cards:      Card[]      = [];
let _tombstones: Tombstone[] = [];

// ── Cards ─────────────────────────────────────────────────────────────────────

export function getCards(): Card[] {
  return _cards;
}

export function setCards(cards: Card[]): void {
  _cards = cards;
  persistCards();
}

export function addCard(card: Card): void {
  _cards = [card, ..._cards];
  persistCards();
}

export function updateCard(updated: Card): void {
  _cards = _cards.map(c => c.id === updated.id ? updated : c);
  persistCards();
}

export function removeCard(id: string): void {
  _cards = _cards.filter(c => c.id !== id);
  addTombstone(id);
  persistCards();
}

// ── Tombstones ────────────────────────────────────────────────────────────────

export function getTombstones(): Tombstone[] {
  return _tombstones;
}

export function setTombstones(tombstones: Tombstone[]): void {
  _tombstones = tombstones;
  persistTombstones();
}

function addTombstone(id: string): void {
  // Remove any existing tombstone for this id, then add fresh one
  _tombstones = _tombstones.filter(t => t.id !== id);
  _tombstones.push({ id, deletedAt: new Date().toISOString() });
  persistTombstones();
}

function pruneTombstones(): void {
  const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
  _tombstones  = _tombstones.filter(t => new Date(t.deletedAt).getTime() > cutoff);
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadFromLocalStorage(): Card[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) _cards = JSON.parse(raw) as Card[];
  } catch { _cards = []; }

  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (raw) _tombstones = JSON.parse(raw) as Tombstone[];
    pruneTombstones();
    persistTombstones();
  } catch { _tombstones = []; }

  return _cards;
}

function persistCards(): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(_cards));
}

function persistTombstones(): void {
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(_tombstones));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function makeCard(partial: Omit<Card, 'id' | 'createdAt' | 'updatedAt'>): Card {
  const now = new Date().toISOString();
  return { ...partial, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

export function touchCard(card: Card): Card {
  return { ...card, updatedAt: new Date().toISOString() };
}
