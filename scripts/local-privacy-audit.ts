/**
 * Local privacy audit (fork patch). Run it with `bun run test:local-privacy`.
 *
 * It fails when production code gets a new `openbot.run` URL that is not in the baseline, when the
 * network guard stops blocking, when the renderer CSP allows OpenBot hosts or any `https:` image,
 * when a second `onBeforeRequest` appears, or when a utility host gets network code.
 *
 * The baseline (`scripts/local-privacy-baseline.json`) lists each file that mentions an OpenBot host
 * and how often. Each entry is a link the user opens on click, display text, or a request that sits
 * behind a switch that local privacy mode turns off (and the guard blocks anyway). A new entry is a
 * review decision: run with `--write-baseline` and explain the diff in the commit.
 *
 * The report is written to `.openbot-build/local-privacy-audit.json`.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isLocalPrivacyBlockedUrl } from "@openbot/contracts/local-privacy";
import { buildContentSecurityPolicy } from "../src/main/content-security-policy";

const root = resolve(import.meta.dirname, "..");
const baselinePath = join(root, "scripts/local-privacy-baseline.json");
const reportPath = join(root, ".openbot-build/local-privacy-audit.json");

/** Directories of production code. The mobile app, the account Worker and Signal are separate programs. */
const SCAN_ROOTS = ["src", "packages"];
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "stories",
  "preview",
  "fixtures",
  "messages",
]);
const SKIPPED_FILE = /\.(test|spec|stories|e2e)\.[cm]?[tj]sx?$/u;
const SCANNED_FILE = /\.(ts|tsx|html|json|css)$/u;
const OPENBOT_HOST = /[a-z0-9.-]*openbot\.run/giu;

type Baseline = Record<string, Record<string, number>>;

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (SCANNED_FILE.test(entry) && !SKIPPED_FILE.test(entry)) files.push(path);
  }
  return files;
}

function sourceFiles(): string[] {
  return SCAN_ROOTS.flatMap((directory) => walk(join(root, directory)));
}

function currentOccurrences(): Baseline {
  const result: Baseline = {};
  for (const file of sourceFiles()) {
    const counts: Record<string, number> = {};
    for (const match of readFileSync(file, "utf8").matchAll(OPENBOT_HOST)) {
      const host = match[0].toLowerCase();
      counts[host] = (counts[host] ?? 0) + 1;
    }
    if (Object.keys(counts).length > 0) result[relative(root, file)] = counts;
  }
  return result;
}

interface Finding {
  check: string;
  ok: boolean;
  detail: string;
}

const findings: Finding[] = [];
function record(check: string, ok: boolean, detail: string): void {
  findings.push({ check, ok, detail });
}

function compareWithBaseline(current: Baseline, baseline: Baseline): void {
  const added: string[] = [];
  for (const [file, hosts] of Object.entries(current)) {
    for (const [host, count] of Object.entries(hosts)) {
      const allowed = baseline[file]?.[host] ?? 0;
      if (count > allowed) added.push(`${file}: ${host} x${count} (baseline ${allowed})`);
    }
  }
  record(
    "no-new-openbot-run-url",
    added.length === 0,
    added.length === 0 ? "every OpenBot host mention is in the baseline" : `new mentions:\n  ${added.join("\n  ")}`,
  );
}

function checkContractBlocks(): void {
  const mustBlock = [
    "https://analytics.openbot.run/api/track",
    "https://api.openbot.run/v1/me",
    "wss://signal.openbot.run/ws",
    "https://hooks.openbot.run/x",
    "https://openbot.run/",
    "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json",
    "https://github.com/nightly-labs/openbot/releases/latest/download/latest-mac.yml",
    "https://api.github.com/repos/nightly-labs/openbot/releases/latest",
  ];
  const mustAllow = [
    "https://api.anthropic.com/v1/messages",
    "https://api.openai.com/v1/responses",
    "http://127.0.0.1:11434/v1/models",
    "https://api.github.com/repos/someone/else",
    "https://notopenbot.run.example.com/",
  ];
  const wrong = [
    ...mustBlock.filter((url) => !isLocalPrivacyBlockedUrl(url)).map((url) => `not blocked: ${url}`),
    ...mustAllow.filter((url) => isLocalPrivacyBlockedUrl(url)).map((url) => `blocked by mistake: ${url}`),
  ];
  record("block-list", wrong.length === 0, wrong.length === 0 ? "block list matches the cases" : wrong.join("; "));
}

function checkNodeGuard(): void {
  // The guard runs in Electron's Node, so the probe runs under Node too.
  const probe = join(root, "scripts/local-privacy-node-guard-probe.mts");
  const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", probe], { encoding: "utf8" });
  if (run.status !== 0) {
    record("node-guard", false, `the Node probe failed: ${run.stderr.trim().slice(0, 300)}`);
    return;
  }
  const results: Record<string, boolean> = JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}");
  const leaked = Object.entries(results)
    .filter(([, blocked]) => !blocked)
    .map(([name]) => name);
  record(
    "node-guard",
    leaked.length === 0 && Object.keys(results).length > 0,
    leaked.length === 0
      ? `fetch, http, https and WebSocket block OpenBot hosts (${Object.keys(results).length} cases)`
      : `not blocked: ${leaked.join(", ")}`,
  );
}

function checkCsp(): void {
  const problems: string[] = [];
  for (const packaged of [true, false]) {
    const policy = buildContentSecurityPolicy(packaged, undefined, null);
    const label = packaged ? "packaged" : "development";
    if (/openbot\.run/iu.test(policy)) problems.push(`${label} CSP names openbot.run`);
    for (const directive of policy.split(";").map((part) => part.trim())) {
      const sources = directive.split(/\s+/u);
      const name = sources[0] ?? "";
      if (["img-src", "connect-src", "frame-src", "script-src", "font-src", "media-src"].includes(name)) {
        if (sources.includes("https:") || sources.includes("wss:") || sources.includes("*"))
          problems.push(`${label} ${name} allows a remote scheme`);
      }
    }
  }
  record(
    "csp",
    problems.length === 0,
    problems.length === 0 ? "CSP has no OpenBot host and no remote scheme" : problems.join("; "),
  );
}

function checkSingleRequestHook(): void {
  const owners: string[] = [];
  for (const file of sourceFiles()) {
    const path = relative(root, file);
    if (!/\.(ts|tsx)$/u.test(path) || path === "src/main/local-privacy.ts") continue;
    if (/\.onBeforeRequest\s*\(/u.test(readFileSync(file, "utf8"))) owners.push(path);
  }
  record(
    "single-onBeforeRequest",
    owners.length === 0,
    owners.length === 0 ? "only src/main/local-privacy.ts sets onBeforeRequest" : `also set in: ${owners.join(", ")}`,
  );
}

function checkUtilityHosts(): void {
  const hosts = [
    "src/backend/agent-data/agent-database-host.ts",
    "src/main/voice-transcription-host.ts",
    "src/main/voice-speech-host.ts",
  ];
  const network =
    /\bfetch\(|node:(?:http|https|http2|net|tls|dgram|dns|child_process)|\bWebSocket\b|XMLHttpRequest|https?:\/\//u;
  const bad = hosts.filter((path) => network.test(readFileSync(join(root, path), "utf8")));
  record(
    "utility-hosts-have-no-network-code",
    bad.length === 0,
    bad.length === 0 ? "database and voice hosts have no network primitive" : `network code in: ${bad.join(", ")}`,
  );
}

async function main(): Promise<void> {
  const current = currentOccurrences();
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    process.stdout.write(`Baseline written: ${Object.keys(current).length} files.\n`);
    return;
  }
  compareWithBaseline(current, JSON.parse(readFileSync(baselinePath, "utf8")));
  checkContractBlocks();
  checkNodeGuard();
  checkCsp();
  checkSingleRequestHook();
  checkUtilityHosts();

  mkdirSync(join(root, ".openbot-build"), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ at: new Date().toISOString(), findings }, null, 2)}\n`);
  for (const finding of findings)
    process.stdout.write(`${finding.ok ? "PASS" : "FAIL"} ${finding.check}: ${finding.detail}\n`);
  process.stdout.write(`Report: ${relative(root, reportPath)}\n`);
  if (findings.some((finding) => !finding.ok)) process.exit(1);
}

await main();
