/**
 * Local privacy mode (fork patch). The mode is always on. OpenBot sends nothing to OpenBot
 * servers or to a third party that the user did not choose. The user's choices are: the provider
 * of each agent, the pages that the user or an agent opens in the browser, and the MCP servers
 * that the user turns on.
 *
 * This file is the one place that lists what the mode blocks. The main process, the renderer and
 * the audit script (`scripts/local-privacy-audit.ts`) read it. It imports nothing, so every
 * process can load it first.
 */

export const LOCAL_PRIVACY_MODE = true as const;

/** A host and all its subdomains. Analytics, accounts, Signal, billing and hosted servers live here. */
const BLOCKED_DOMAINS = ["openbot.run"] as const;

/** A host that is only blocked for these path prefixes: the update feed and the runtime blocklist. */
const BLOCKED_PATH_PREFIXES: readonly { host: string; prefix: string }[] = [
  { host: "github.com", prefix: "/nightly-labs/" },
  { host: "raw.githubusercontent.com", prefix: "/nightly-labs/" },
  { host: "api.github.com", prefix: "/repos/nightly-labs/" },
];

export interface LocalPrivacyBlock {
  host: string;
  /** Why the request is blocked. Short, with no user data. */
  rule: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Returns the rule that blocks a URL, or null when the mode allows it. A string that is not an
 * absolute URL is allowed: it cannot leave the computer by itself.
 */
export function localPrivacyBlock(input: string | URL): LocalPrivacyBlock | null {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  for (const domain of BLOCKED_DOMAINS) {
    if (hostMatches(host, domain)) return { host, rule: `domain:${domain}` };
  }
  const path = url.pathname.toLowerCase();
  for (const { host: blockedHost, prefix } of BLOCKED_PATH_PREFIXES) {
    if (host === blockedHost && path.startsWith(prefix)) return { host, rule: `path:${blockedHost}${prefix}` };
  }
  return null;
}

export function isLocalPrivacyBlockedUrl(input: string | URL): boolean {
  return localPrivacyBlock(input) !== null;
}

/** The ports and names that mean "this computer". */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

/**
 * A strict session is one that only shows OpenBot's own content: the app window and the visual
 * reply preview. It may load app schemes, `data:`, `blob:`, `file:` and this computer, and nothing
 * else. A browser tab session is not strict: its pages are the user's choice, so only the blocked
 * list above applies.
 */
export function isLocalPrivacyStrictAllowed(input: string | URL): boolean {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return false;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === "http:" || protocol === "https:" || protocol === "ws:" || protocol === "wss:") {
    return isLoopbackHost(url.hostname);
  }
  // `devtools:`, `chrome-extension:` and the app's own `openbot-*` schemes never leave the computer.
  return true;
}
