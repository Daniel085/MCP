/**
 * OAuth token management for the two token kinds the Crux API uses.
 *
 *   client credentials  -> partner context, only for the assignability check
 *   user context        -> Authorization Code + PKCE, refreshed with the
 *                          refresh token; persisted in a token file
 *
 * Nothing outside this module sees a token.
 */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { log } from "./log.js";

export const ASSIGNABILITY_SCOPE = "experience-assignability:check";

export interface TokenSet {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  auth_base_url: string;
  obtained_at: string;
}

export type TokenKind = "assignability" | "user";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly needsLogin = false,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthStatus {
  env: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  clientCredentials: boolean;
  userToken: { source: "env-access-token" | "token-file" | "env-refresh-token" | "none"; expiresAt?: string; scope?: string; canRefresh: boolean };
  tokenFile: string;
  experienceId: string | null;
}

export interface AuthManagerOptions {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  staticAccessToken?: string;
  envRefreshToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const REFRESH_MARGIN_MS = 60_000;

export class AuthManager {
  private readonly opts: Required<Pick<AuthManagerOptions, "authBaseUrl" | "clientId" | "clientSecret" | "tokenFile">> &
    AuthManagerOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private clientToken: TokenSet | null = null;
  private userToken: TokenSet | null = null;
  private userSource: AuthStatus["userToken"]["source"] = "none";

  constructor(opts: AuthManagerOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.loadUserToken();
  }

  static fromConfig(config: Config, fetchImpl?: typeof fetch): AuthManager {
    return new AuthManager({
      authBaseUrl: config.authBaseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tokenFile: config.tokenFile,
      staticAccessToken: config.accessToken || undefined,
      envRefreshToken: config.refreshToken || undefined,
      timeoutMs: config.apiTimeoutMs,
      fetchImpl,
    });
  }

  hasClientCredentials(): boolean {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  /** Returns a bearer token for the given kind, refreshing or fetching as needed. */
  async getToken(kind: TokenKind): Promise<string> {
    if (kind === "assignability" && this.hasClientCredentials()) {
      return (await this.getClientToken()).accessToken;
    }
    return (await this.getUserToken()).accessToken;
  }

  /** Drop the cached token of a kind so the next call fetches a fresh one (after a 401). */
  async invalidate(kind: TokenKind): Promise<boolean> {
    if (kind === "assignability" && this.hasClientCredentials()) {
      this.clientToken = null;
      return true;
    }
    if (this.userToken?.refreshToken) {
      this.userToken = { ...this.userToken, expiresAt: 0 };
      return true;
    }
    return false;
  }

  status(extra: { env: string; apiBaseUrl: string; experienceId: string }): AuthStatus {
    return {
      env: extra.env,
      apiBaseUrl: extra.apiBaseUrl,
      authBaseUrl: this.opts.authBaseUrl,
      clientCredentials: this.hasClientCredentials(),
      userToken: {
        source: this.userSource,
        expiresAt: this.userToken?.expiresAt ? new Date(this.userToken.expiresAt).toISOString() : undefined,
        scope: this.userToken?.scope,
        canRefresh: Boolean(this.userToken?.refreshToken && this.opts.clientId),
      },
      tokenFile: this.opts.tokenFile,
      experienceId: extra.experienceId || null,
    };
  }

  // ---- User context ---------------------------------------------------------

  private loadUserToken(): void {
    if (this.opts.staticAccessToken) {
      this.userToken = { accessToken: this.opts.staticAccessToken, expiresAt: Number.MAX_SAFE_INTEGER };
      this.userSource = "env-access-token";
      return;
    }
    const stored = this.readTokenFile();
    if (stored) {
      this.userToken = {
        accessToken: stored.access_token,
        expiresAt: stored.expires_at,
        refreshToken: stored.refresh_token,
        scope: stored.scope,
      };
      this.userSource = "token-file";
      return;
    }
    if (this.opts.envRefreshToken) {
      this.userToken = { accessToken: "", expiresAt: 0, refreshToken: this.opts.envRefreshToken };
      this.userSource = "env-refresh-token";
    }
  }

  private async getUserToken(): Promise<TokenSet> {
    if (!this.userToken) {
      throw new AuthError(
        "No user-context credentials are configured. Run `alianza-mcp login` (or set ALIANZA_REFRESH_TOKEN) to authorise this server for connections, assignments, and users.",
        true,
      );
    }
    if (this.userToken.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.userToken;
    if (!this.userToken.refreshToken) {
      throw new AuthError("The configured access token has expired and there is no refresh token. Run `alianza-mcp login`.", true);
    }
    const refreshed = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: this.userToken.refreshToken,
    });
    this.userToken = {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken ?? this.userToken.refreshToken,
      scope: refreshed.scope ?? this.userToken.scope,
    };
    if (this.userSource === "token-file") this.writeTokenFile(this.userToken);
    log.info("user token refreshed", { expiresAt: new Date(this.userToken.expiresAt).toISOString() });
    return this.userToken;
  }

  /** Exchange an authorization code (from the PKCE flow) and persist the result. */
  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenSet> {
    const set = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    this.userToken = set;
    this.userSource = "token-file";
    this.writeTokenFile(set);
    return set;
  }

  // ---- Client credentials --------------------------------------------------

  private async getClientToken(): Promise<TokenSet> {
    if (this.clientToken && this.clientToken.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.clientToken;
    this.clientToken = await this.tokenRequest({ grant_type: "client_credentials", scope: ASSIGNABILITY_SCOPE });
    return this.clientToken;
  }

  // ---- Token endpoint --------------------------------------------------------

  private async tokenRequest(params: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({ ...params, client_id: this.opts.clientId });
    if (this.opts.clientSecret) body.set("client_secret", this.opts.clientSecret);
    if (!this.opts.clientId) {
      throw new AuthError("ALIANZA_CLIENT_ID is not set; it is required for every token request.", false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.authBaseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AuthError(`Could not reach the Alianza auth server (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string; error_description?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // handled below
    }
    if (!res.ok || !data.access_token) {
      const reason = data.error_description || data.error || `HTTP ${res.status}`;
      const grant = params.grant_type;
      throw new AuthError(
        `Token request (${grant}) failed: ${reason}` +
          (grant === "refresh_token" ? ". Run `alianza-mcp login` to re-authorise." : ""),
        grant === "refresh_token",
      );
    }
    return {
      accessToken: data.access_token,
      expiresAt: this.now() + (data.expires_in ?? 3600) * 1000,
      refreshToken: data.refresh_token,
      scope: data.scope,
    };
  }

  // ---- Token file ------------------------------------------------------------

  private readTokenFile(): StoredTokens | null {
    try {
      const raw = fs.readFileSync(this.opts.tokenFile, "utf8");
      const parsed = JSON.parse(raw) as StoredTokens;
      if (!parsed.access_token) return null;
      if (parsed.auth_base_url && parsed.auth_base_url !== this.opts.authBaseUrl) {
        log.warn("token file was issued by a different auth server; ignoring it", {
          file: this.opts.tokenFile,
          issuedBy: parsed.auth_base_url,
        });
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private writeTokenFile(set: TokenSet): void {
    const stored: StoredTokens = {
      access_token: set.accessToken,
      refresh_token: set.refreshToken,
      expires_at: set.expiresAt,
      scope: set.scope,
      auth_base_url: this.opts.authBaseUrl,
      obtained_at: new Date(this.now()).toISOString(),
    };
    fs.mkdirSync(path.dirname(this.opts.tokenFile), { recursive: true });
    fs.writeFileSync(this.opts.tokenFile, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
}
