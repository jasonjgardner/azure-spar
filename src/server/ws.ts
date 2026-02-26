/**
 * WebSocket pub-sub handlers for real-time build status updates.
 *
 * Clients auto-subscribe to the "builds" topic on connect (all events).
 * They can additionally subscribe to "build:<id>" for targeted updates.
 */

import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./types.ts";

/** Valid client-to-server message shapes. */
interface SubscribeMessage {
  readonly subscribe: string;
}

interface UnsubscribeMessage {
  readonly unsubscribe: string;
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage;

const BUILD_TOPIC_PREFIX = "build:";
const GLOBAL_TOPIC = "builds";

function isSubscribe(msg: unknown): msg is SubscribeMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "subscribe" in msg &&
    typeof (msg as SubscribeMessage).subscribe === "string"
  );
}

function isUnsubscribe(msg: unknown): msg is UnsubscribeMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "unsubscribe" in msg &&
    typeof (msg as UnsubscribeMessage).unsubscribe === "string"
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidTopic(topic: string): boolean {
  if (!topic.startsWith(BUILD_TOPIC_PREFIX)) return false;
  const id = topic.slice(BUILD_TOPIC_PREFIX.length);
  return UUID_RE.test(id);
}

/**
 * Create WebSocket handler configuration for Bun.serve().
 *
 * Returns the `websocket` config object that Bun.serve() expects.
 */
export function createWebSocketHandlers() {
  return {
    open(ws: ServerWebSocket<WebSocketData>) {
      ws.subscribe(GLOBAL_TOPIC);
    },

    message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
      const text = typeof message === "string" ? message : message.toString();

      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(text) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      if (isSubscribe(parsed)) {
        if (!isValidTopic(parsed.subscribe)) {
          ws.send(JSON.stringify({ error: "Invalid topic" }));
          return;
        }
        ws.subscribe(parsed.subscribe);
        ws.send(JSON.stringify({ subscribed: parsed.subscribe }));
        return;
      }

      if (isUnsubscribe(parsed)) {
        if (!isValidTopic(parsed.unsubscribe)) {
          ws.send(JSON.stringify({ error: "Invalid topic" }));
          return;
        }
        ws.unsubscribe(parsed.unsubscribe);
        ws.send(JSON.stringify({ unsubscribed: parsed.unsubscribe }));
        return;
      }

      ws.send(JSON.stringify({ error: "Unknown message type" }));
    },

    close(_ws: ServerWebSocket<WebSocketData>) {
      // Bun automatically cleans up topic subscriptions on close
    },
  };
}
