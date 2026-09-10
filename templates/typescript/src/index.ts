#!/usr/bin/env node
/**
 * Entry point. Picks the transport from MCP_TRANSPORT.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { log, setLogLevel } from "./log.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const api = ApiClient.fromConfig(config);

  if (config.transport === "stdio") {
    const server = createServer(api);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("server started", { name: SERVER_NAME, version: SERVER_VERSION, transport: "stdio" });
    return;
  }

  const app = createHttpApp(config, api);
  const httpServer = app.listen(config.httpPort, config.httpHost, () => {
    log.info("server started", {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "http",
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
