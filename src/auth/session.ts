import type { Session }  from '../types.js';
import { setToken }      from '../api.js';

const SESSION_KEY = 'cardex_v2_session';

let _session: Session | null = null;

export function getSession(): Session | null {
  return _session;
}

export function saveSession(s: Session): void {
  _session = s;
  setToken(s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  _session = null;
  setToken(null);
  localStorage.removeItem(SESSION_KEY);
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token) return null;
    _session = s;
    setToken(s.token);
    return s;
  } catch {
    return null;
  }
}
