import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiClient } from "../src/api-client.js";
import { loadConfig } from "../src/config.js";
import { createFakeApi } from "../src/fake-api.js";
import { createHttpApp } from "../src/http.js";

function listen(app: { listen: (port: number, host: string, cb: () => void) => HttpServer }): Promise<HttpServer> {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}
function port(s: HttpServer): number {
  const a = s.address();
  if (!a || typeof a === "string") throw new Error("no port");
  return a.port;
}

describe("streamable http transport", () => {
  let fakeApi: HttpServer;
  let mcpServer: HttpServer;
  let url: URL;
  const token = "test-token";

  beforeAll(async () => {
    fakeApi = await listen(createFakeApi());
    const config = loadConfig({
      API_BASE_URL: `http://127.0.0.1:${port(fakeApi)}`,
      MCP_TRANSPORT: "http",
      MCP_AUTH_TOKEN: token,
    });
    mcpServer = await listen(createHttpApp(config, ApiClient.fromConfig(config)));
    url = new URL(`http://127.0.0.1:${port(mcpServer)}/mcp`);
  });
  afterAll(async () => {
    await new Promise<void>((r) => mcpServer.close(() => r()));
    await new Promise<void>((r) => fakeApi.close(() => r()));
  });

  it("serves a health endpoint without auth", async () => {
    const res = await fetch(new URL("/healthz", url));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("rejects requests without a bearer token", async () => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("completes a full client session with a bearer token", async () => {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("get_item");
      const result = await client.callTool({ name: "get_item", arguments: { id: "itm_2" } });
      expect(result.structuredContent).toMatchObject({ id: "itm_2", name: "Gadget" });
    } finally {
      await client.close();
    }
  });
});
