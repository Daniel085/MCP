#!/usr/bin/env node
/**
 * Entry point.
 *   alianza-mcp                 run the MCP server (transport from MCP_TRANSPORT)
 *   alianza-mcp login [opts]    authorise a user-context token via the browser
 *   alianza-mcp auth-status     print credential status and exit
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { AuthManager } from "./auth.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { log, setLogLevel } from "./log.js";
import { login } from "./login.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function parseLoginArgs(argv: string[]) {
  const opts: { loginHint?: string; scopes?: string; redirectUri?: string; openBrowser?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--login-hint") opts.loginHint = argv[++i];
    else if (a === "--scopes") opts.scopes = argv[++i];
    else if (a === "--redirect-uri") opts.redirectUri = argv[++i];
    else if (a === "--no-browser") opts.openBrowser = false;
    else throw new Error(`Unknown option ${a}. Usage: alianza-mcp login [--login-hint +1415...] [--scopes "..."] [--redirect-uri URL] [--no-browser]`);
  }
  return opts;
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const auth = AuthManager.fromConfig(config);
  const api = ApiClient.fromConfig(config, auth);
  const ctx = { api, auth, config };
  const [command, ...rest] = process.argv.slice(2);

  if (command === "login") {
    await login(config, auth, parseLoginArgs(rest));
    return;
  }
  if (command === "auth-status") {
    const s = auth.status({ env: config.env, apiBaseUrl: config.apiBaseUrl, experienceId: config.experienceId });
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return;
  }
  if (command !== undefined) {
    throw new Error(`Unknown command "${command}". Run with no arguments to start the server, or use: login, auth-status.`);
  }

  if (config.transport === "stdio") {
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
    log.info("server started", { name: SERVER_NAME, version: SERVER_VERSION, transport: "stdio", env: config.env });
    return;
  }

  const app = createHttpApp(config, ctx);
  const httpServer = app.listen(config.httpPort, config.httpHost, () => {
    log.info("server started", {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "http",
      env: config.env,
      url: `http://${config.httpHost}:${config.httpPort}${config.httpPath}`,
      auth: config.authToken ? "bearer" : "none",
    });
  });
  const shutdown = (signal: string) => {
    log.info("shutting down", { signal });
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
