// ── KV value shapes ───────────────────────────────────────────────────────────

/** Stored passkey metadata for listing / removal (credential public key stays under cred:*). */
export interface PasskeyMeta {
  id:         string; // WebAuthn credential id (base64url)
  createdAt:  string; // ISO
  transports: string[];
}

export interface User {
  id:        string;
  username:  string;
  email:     string;
  createdAt: string;
  /** Passkeys registered for this account (backfilled on login when missing). */
  passkeys?: PasskeyMeta[];
}

export interface Credential {
  userId:        string;
  publicKeyCose: string; // base64url
  counter:       number;
  transports:    string[];
}

export interface ChallengeData {
  userId?: string;
  email?:  string;
  type:    'register' | 'login';
}

export interface MagicLinkData {
  userId:  string;
  email:   string;
  expires: number;
}

// ── Card shape (shared with frontend) ────────────────────────────────────────

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
  id:        string;
  deletedAt: string;
}

// ── Worker env bindings ───────────────────────────────────────────────────────

export interface Env {
  CARDEX_KV:       KVNamespace;
  JWT_SECRET:      string;
  BREVO_API_KEY:   string;
  FRONTEND_ORIGIN: string;
  FRONTEND_RP_ID:  string;
  EMAIL_FROM:      string;
  EMAIL_FROM_NAME: string;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface AuthResponse {
  token:    string;
  userId:   string;
  username: string;
}

export interface ApiError {
  error:   string;
  detail?: string;
}
