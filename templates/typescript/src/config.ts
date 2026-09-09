/**
 * All configuration comes from environment variables so the same build runs
 * locally over stdio and in a container over HTTP.
 */
export interface Config {
  apiBaseUrl: string;
  apiKey: string;
  apiTimeoutMs: number;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  httpPath: string;
  authToken: string;
  allowedHosts: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
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
  return {
    apiBaseUrl: (env.API_BASE_URL ?? "http://127.0.0.1:4010").replace(/\/+$/, ""),
    apiKey: env.API_KEY ?? "",
    apiTimeoutMs: envInt("API_TIMEOUT_MS", 15_000),
    transport,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: envInt("MCP_HTTP_PORT", 3000),
    httpPath: env.MCP_HTTP_PATH ?? "/mcp",
    authToken: env.MCP_AUTH_TOKEN ?? "",
    allowedHosts: (env.MCP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: logLevel as Config["logLevel"],
  };
}
