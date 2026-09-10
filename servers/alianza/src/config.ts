/**
 * Configuration: defaults < config file < environment variables.
 *
 * The config file (~/.config/alianza-mcp/config.json by default, written by
 * `alianza-mcp setup`) is what lets beta customers run the server with no
 * environment variables at all. Environment variables still override it, so
 * containers and CI work the same way as before.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AlianzaEnv = "sandbox" | "production";

const DEFAULTS: Record<AlianzaEnv, { api: string; auth: string }> = {
  sandbox: { api: "https://api.b2.alianza.com", auth: "https://auth.beta.alianza.com" },
  production: { api: "https://api.alianza.com", auth: "https://auth.alianza.com" },
};

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/callback";
export const DEFAULT_SCOPES = "experience-connections:manage experience-assignments:manage users:manage offline_access";

export interface FileConfig {
  env?: AlianzaEnv;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  experienceId?: string;
  redirectUri?: string;
  scopes?: string;
  tokenFile?: string;
  usageLog?: string;
}

export interface Config {
  configFile: string;
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
  /** Path to the JSONL usage log, or null when disabled. */
  usageLog: string | null;
  apiTimeoutMs: number;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  httpPath: string;
  authToken: string;
  allowedHosts: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

export function configDir(): string {
  return path.join(os.homedir(), ".config", "alianza-mcp");
}

export function defaultConfigFile(): string {
  return path.join(configDir(), "config.json");
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export function readConfigFile(file: string): FileConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FileConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConfigFile(file: string, config: FileConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const configFile = expandHome(env.ALIANZA_CONFIG_FILE || defaultConfigFile());
  const file = readConfigFile(configFile) ?? {};
  const pick = (envName: string, fileValue: string | undefined, fallback = ""): string => {
    const v = env[envName];
    if (v !== undefined && v !== "") return v;
    return fileValue ?? fallback;
  };

  const alianzaEnv = pick("ALIANZA_ENV", file.env, "sandbox") as AlianzaEnv;
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
  const usageLogRaw = pick("ALIANZA_USAGE_LOG", file.usageLog, path.join(configDir(), "usage.jsonl"));

  return {
    configFile,
    env: alianzaEnv,
    apiBaseUrl: strip(pick("ALIANZA_API_BASE_URL", file.apiBaseUrl, DEFAULTS[alianzaEnv].api)),
    authBaseUrl: strip(pick("ALIANZA_AUTH_BASE_URL", file.authBaseUrl, DEFAULTS[alianzaEnv].auth)),
    clientId: pick("ALIANZA_CLIENT_ID", file.clientId),
    clientSecret: pick("ALIANZA_CLIENT_SECRET", file.clientSecret),
    experienceId: pick("ALIANZA_EXPERIENCE_ID", file.experienceId),
    tokenFile: expandHome(pick("ALIANZA_TOKEN_FILE", file.tokenFile, path.join(configDir(), "tokens.json"))),
    refreshToken: env.ALIANZA_REFRESH_TOKEN ?? "",
    accessToken: env.ALIANZA_ACCESS_TOKEN ?? "",
    redirectUri: pick("ALIANZA_REDIRECT_URI", file.redirectUri, DEFAULT_REDIRECT_URI),
    scopes: pick("ALIANZA_SCOPES", file.scopes, DEFAULT_SCOPES),
    usageLog: usageLogRaw === "off" || usageLogRaw === "false" ? null : expandHome(usageLogRaw),
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
