// Run by scripts/local-privacy-audit.ts under Node, which is the runtime of Electron's main process
// (Bun does not re-sync the named exports of `node:http` and `node:https`). It prints one JSON object:
// the name of each attempt and whether the guard blocked it.
import * as httpNamespace from "node:http";
import * as httpsNamespace from "node:https";
import { request as httpsRequest } from "node:https";
import { LocalPrivacyBlockedError } from "../src/main/local-privacy-node-guard.ts";

const attempts: Array<[string, () => unknown]> = [
  ["fetch", () => fetch("https://analytics.openbot.run/api/track", { method: "POST" })],
  ["fetch-request-object", () => fetch(new Request("https://api.openbot.run/v1/me"))],
  ["https.request-namespace", () => httpsNamespace.request({ host: "signal.openbot.run", path: "/" })],
  ["https.get-namespace", () => httpsNamespace.get("https://openbot.run/")],
  ["https.request-named-import", () => httpsRequest({ host: "api.openbot.run" })],
  ["http.request-namespace", () => httpNamespace.request("http://api.openbot.run/")],
  ["WebSocket", () => new WebSocket("wss://signal.openbot.run/ws")],
];

const results: Record<string, boolean> = {};
for (const [name, attempt] of attempts) {
  try {
    await attempt();
    results[name] = false;
  } catch (error) {
    results[name] = error instanceof LocalPrivacyBlockedError;
  }
}
process.stdout.write(`${JSON.stringify(results)}\n`);
