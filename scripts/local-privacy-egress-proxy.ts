/**
 * Egress logger for the local privacy test. It is a plain forward proxy that writes one JSON line
 * per connection: the time, the method and the target host and port. It does not open TLS, so it
 * never sees a path, header or body.
 *
 * bun scripts/local-privacy-egress-proxy.ts [--port 18080] [--out .openbot-build/egress.jsonl]
 *
 * Point the app at it with `--proxy-server=http://127.0.0.1:18080` (Chromium) and `HTTP_PROXY` /
 * `HTTPS_PROXY` (child processes that read them). Node's built-in `fetch` ignores those variables
 * unless the program sets a proxy agent, so a request from the main process may not reach this
 * proxy. `scripts/local-privacy-audit.ts` and the guard's own block log cover that part.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const port = Number(option("port", "18080"));
const outPath = resolve(option("out", ".openbot-build/egress.jsonl"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, "");

function log(method: string, host: string, targetPort: number): void {
  appendFileSync(outPath, `${JSON.stringify({ at: new Date().toISOString(), method, host, port: targetPort })}\n`);
}

const server = createServer((clientRequest, clientResponse) => {
  // Plain HTTP through the proxy arrives with an absolute URL.
  try {
    const target = new URL(clientRequest.url ?? "");
    log(clientRequest.method ?? "GET", target.hostname, Number(target.port || 80));
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: clientRequest.method,
        headers: clientRequest.headers,
      },
      (response) => {
        clientResponse.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(clientResponse);
      },
    );
    upstream.on("error", () => clientResponse.writeHead(502).end());
    clientRequest.pipe(upstream);
  } catch {
    clientResponse.writeHead(400).end();
  }
});

server.on("connect", (clientRequest, clientSocket, head) => {
  const [host = "", targetPort = "443"] = (clientRequest.url ?? "").split(/:(?=\d+$)/u);
  log("CONNECT", host.replace(/^\[|\]$/gu, ""), Number(targetPort));
  const upstream = connect(Number(targetPort), host.replace(/^\[|\]$/gu, ""), () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Egress proxy on 127.0.0.1:${port}, log ${outPath}
`),
);
