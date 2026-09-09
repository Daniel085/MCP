import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiClient } from "../src/api-client.js";
import { createServer } from "../src/server.js";
import { createFakeApi } from "../src/fake-api.js";
import type { Server as HttpServer } from "node:http";

/**
 * Starts the fake API on an ephemeral port and connects a real MCP client to
 * the server over an in-memory transport. Tests exercise the full JSON-RPC
 * path without touching stdio or the network beyond loopback.
 */
export async function connectTestClient(opts: { apiKey?: string } = {}) {
  const fakeApi = createFakeApi();
  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = fakeApi.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("could not get fake api port");

  const api = new ApiClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: opts.apiKey ?? "",
    timeoutMs: 5_000,
  });
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    async close() {
      await client.close();
      await server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
