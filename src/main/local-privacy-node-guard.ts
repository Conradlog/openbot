/**
 * Local privacy mode: the Node network guard. The main entry point imports this file first, for
 * its side effect. It wraps `fetch`, `node:http`, `node:https` (which `ws` uses) and the global
 * `WebSocket`, so that a request to a blocked URL fails before it leaves the process.
 *
 * It is the second line of defence. The first line is that each feature is off at its source. The
 * guard catches a feature that a future upstream merge adds, and a code path that was missed.
 *
 * The guard imports only `node:*` and the contract, so it is safe to load before Electron. It does
 * not touch child processes that other programs start (provider CLIs, MCP servers): they are not
 * OpenBot code. `scripts/local-privacy-audit.ts` checks that the utility hosts have no network code.
 */

import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { localPrivacyBlock } from "@openbot/contracts/local-privacy";

export type BlockedRequestChannel = "fetch" | "http" | "https" | "websocket" | "session";

/** What is logged for a blocked request. It has the host and the rule only: no path, query or body. */
export interface BlockedRequestEvent {
  at: number;
  channel: BlockedRequestChannel;
  host: string;
  rule: string;
}

export class LocalPrivacyBlockedError extends Error {
  readonly code = "ELOCALPRIVACY";
  constructor(host: string) {
    super(`The request to ${host} is blocked by local privacy mode.`);
    this.name = "LocalPrivacyBlockedError";
  }
}

const BACKLOG_LIMIT = 200;
const backlog: BlockedRequestEvent[] = [];
const listeners = new Set<(event: BlockedRequestEvent) => void>();

export function recordBlockedRequest(channel: BlockedRequestChannel, host: string, rule: string): void {
  const event: BlockedRequestEvent = { at: Date.now(), channel, host, rule };
  if (listeners.size === 0) {
    backlog.push(event);
    if (backlog.length > BACKLOG_LIMIT) backlog.shift();
    return;
  }
  for (const listener of listeners) listener(event);
}

/** Calls the listener for each event that happened before it was added, then for each new event. */
export function onBlockedRequest(listener: (event: BlockedRequestEvent) => void): () => void {
  for (const event of backlog.splice(0)) listener(event);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function guardUrl(channel: BlockedRequestChannel, url: string | URL): void {
  const block = localPrivacyBlock(url);
  if (!block) return;
  recordBlockedRequest(channel, block.host, block.rule);
  throw new LocalPrivacyBlockedError(block.host);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The URL that a `node:http` call will use, from either of its argument forms. */
function httpTarget(defaultProtocol: "http:" | "https:", args: readonly unknown[]): URL | null {
  const [first, second] = args;
  try {
    if (typeof first === "string" || first instanceof URL) return new URL(first);
    const options = first !== null && typeof first === "object" ? first : second;
    if (options === null || typeof options !== "object") return null;
    const protocol = "protocol" in options && typeof options.protocol === "string" ? options.protocol : defaultProtocol;
    const host =
      "hostname" in options && typeof options.hostname === "string"
        ? options.hostname
        : "host" in options && typeof options.host === "string"
          ? options.host.replace(/:\d+$/, "")
          : "localhost";
    const path = "path" in options && typeof options.path === "string" ? options.path : "/";
    return new URL(
      `${protocol}//${host.includes(":") ? `[${host}]` : host}${path.startsWith("/") ? path : `/${path}`}`,
    );
  } catch {
    return null;
  }
}

function replaceFunction<Owner extends object>(owner: Owner, name: string, value: unknown): void {
  Object.defineProperty(owner, name, { value, configurable: true, writable: true, enumerable: true });
}

function guardedHttp<Args extends unknown[], Result>(
  original: (...args: Args) => Result,
  protocol: "http:" | "https:",
  channel: "http" | "https",
): (...args: Args) => Result {
  return (...args) => {
    const url = httpTarget(protocol, args);
    if (url) guardUrl(channel, url);
    return original(...args);
  };
}

let installed = false;

export function installNodeNetworkGuard(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  replaceFunction(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    try {
      guardUrl("fetch", requestUrl(input));
    } catch (error) {
      return Promise.reject(error);
    }
    return originalFetch(input, init);
  });

  replaceFunction(http, "request", guardedHttp(http.request, "http:", "http"));
  replaceFunction(http, "get", guardedHttp(http.get, "http:", "http"));
  replaceFunction(https, "request", guardedHttp(https.request, "https:", "https"));
  replaceFunction(https, "get", guardedHttp(https.get, "https:", "https"));
  syncBuiltinESMExports();

  const OriginalWebSocket = globalThis.WebSocket;
  if (OriginalWebSocket) {
    class GuardedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        guardUrl("websocket", url);
        super(url, protocols);
      }
    }
    replaceFunction(globalThis, "WebSocket", GuardedWebSocket);
  }
}

installNodeNetworkGuard();
