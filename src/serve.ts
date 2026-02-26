/**
 * Server entry point for the BetterRTX build service.
 *
 * Usage:
 *   bun run src/serve.ts [--port=3000] [--db=./builds.sqlite]
 *
 * Environment variables:
 *   CORS_ORIGIN    — Allowed origin for CORS (default: "http://localhost:3000")
 *   SHADERS_PATH   — Root path for shader archives and vanilla materials
 *   DXCOMPILER_PATH — Path to dxcompiler.dll (auto-detected if omitted)
 *   DB_PATH        — Path to SQLite database (default: "./builds.sqlite")
 */

import { createServer, disposeServer } from "./server/mod.ts";
import { DEFAULT_SETTINGS } from "./betterrtx/defaults.ts";

function parseArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const port = parseInt(parseArg("--port=") ?? "3000", 10);
const dbPath = parseArg("--db=") ?? process.env["DB_PATH"] ?? "./builds.sqlite";
const corsOrigin = process.env["CORS_ORIGIN"] ?? "*";
const shadersVolume = process.env["SHADERS_PATH"] ?? "./";
const dxcPath = process.env["DXCOMPILER_PATH"];

const server = createServer(
  { port, corsOrigin, shadersVolume, dxcPath, dbPath },
  DEFAULT_SETTINGS,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Server] ${signal} received, shutting down...`);
  server.stop();
  await disposeServer();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
