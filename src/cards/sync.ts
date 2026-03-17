import { fetchCards, pushCards } from '../api.js';
import { getCards, setCards }   from './store.js';
import { mergeCards }           from './merge.js';
import { setSyncState }         from '../ui/toast.js';

/**
 * Pull remote cards, merge with local, push merged state back.
 * Called on login and on app open when a session exists.
 */
export async function syncOnOpen(): Promise<void> {
  setSyncState('syncing', 'Syncing…');
  try {
    const { cards: remote, error } = await fetchCards();
    if (error) throw new Error(error);

    const merged = mergeCards(getCards(), remote ?? []);
    setCards(merged);

    await pushToRemote();
    setSyncState('synced', 'Synced');
  } catch {
    setSyncState('error', 'Offline');
  }
}

/**
 * Push current local cards to the server.
 * Called after every card add / edit / delete.
 */
export async function pushToRemote(): Promise<void> {
  setSyncState('syncing', 'Saving…');
  try {
    const { error } = await pushCards(getCards());
    if (error) throw new Error(error);
    setSyncState('synced', 'Synced');
  } catch {
    setSyncState('error', 'Sync failed');
  }
}
