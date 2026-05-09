import type { Env } from '../types.js';

/**
 * Returns the allowed origins for this environment.
 */
export function allowedOrigins(env: Env): string[] {
  return [
    env.FRONTEND_ORIGIN,
    'http://localhost:5173',
    'http://localhost:4173',
  ].filter(Boolean) as string[];
}

/**
 * Build CORS headers, reflecting the request origin if it is in the
 * allowed list. A single hardcoded value would break staging preview
 * deployments and any domain other than FRONTEND_ORIGIN.
 */
export function corsHeaders(env: Env, requestOrigin?: string): Record<string, string> {
  const allowed = allowedOrigins(env);
  const origin  = requestOrigin && allowed.includes(requestOrigin)
    ? requestOrigin
    : (env.FRONTEND_ORIGIN || '*');

  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  data:   unknown,
  status: number,
  env:    Env,
): Response {
  // CORS headers are stamped at the router level in index.ts,
  // so we only need Content-Type here.
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

