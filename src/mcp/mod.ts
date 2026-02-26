/**
 * MCP server module for BetterRTX shader settings.
 *
 * Exposes a factory function to create an McpServer with all
 * resources, tools, and prompts registered. The server uses
 * Streamable HTTP transport mounted on the existing Bun HTTP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { BuildDatabase } from "../server/db.ts";
import type { RawSettings } from "../betterrtx/settings.ts";
import pkg from "../../package.json" with { type: "json" };
import { registerResources } from "./resources.ts";
import { registerTools } from "./tools.ts";
import { registerPrompts } from "./prompts.ts";

// ── Types ────────────────────────────────────────────────────────

/**
 * Context passed to MCP tools that need access to build infrastructure.
 * All fields are optional to support read-only mode without a database.
 */
export interface McpContext {
  readonly db: BuildDatabase | null;
  readonly defaults: RawSettings;
}

/** Active transport sessions keyed by session ID. */
interface SessionState {
  readonly transport: WebStandardStreamableHTTPServerTransport;
  readonly server: McpServer;
}

// ── Session Manager ──────────────────────────────────────────────

/**
 * Manages MCP sessions for the Streamable HTTP transport.
 *
 * Each session gets its own transport and McpServer connection.
 * Sessions are created on the first POST (initialize) and cleaned
 * up on DELETE or when the transport closes.
 */
export interface McpSessionManager {
  readonly handleRequest: (req: Request) => Promise<Response>;
  readonly closeAll: () => Promise<void>;
}

const MAX_SESSIONS = 50;

export function createMcpSessionManager(ctx: McpContext): McpSessionManager {
  const sessions = new Map<string, SessionState>();

  function createSession(): SessionState | null {
    if (sessions.size >= MAX_SESSIONS) return null;

    const server = createMcpServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, state);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });

    const state: SessionState = { transport, server };
    server.connect(transport).catch((err) => {
      console.error("[MCP] Transport connect error:", err);
    });
    return state;
  }

  async function handleRequest(req: Request): Promise<Response> {
    // Only POST, GET, DELETE are valid MCP methods
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const sessionId = req.headers.get("mcp-session-id");

    // New session: only allowed on POST (initialization)
    if (!sessionId) {
      if (req.method === "POST") {
        const session = createSession();
        if (!session) {
          return new Response("Service Unavailable: too many sessions", {
            status: 503,
          });
        }
        return session.transport.handleRequest(req);
      }
      return new Response("Bad Request: missing Mcp-Session-Id header", {
        status: 400,
      });
    }

    // Existing session
    const session = sessions.get(sessionId);
    if (session) {
      return session.transport.handleRequest(req);
    }

    // Unknown session ID
    return new Response("Not Found: unknown session", { status: 404 });
  }

  async function closeAll(): Promise<void> {
    const closing = [...sessions.values()].map(async ({ server, transport }) => {
      await server.close();
      await transport.close();
    });
    await Promise.all(closing);
    sessions.clear();
  }

  return { handleRequest, closeAll };
}

// ── Server Factory ───────────────────────────────────────────────

function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "azure-spar", version: pkg.version },
    {
      capabilities: { logging: {} },
      instructions: [
        "BetterRTX shader settings assistant for Minecraft Bedrock Edition.",
        "Use resources to browse available settings, categories, and tonemapping algorithms.",
        "Use tools to validate, search, create, and preview shader settings.",
        "Use prompts for guided workflows like preset creation and troubleshooting.",
      ].join(" "),
    },
  );

  registerResources(server);
  registerTools(server, ctx);
  registerPrompts(server);

  return server;
}

// ── Re-exports ───────────────────────────────────────────────────

export { McpError } from "./errors.ts";
export { SETTING_CATEGORIES, CATEGORY_NAMES } from "./setting-categories.ts";
export type { SettingMetadata, CategoryInfo } from "./setting-categories.ts";
