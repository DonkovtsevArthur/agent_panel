/**
 * Loopback proxy used by the Pi adapter (interim transport).
 *
 * Pi sends provider requests through `globalThis.fetch` and offers no hook for
 * a custom TLS agent, while Harbor's gateway uses an internal CA. This proxy
 * listens on 127.0.0.1, forwards to the real provider over HTTPS with the
 * pinned/NODE_EXTRA_CA_CERTS chain, injects a fresh key per request and retries
 * once on 401. Pi then talks to plain HTTP on loopback.
 *
 * Replaced on a later stage by a `globalThis.fetch` wrapper (see
 * docs/pi-runtime-spike.md §3.4).
 */
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";

export interface ProviderProxy {
  /** Base URL to put into models.json (already includes the provider path). */
  baseUrl: string;
  caSource?: string;
  close: () => Promise<void>;
}

export interface ProviderProxyOptions {
  /** Provider base URL, e.g. https://host/gennadiy/v1 */
  targetBase: string;
  /** Fresh credential for every request; `force` asks for a rotation. */
  getKey: (force: boolean) => Promise<string>;
  timeoutMs?: number;
}

const CA_CANDIDATES = [
  process.env.NODE_EXTRA_CA_CERTS,
  path.join(os.homedir(), ".harbor", "certs", "ca.pem"),
];

function loadCa(host: string): { ca?: string; source?: string } {
  const pinned = path.join(os.homedir(), ".harbor", "certs", "pinned", `${host}.pem`);
  for (const candidate of [pinned, ...CA_CANDIDATES]) {
    if (!candidate) continue;
    try {
      const pem = fs.readFileSync(candidate, "utf8");
      if (pem.includes("BEGIN CERTIFICATE")) return { ca: pem, source: candidate };
    } catch {
      /* try next */
    }
  }
  return {};
}

export function startProviderProxy(options: ProviderProxyOptions): Promise<ProviderProxy> {
  const target = new URL(options.targetBase);
  const targetPath = target.pathname.replace(/\/+$/, "");
  const { ca, source } = loadCa(target.hostname);
  const timeoutMs = options.timeoutMs ?? 600000;

  const forward = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: Buffer,
    isRetry: boolean
  ): void => {
    void (async () => {
      let key = "";
      try {
        key = await options.getKey(isRetry);
      } catch (error) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: error instanceof Error ? error.message : String(error) },
          })
        );
        return;
      }
      if (!key) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Нет API-ключа провайдера" } }));
        return;
      }

      const upstream = https.request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: targetPath + req.url,
          method: req.method,
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
            accept: req.headers.accept || "application/json",
            authorization: `Bearer ${key}`,
            "content-length": body.length,
          },
          ca,
          timeout: timeoutMs,
        },
        (upstreamRes) => {
          if (upstreamRes.statusCode === 401 && !isRetry) {
            upstreamRes.resume();
            forward(req, res, body, true);
            return;
          }
          const headers = { ...upstreamRes.headers };
          delete headers["transfer-encoding"];
          res.writeHead(upstreamRes.statusCode || 502, headers);
          upstreamRes.pipe(res);
        }
      );
      upstream.on("timeout", () => upstream.destroy(new Error("gateway timeout")));
      upstream.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
      });
      upstream.end(body);
    })();
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => forward(req, res, Buffer.concat(chunks), false));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Не удалось поднять loopback-прокси"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        caSource: source,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
