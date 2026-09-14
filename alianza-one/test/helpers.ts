import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Server as HttpServer } from "node:http";
import { ApiClient } from "../src/api-client.js";
import { createFakeApi } from "../src/fake-api.js";
import { FAKE_PASSWORD, FAKE_USERNAME } from "../src/fake-data.js";
import { createServer } from "../src/server.js";

/**
 * Starts the fake Alianza API on an ephemeral port and connects a real MCP
 * client to the server over an in-memory transport. Tests exercise the full
 * JSON-RPC path without touching stdio or the network beyond loopback.
 */
export async function connectTestClient(
  opts: { username?: string; password?: string; authToken?: string; partitionId?: string } = {},
) {
  const fake = createFakeApi();
  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = fake.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("could not get fake api port");

  const api = new ApiClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    username: opts.authToken ? undefined : (opts.username ?? FAKE_USERNAME),
    password: opts.authToken ? undefined : (opts.password ?? FAKE_PASSWORD),
    authToken: opts.authToken,
    partitionId: opts.partitionId,
    timeoutMs: 5_000,
  });
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    fake,
    api,
    async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    },
    async close() {
      await client.close();
      await server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
