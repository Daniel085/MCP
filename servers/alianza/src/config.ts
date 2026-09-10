/**
 * Configuration from environment variables. Alianza-specific settings plus
 * the transport settings inherited from the template.
 */
import os from "node:os";
import path from "node:path";

export type AlianzaEnv = "sandbox" | "production";

const DEFAULTS: Record<AlianzaEnv, { api: string; auth: string }> = {
  sandbox: { api: "https://api.b2.alianza.com", auth: "https://auth.beta.alianza.com" },
  production: { api: "https://api.alianza.com", auth: "https://auth.alianza.com" },
};

export interface Config {
  env: AlianzaEnv;
  apiBaseUrl: string;
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  experienceId: string;
  tokenFile: string;
  refreshToken: string;
  accessToken: string;
  redirectUri: string;
  scopes: string;
  apiTimeoutMs: number;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  httpPath: string;
  authToken: string;
  allowedHosts: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const alianzaEnv = (env.ALIANZA_ENV ?? "sandbox") as AlianzaEnv;
  if (alianzaEnv !== "sandbox" && alianzaEnv !== "production") {
    throw new Error(`ALIANZA_ENV must be "sandbox" or "production", got "${alianzaEnv}"`);
  }
  const transport = env.MCP_TRANSPORT ?? "stdio";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${transport}"`);
  }
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be debug|info|warn|error, got "${logLevel}"`);
  }
  const strip = (s: string) => s.replace(/\/+$/, "");
  return {
    env: alianzaEnv,
    apiBaseUrl: strip(env.ALIANZA_API_BASE_URL || DEFAULTS[alianzaEnv].api),
    authBaseUrl: strip(env.ALIANZA_AUTH_BASE_URL || DEFAULTS[alianzaEnv].auth),
    clientId: env.ALIANZA_CLIENT_ID ?? "",
    clientSecret: env.ALIANZA_CLIENT_SECRET ?? "",
    experienceId: env.ALIANZA_EXPERIENCE_ID ?? "",
    tokenFile: expandHome(env.ALIANZA_TOKEN_FILE || "~/.config/alianza-mcp/tokens.json"),
    refreshToken: env.ALIANZA_REFRESH_TOKEN ?? "",
    accessToken: env.ALIANZA_ACCESS_TOKEN ?? "",
    redirectUri: env.ALIANZA_REDIRECT_URI || "http://127.0.0.1:8765/callback",
    scopes:
      env.ALIANZA_SCOPES ||
      "experience-connections:manage experience-assignments:manage users:manage offline_access",
    apiTimeoutMs: envInt(env, "API_TIMEOUT_MS", 15_000),
    transport,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: envInt(env, "MCP_HTTP_PORT", 3000),
    httpPath: env.MCP_HTTP_PATH ?? "/mcp",
    authToken: env.MCP_AUTH_TOKEN ?? "",
    allowedHosts: (env.MCP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: logLevel as Config["logLevel"],
  };
}
