import type { Env } from '../types.js';

export function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  env.FRONTEND_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function jsonResponse(
  data:   unknown,
  status: number,
  env:    Env,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'application/json',
    },
  });
}
