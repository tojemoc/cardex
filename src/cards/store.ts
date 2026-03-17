import type { Card } from '../types.js';

const STORE_KEY = 'cardex_v2_cards';

let _cards: Card[] = [];

export function getCards(): Card[] {
  return _cards;
}

export function setCards(cards: Card[]): void {
  _cards = cards;
  persist();
}

export function addCard(card: Card): void {
  _cards = [card, ..._cards];
  persist();
}

export function updateCard(updated: Card): void {
  _cards = _cards.map(c => c.id === updated.id ? updated : c);
  persist();
}

export function removeCard(id: string): void {
  _cards = _cards.filter(c => c.id !== id);
  persist();
}

export function loadFromLocalStorage(): Card[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    _cards = JSON.parse(raw) as Card[];
    return _cards;
  } catch {
    return [];
  }
}

function persist(): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(_cards));
}

export function makeCard(partial: Omit<Card, 'id' | 'createdAt' | 'updatedAt'>): Card {
  const now = new Date().toISOString();
  return { ...partial, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

export function touchCard(card: Card): Card {
  return { ...card, updatedAt: new Date().toISOString() };
}
