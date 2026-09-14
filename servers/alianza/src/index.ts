#!/usr/bin/env node
/**
 * Entry point.
 *   alianza-mcp                       run the MCP server (transport from MCP_TRANSPORT)
 *   alianza-mcp setup                 collect credentials, write the config file, sign in
 *   alianza-mcp login [opts]          sign in (Authorization Code + PKCE in the browser)
 *   alianza-mcp install <client>      register with claude-code or claude-desktop
 *   alianza-mcp doctor                verify the install end to end
 *   alianza-mcp usage [--days N]      summarise the local usage log
 *   alianza-mcp auth-status           print credential status as JSON
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { AuthManager } from "./auth.js";
import { bool, parseArgs, str } from "./cli/args.js";
import { formatChecks, runDoctor } from "./cli/doctor.js";
import { install } from "./cli/install.js";
import { setup } from "./cli/setup.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { log, setLogLevel } from "./log.js";
import { login } from "./login.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { formatSummary, summarize, usage } from "./usage.js";

const HELP = `alianza-mcp ${SERVER_VERSION}

Usage:
  alianza-mcp                         start the MCP server
  alianza-mcp setup [--yes] [--env sandbox|production] [--client-id ID] [--client-secret S]
                    [--experience-id UUID] [--redirect-uri URI] [--no-login] [--no-browser]
  alianza-mcp login [--login-hint +1415...] [--scopes "..."] [--redirect-uri URI] [--no-browser]
  alianza-mcp install claude-code [--scope user|local|project] [--print]
  alianza-mcp install claude-desktop [--config PATH] [--print]
  alianza-mcp doctor
  alianza-mcp usage [--days 30] [--json]
  alianza-mcp auth-status
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "setup") {
    await setup(rest);
    return;
  }
  if (command === "install") {
    await install(rest);
    return;
  }

  const config = loadConfig();
  // CLI commands print their own output; keep server logs quiet unless asked.
  setLogLevel(command !== undefined && !process.env.LOG_LEVEL ? "warn" : config.logLevel);

  if (command === "usage") {
    const { flags } = parseArgs(rest);
    if (!config.usageLog) {
      process.stderr.write("Usage logging is disabled (ALIANZA_USAGE_LOG=off).\n");
      return;
    }
    const s = summarize(config.usageLog, Number(str(flags, "days") ?? 30));
    process.stdout.write((bool(flags, "json", false) ? JSON.stringify(s, null, 2) : formatSummary(s)) + "\n");
    return;
  }
  if (command === "doctor") {
    const checks = await runDoctor(config);
    process.stdout.write(formatChecks(checks) + "\n");
    process.exitCode = checks.some((c) => c.status === "fail") ? 1 : 0;
    return;
  }

  const auth = AuthManager.fromConfig(config);
  const api = ApiClient.fromConfig(config, auth);
  const ctx = { api, auth, config };

  if (command === "login") {
    const { flags } = parseArgs(rest);
    await login(config, auth, {
      loginHint: str(flags, "login-hint"),
      scopes: str(flags, "scopes"),
      redirectUri: str(flags, "redirect-uri"),
      openBrowser: bool(flags, "browser", true),
    });
    return;
  }
  if (command === "auth-status") {
    const s = auth.status({ env: config.env, apiBaseUrl: config.apiBaseUrl, experienceId: config.experienceId });
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return;
  }
  if (command !== undefined) {
    throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  }

  usage.configure(config.usageLog, SERVER_VERSION);

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
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
