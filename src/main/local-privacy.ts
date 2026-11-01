/**
 * Local privacy mode (fork patch): the Electron session guard and the local block log.
 *
 * Two session classes exist. A `strict` session shows OpenBot's own content (the app window, the
 * visual reply preview) and may load only app schemes, `data:`, `blob:`, `file:` and this computer.
 * An `open` session is a browser tab: its pages are the user's choice, so only the blocked list in
 * `@openbot/contracts/local-privacy` applies.
 *
 * Electron keeps one `onBeforeRequest` listener per session. This module owns it. Do not add
 * another `onBeforeRequest` to a session.
 *
 * **This module body must stay side-effect free** (see `session-configuration.ts`): call the
 * functions from inside `app.whenReady()`.
 */

import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { isLocalPrivacyStrictAllowed, localPrivacyBlock } from "@openbot/contracts/local-privacy";
import { createOpenBotLogger } from "@openbot/logging";
import { app, type Session, session } from "electron";
import { type BlockedRequestEvent, onBlockedRequest, recordBlockedRequest } from "./local-privacy-node-guard";

const logger = createOpenBotLogger("local-privacy");

/**
 * The account of this computer. There is no account service in local privacy mode, but the app
 * and its stores are built around a signed-in user, so one fixed local user opens the app.
 */
export const LOCAL_ACCOUNT: CentralAuthUser = {
  id: "local-privacy-user",
  email: "local@localhost",
  name: null,
  avatarUrl: null,
  analyticsEnabled: false,
};

type SessionClass = "strict" | "open";

const sessionClasses = new WeakMap<Session, SessionClass>();

/**
 * Blocks requests of one session. Call it again with `strict` to make a session strict: the
 * listener is installed once and reads the class at request time.
 */
export function installSessionGuard(target: Session, sessionClass: SessionClass = "open"): void {
  const known = sessionClasses.has(target);
  // A session never becomes open again after it was made strict.
  if (!(known && sessionClasses.get(target) === "strict")) sessionClasses.set(target, sessionClass);
  if (known) return;
  target.webRequest.onBeforeRequest((details, callback) => {
    const block = localPrivacyBlock(details.url);
    if (block) {
      recordBlockedRequest("session", block.host, block.rule);
      callback({ cancel: true });
      return;
    }
    if (sessionClasses.get(target) === "strict" && !isLocalPrivacyStrictAllowed(details.url)) {
      const host = safeHost(details.url);
      recordBlockedRequest("session", host, "strict:non-local");
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}

/** Guards every session that exists now and every session Electron creates later. */
export function installLocalPrivacyGuards(): void {
  app.on("session-created", (created) => installSessionGuard(created, "open"));
  // The app window and its popups use the default session: it shows OpenBot's own pages only.
  installSessionGuard(session.defaultSession, "strict");
}

const LOG_REPEAT_MS = 60_000;

/**
 * Writes each blocked request to the local log, one line per host and channel per minute. The line
 * has the host, the rule and a count. It has no path, query, header or body.
 */
export function startBlockedRequestLog(): void {
  const lastLogged = new Map<string, { at: number; suppressed: number }>();
  onBlockedRequest((event: BlockedRequestEvent) => {
    const key = `${event.channel}:${event.host}:${event.rule}`;
    const previous = lastLogged.get(key);
    if (previous && event.at - previous.at < LOG_REPEAT_MS) {
      previous.suppressed += 1;
      return;
    }
    lastLogged.set(key, { at: event.at, suppressed: 0 });
    logger.warn("Blocked an outgoing request.", {
      channel: event.channel,
      host: event.host,
      rule: event.rule,
      repeatedSinceLast: previous?.suppressed ?? 0,
    });
  });
}
