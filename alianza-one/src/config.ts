/**
 * All configuration comes from environment variables so the same build runs
 * locally over stdio and in a container over HTTP.
 *
 * Alianza environments (see https://api.alianza.com/v2/apidocs/):
 *   Development  https://api.d2.alianza.com
 *   QA           https://api.q2.alianza.com
 *   Beta         https://api.b2.alianza.com   (default; use for integration work)
 *   Production   https://api.alianza.com
 */
export interface Config {
  /** Alianza API root, no trailing slash. */
  apiBaseUrl: string;
  /** Admin Portal / API user credentials. Used to POST /v2/authorize. */
  username: string;
  password: string;
  /** Pre-issued X-AUTH-TOKEN. If set, username/password are not used and the token is never refreshed. */
  authToken: string;
  /** Partition to act in by default. Empty means "the partition the login belongs to". */
  partitionId: string;
  apiTimeoutMs: number;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  httpPath: string;
  /** Bearer token that MCP clients must send to the HTTP transport. */
  mcpAuthToken: string;
  allowedHosts: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

export const DEFAULT_BASE_URL = "https://api.b2.alianza.com";

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const transport = env.MCP_TRANSPORT ?? "stdio";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${transport}"`);
  }
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be debug|info|warn|error, got "${logLevel}"`);
  }
  const config: Config = {
    apiBaseUrl: (env.ALIANZA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    username: env.ALIANZA_USERNAME ?? "",
    password: env.ALIANZA_PASSWORD ?? "",
    authToken: env.ALIANZA_AUTH_TOKEN ?? "",
    partitionId: env.ALIANZA_PARTITION_ID ?? "",
    apiTimeoutMs: envInt(env, "API_TIMEOUT_MS", 20_000),
    transport,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: envInt(env, "MCP_HTTP_PORT", 3000),
    httpPath: env.MCP_HTTP_PATH ?? "/mcp",
    mcpAuthToken: env.MCP_AUTH_TOKEN ?? "",
    allowedHosts: (env.MCP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: logLevel as Config["logLevel"],
  };
  if (!config.authToken && !(config.username && config.password)) {
    throw new Error(
      "Set ALIANZA_USERNAME and ALIANZA_PASSWORD (or a pre-issued ALIANZA_AUTH_TOKEN) so the server can authenticate with Alianza.",
    );
  }
  return config;
}
