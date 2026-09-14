/**
 * `alianza-mcp login`: Authorization Code + PKCE against a loopback redirect.
 *
 * Opens the browser at {auth}/authorize, receives the code on the redirect
 * URI's port, exchanges it with the code_verifier, and stores the tokens in
 * the token file for the server to use and refresh.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AuthManager } from "./auth.js";
import type { Config } from "./config.js";

export interface LoginOptions {
  loginHint?: string;
  scopes?: string;
  redirectUri?: string;
  openBrowser?: boolean;
  timeoutMs?: number;
  /** Test hook: called with the authorize URL and the expected state. */
  onAuthorizeUrl?: (url: string, state: string) => void;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(config: Config, p: { challenge: string; state: string; scopes: string; redirectUri: string; loginHint?: string }): string {
  const url = new URL(`${config.authBaseUrl}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", p.scopes);
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url.toString();
}

function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // printing the URL is the fallback
  }
}

export async function login(config: Config, auth: AuthManager, opts: LoginOptions = {}): Promise<{ expiresAt: number; scope?: string }> {
  if (!config.clientId) throw new Error("ALIANZA_CLIENT_ID is required to log in.");
  const redirectUri = opts.redirectUri ?? config.redirectUri;
  const scopes = opts.scopes ?? config.scopes;
  const redirect = new URL(redirectUri);
  if (!["127.0.0.1", "localhost", "::1"].includes(redirect.hostname)) {
    throw new Error(`The login command needs a loopback redirect URI (got ${redirectUri}). Register one such as http://127.0.0.1:8765/callback with Alianza.`);
  }
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");
  const authorizeUrl = buildAuthorizeUrl(config, { challenge, state, scopes, redirectUri, loginHint: opts.loginHint });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(`Login failed: ${err} ${url.searchParams.get("error_description") ?? ""}`);
        finish(new Error(`Authorization server returned ${err}: ${url.searchParams.get("error_description") ?? ""}`));
        return;
      }
      if (gotState !== state || !gotCode) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Login failed: state mismatch or missing code.");
        finish(new Error("State mismatch or missing code on the callback"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Signed in. You can close this tab and return to the terminal.");
      finish(undefined, gotCode);
    });
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the browser callback")), opts.timeoutMs ?? 5 * 60_000);
    let done = false;
    function finish(error?: Error, value?: string) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      error ? reject(error) : resolve(value as string);
    }
    server.on("error", (e) => finish(e));
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      opts.onAuthorizeUrl?.(authorizeUrl, state);
      process.stderr.write(`Open this URL to sign in to Alianza:\n\n  ${authorizeUrl}\n\nWaiting for the callback on ${redirectUri} ...\n`);
      if (opts.openBrowser ?? true) openInBrowser(authorizeUrl);
    });
  });

  const set = await auth.exchangeCode(code, verifier, redirectUri);
  process.stderr.write(`Signed in. Token stored in ${config.tokenFile}; expires ${new Date(set.expiresAt).toISOString()}.\n`);
  return { expiresAt: set.expiresAt, scope: set.scope };
}
