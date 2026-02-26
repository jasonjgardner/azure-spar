/**
 * CORS header helpers for the build server.
 */

export type CorsHeaders = Record<string, string>;

export function createCorsHeaders(origin: string): CorsHeaders {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}

export function jsonResponse(
  data: unknown,
  corsHeaders: CorsHeaders,
  status = 200,
): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

export function errorResponse(
  message: string,
  corsHeaders: CorsHeaders,
  status = 500,
): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}
