export interface Card {
  id:        string;
  name:      string;
  number:    string;
  format:    string;
  category:  string;
  notes:     string;
  color:     string;
  emoji:     string;
  createdAt: string;
  updatedAt: string;
}

/** Records a deleted card so other devices know not to resurrect it. */
export interface Tombstone {
  id:        string; // card id
  deletedAt: string; // ISO timestamp
}

export interface PasskeyMeta {
  id:         string;
  createdAt:  string;
  transports: string[];
}

export interface Session {
  token:    string;
  userId:   string;
  username: string;
}

export interface AuthResponse {
  token:    string;
  userId:   string;
  username: string;
  error?:   string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
