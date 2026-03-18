import { fetchCards, pushCards }            from '../api.js';
import { getCards, setCards, getTombstones, setTombstones } from './store.js';
import { mergeCards }                       from './merge.js';
import { setSyncState }                     from '../ui/toast.js';

/**
 * Pull remote state, merge with local (tombstones included), push merged
 * state back. Called on login and on app open when a session exists.
 */
export async function syncOnOpen(): Promise<void> {
  setSyncState('syncing', 'Syncing…');
  try {
    const { cards: remoteCards, tombstones: remoteTombstones, error } = await fetchCards();
    if (error) throw new Error(error);

    const { cards, tombstones } = mergeCards(
      getCards(),
      remoteCards      ?? [],
      getTombstones(),
      remoteTombstones ?? [],
    );

    setCards(cards);
    setTombstones(tombstones);

    await pushToRemote();
    setSyncState('synced', 'Synced');
  } catch {
    setSyncState('error', 'Offline');
  }
}

/**
 * Push current local cards + tombstones to the server.
 * Called after every card add / edit / delete.
 */
export async function pushToRemote(): Promise<void> {
  setSyncState('syncing', 'Saving…');
  try {
    const { error } = await pushCards(getCards(), getTombstones());
    if (error) throw new Error(error);
    setSyncState('synced', 'Synced');
  } catch {
    setSyncState('error', 'Sync failed');
  }
}
