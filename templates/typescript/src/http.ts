/**
 * Streamable HTTP transport, stateless mode.
 *
 * Every POST /mcp builds a fresh server and transport, handles the request,
 * and tears both down when the response closes. Nothing is kept between
 * requests, so any number of replicas can sit behind a load balancer.
 *
 * Stateful variant (needed for server-initiated notifications): create the
 * transport with `sessionIdGenerator: () => randomUUID()`, keep a
 * Map<sessionId, transport>, look up the transport by the `mcp-session-id`
 * header on later requests, and also route GET (SSE stream) and DELETE
 * (session end) to it. See the SDK's simpleStreamableHttp.ts example.
 */
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { ApiClient } from "./api-client.js";
import type { Config } from "./config.js";
import { log } from "./log.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function bearerAuth(expected: string) {
  const expectedBuf = Buffer.from(expected);
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const tokenBuf = Buffer.from(token);
    const ok = tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf);
    if (!ok) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createHttpApp(config: Config, api: ApiClient): Express {
  const app = createMcpExpressApp({
    host: config.httpHost,
    allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  if (config.authToken) {
    app.use(config.httpPath, bearerAuth(config.authToken));
  } else {
    log.warn("MCP_AUTH_TOKEN is not set; the MCP endpoint is unauthenticated");
  }

  app.post(config.httpPath, async (req, res) => {
    const server = createServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("request failed", { error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless servers have no session stream to resume or delete.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get(config.httpPath, methodNotAllowed);
  app.delete(config.httpPath, methodNotAllowed);

  return app;
}
