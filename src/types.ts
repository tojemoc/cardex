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
