# Local privacy mode

This branch (`privacy-local`) is a personal, non-commercial patch of OpenBot. It keeps the license
and the notices unchanged (`LICENSE`, `NOTICE`, Required Notice lines). It does not replace
[PRIVACY.md](PRIVACY.md), which still describes the upstream program. Where the two differ, this
file describes this branch.

**Local privacy mode is always on.** There is no setting. The app sends nothing to OpenBot (the
`openbot.run` hosts) or to a third party that you did not choose. What you choose:

- the provider of each agent (OpenAI, Anthropic, xAI, Google, Cursor, Cline, a custom or local
  endpoint such as Ollama);
- the pages that you, or an agent, open in the embedded browser;
- the MCP servers that you turn on;
- an action that you start with a click (install a CLI, check a CLI version, download a voice model).

## What changed

| Area | Change |
| --- | --- |
| Core | `packages/contracts/src/local-privacy.ts` holds `LOCAL_PRIVACY_MODE`, the blocked hosts and the provider switches. `src/main/local-privacy.ts` and `src/main/local-privacy-node-guard.ts` hold the guards. |
| Analytics and error reports | No client, no queue, no request. The saved choice is always "off". The opt-out event is gone. The switch and the first-run checkbox are removed. |
| Account | The app opens as one fixed local user (`local@local.invalid`). The account manager makes no request and has no session token, so every account call fails inside the app. |
| Signal, hosted servers, invites | Off at the source (Signal ingress never opens, the host never publishes, no directory sync, no GitHub bot token call). The related UI is hidden. Deep links other than MCP sign-in are ignored. |
| Updates | No auto-update, no check, no download. Update by building a new version by hand. |
| Provider CLIs | No version check at start, no hourly check, no blocklist fetch, no silent update after an app upgrade. The "Check for updates" button on a provider row still works, and it is a click. Install and download also work, and they are clicks. |
| Provider CLI telemetry | Every provider process gets the switches in `LOCAL_PRIVACY_PROVIDER_ENVIRONMENT` (telemetry, update check, model-list fetch off). |
| Address bar | URL only. No Google search. The new tab is `about:blank`. |
| Remote content | The renderer policy has no OpenBot host and no `https:` image source. Visual replies and HTML previews get a policy with no network. Link favicons, remote Markdown images and vendor icons do not load. |
| MCP | OAuth registration has no logo or site. The client info and the user agent are fixed generic values. Agent names are never sent. |
| Network block | One `onBeforeRequest` hook on every Electron session (the app window and the visual preview session are strict, browser tabs are open), and a guard for `fetch`, `node:http`, `node:https` and `WebSocket` in the main process. Each block is logged by host and rule only. |

## Endpoint table

"Action" says what this branch does. "Verified" is how I know: **code** (I read it), **run** (the
real-app egress run below), **audit** (`bun run test:local-privacy`).

| Where | Host | Purpose | Action | Verified |
| --- | --- | --- | --- | --- |
| `packages/telemetry/src/transport.ts`, `src/main/analytics.ts`, renderer `analytics.ts`, `error-reports.ts` | `analytics.openbot.run` | Product analytics, error reports | Off at the source, blocked by the guard and the policy | code, audit, run (no request) |
| `src/main/central-auth-manager.ts` and the services behind it (`billing-service`, `license-service`, `hosted-server-service`, marketplace, templates, invites, sites) | `api.openbot.run` | Account, billing, license, hosting, catalogs | Manager has no network and no token. Blocked by the guard | code, audit, run (no request) |
| `src/main/analytics-preference-service.ts` | `api.openbot.run` `/v1/me/analytics` | Saves the analytics choice to the account | Never called | code |
| `src/main/github-bot-tokens.ts` | `api.openbot.run` | Sends the GitHub token to get app tokens | Never called. Agents act as the user | code |
| `src/main/signal-ingress.ts`, `telegram-files.ts`, `host-service.ts`, renderer `team-webrtc.ts` | `signal.openbot.run` (from the account ticket) | Slack, Discord, Telegram, webhook relay, host publishing, remote servers | Never opens: no ticket without an account. UI hidden. Blocked by the guard | code, audit, run (no request) |
| ICE and TURN servers | from the Signal ticket | WebRTC | Unreachable without Signal | code |
| `electron-updater`, `update-service.ts`, `host-release-service.ts` | `github.com/nightly-labs/openbot` | App update feed, host version probe | Updater never starts. Path is blocked by the guard | code, audit |
| `provider-runtime-releases.ts` | `raw.githubusercontent.com/nightly-labs/openbot` | Runtime blocklist | Never fetched. Path is blocked by the guard | code, audit |
| `provider-runtime-manager.ts` `startUpdateChecks` | `api.github.com`, `registry.npmjs.org`, `x.ai`, `api.meta.ai`, `dl.google.com`, `downloads.cursor.com` | CLI version checks | Off at start and by timer. On click only | code, run (no request at start) |
| `application-services.ts` `ensureToolRuntimes` | `github.com/oven-sh/bun`, `registry.npmjs.org` | Bun runtime for `npx` | Not at start. Still runs when you save, enable or test an MCP server | code |
| `voice-transcription-service.ts` | `huggingface.co` | Voice models | Only the Download button. Dictation does not download | code |
| `cline-free-models.ts` | `api.cline.bot` | Free model list | Built-in list, no request | code |
| `opencode-usage.ts`, `cursor-usage.ts` | `opencode.ai`, `api2.cursor.sh` | Usage rings | Off (see "Trade-offs") | code |
| `browser-suggestions.ts` | `www.google.com` | Address bar search, new tab | Removed. Text that is not a URL does nothing | code, run |
| `chat-visual-protocol.ts`, `chat-visual-preview.ts` | any CDN | Scripts, fonts, images in visual replies | Policy with no network. Preview session is strict. Prompts say "self-contained" | code, audit |
| `RichMessageText.tsx`, `MarkdownMessageText.tsx`, marketplace icons | any host | Favicons, remote images, vendor icons | Not loaded | code |
| `mcp-oauth-provider.ts`, `mcp-oauth-proxy.ts`, `mcp-probe.ts`, `github-*.ts` | `openbot.run`, your MCP host | Client identity | Logo and site removed. Generic name and user agent | code, `scripts/mcp-oauth-e2e.ts` (not run) |
| Provider CLIs (Codex, Claude, OpenCode, Cursor, Grok, Gemini, Cline, Pi) | provider hosts | Agent turns, sign-in state, usage | Allowed. Telemetry and update checks are switched off with environment variables | run |
| Embedded browser tabs | the pages you open | Browsing | Allowed. Blocked list still applies | run |
| `apps/auth-api`, `remote/`, `apps/mobile` | n/a | Server side, mobile app | Not part of the desktop app. Not changed | n/a |
| `deep-link-router.ts`, `app-handlers.ts` (help menu), `WhatsNewOverlay.tsx`, `FirstRunFlow.tsx` | `openbot.run`, `discord.openbot.run`, `x.com`, ... | Links | Opened only when you click. Not blocked | code |

## What still leaves the computer, and why

- **Provider traffic.** Each agent talks to its provider. The CLIs decide the exact hosts. In the
  real run these were `chatgpt.com` (Codex) and `api.anthropic.com` (Claude). Codex and OpenCode start
  at launch and Codex contacts `chatgpt.com` before any turn.
- **Pages you open.** `example.com` in the run.
- **`registry.npmjs.org`.** One connection at start. A second run with a process poller showed the
  source: `npm exec rea-agents@6.4.0 mcp`, an MCP server from the Codex configuration of the test
  computer, started by the Codex `app-server`. It is not OpenBot code. It is an MCP server that you
  turned on, so it is allowed.
- **MCP servers and their authorization services**, when you add one.
- **Clicks:** installing or checking a CLI, downloading a voice model, the Bun runtime when you save
  an MCP server.
- **Rare fallback:** if the loopback listener for MCP sign-in cannot bind, the registration names the
  `openbot://mcp-auth` redirect. It reaches only the authorization server that you chose.

## Trade-offs (things that do not work any more)

- No account features: marketplace, agent templates, hosted servers, invites, Slack, Discord,
  Telegram, webhook routines, GitHub triggers, mobile connect, remote servers, the server rail.
- No update notice. The "update available" notices of OpenCode and Cursor are computed from the
  versions pinned in `native-runtime.lock.json`, without a request. Their buttons are clicks.
- The OpenCode Go and Cursor usage rings stay empty. They poll provider accounts on a timer, which is
  not an agent turn. To keep them, remove the early return in `src/backend/opencode-usage.ts` and
  `src/backend/cursor-usage.ts`.
- Remote scripts in a visual reply do not run. A library that needs `eval` does not run either.
- Vendor icons in the MCP catalog show a placeholder.
- The address-bar placeholder text is updated in English and Italian only. Other languages still say
  "Google".

## How to verify

1. Audit (no network, a few seconds):

   ```bash
   bun run test:local-privacy
   ```

   It fails on a new `openbot.run` mention that is not in `scripts/local-privacy-baseline.json`, a
   Node guard that stops blocking, a policy that allows an OpenBot host or a remote scheme, a second
   `onBeforeRequest`, or network code in a utility host. It writes
   `.openbot-build/local-privacy-audit.json`.

2. Real run through a logging proxy:

   ```bash
   bun scripts/local-privacy-egress-proxy.ts --port 18080 --out .openbot-build/egress.jsonl
   bun run build
   env -u ELECTRON_RUN_AS_NODE OPENBOT_LOCAL_PRIVACY_PROXY=http://127.0.0.1:18080 \
     HTTPS_PROXY=http://127.0.0.1:18080 HTTP_PROXY=http://127.0.0.1:18080 \
     NO_PROXY=127.0.0.1,localhost NODE_USE_ENV_PROXY=1 OPENBOT_APP_VARIANT=production \
     node_modules/electron/dist/Electron.app/Contents/MacOS/Electron out/main/index.js \
     --user-data-dir=/tmp/openbot-egress-profile --use-mock-keychain
   ```

   Every host in `egress.jsonl` must be a provider, an MCP server that you turned on, a page that you
   opened, or `localhost`. The proxy logs the host and the port only. It does not open TLS. To see
   which process connects, poll `lsof -nP -iTCP:18080 -sTCP:ESTABLISHED` while the app starts. This
   run is not packaged, so it does not run the packaged-only code (see "Not verified").

3. Your own check on macOS, which also covers the packaged app: install LuLu or Little Snitch, start
   the app, and use it for a few minutes (start, new agent, one turn, the browser, Settings). Allow
   the provider hosts that you use. Any connection to `openbot.run`, `datadoghq.com`,
   `githubusercontent.com` or `github.com/nightly-labs` is a bug in this patch. Please report the
   process name that LuLu shows.

4. The block log: the app writes `Blocked an outgoing request.` with `host` and `rule`, at most once
   a minute for each host. It never logs a path, query, header or body.

## Merge from upstream

The patch is small on purpose. Most of it is in four new files and a few guarded lines.

```bash
git fetch origin main
git merge origin/main
```

Then:

1. Run `bun run test:local-privacy`. A new `openbot.run` mention shows as a failure. Decide: a link
   that opens on a click (add it to the baseline with `bun scripts/local-privacy-audit.ts
   --write-baseline` and explain it in the commit) or a request (turn it off and add a guard).
2. Search for `LOCAL_PRIVACY_MODE` and `local privacy mode` to see every guarded line. A conflict
   there means upstream changed the same function: keep both the new upstream code and the guard.
3. Look at `git diff origin/main --stat -- src/main/application-services.ts src/main/index.ts`.
   These two files have the most guarded lines.
4. Run the audit again, then a real run (step 2 above) when upstream adds a new provider or service.

The files that only this branch owns: `packages/contracts/src/local-privacy.ts`,
`src/main/local-privacy.ts`, `src/main/local-privacy-node-guard.ts`,
`src/backend/mcp-client-identity.ts`, `scripts/local-privacy-*`, this file.

## Not verified

- **Packaged build.** The run above is an unpackaged build. Analytics, the updater and the default
  `https://api.openbot.run` account URL run only in a packaged app. They are off by code and blocked
  by the guard, and the audit checks the guard, but I did not run a packaged app. Use LuLu or Little
  Snitch for that.
- **What the proxy can see.** It saw Chromium and every program that honors `HTTPS_PROXY`. The Node
  of Electron 44 is version 24.22 and honors `NODE_USE_ENV_PROXY=1`: a probe with Electron in Node
  mode sent a `fetch` through the proxy. I did not prove it for the main process of the app itself.
  The guard log covers the `openbot.run` and `nightly-labs` paths of the main process in any case.
  A program that ignores both the proxy variables and Chromium settings is not seen: that is why
  step 3 (LuLu or Little Snitch) is worth doing.
- **Picture-in-picture and the dock overlay.** They load OpenBot's own pages in the default session,
  which is strict. Browser tabs keep their own session. I read the code and did not open them in the
  run.
- **Provider CLI hosts.** The Node guard does not see them (they are other programs). The list comes
  from the run, for the CLIs that are installed on the test computer and signed in (Codex, Claude,
  OpenCode). Grok, Cursor, Cline, Pi, Gemini and Muse were not installed or not started.
- **The turn.** One agent, Claude Haiku, two short messages. Other providers, and a custom or Ollama
  endpoint, were not tried.
- **Telemetry switches of other CLIs.** `LOCAL_PRIVACY_PROVIDER_ENVIRONMENT` has the names that I
  know. In the run, a third-party log host and a model-list host stopped after I added them (the two
  runs differ in nothing else that I know of, but I did not test each switch alone). I did not
  confirm the others.
- **Muse, Antigravity.** Their client info goes to a local CLI. I could not confirm that those CLIs do
  not forward `OpenBot` to their own service.
- **`scripts/mcp-oauth-e2e.ts`**, `scripts/provider-update-after-app-upgrade-e2e.ts` and
  `scripts/opencode-go-usage-e2e.ts`. The first was updated but not run. The other two assert upstream
  behavior that this branch turns off, so they fail here.
- **Utility hosts and WebRTC.** The three utility hosts have no network code (checked by the audit).
  WebRTC (ICE/STUN) is not covered by the policy or the hook. It cannot start without Signal.
- **The renderer in the `web-client` folder** is the browser app served from `openbot.run`. I did
  not check whether any of it is in the desktop bundle.
- **`about:blank`.** Agent browser tools still reject `about:blank`. A remote server's browser might
  reject it too.
- **Other platforms.** Only macOS was used.
