/**
 * Wire-level smoke test. Spawns the built server over stdio against the fake
 * API, then runs initialize, tools/list, and one tools/call.
 *
 * Usage: npm run build && npm run fake-api &  then  npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4010";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: { ...process.env, API_BASE_URL: apiBaseUrl, MCP_TRANSPORT: "stdio", LOG_LEVEL: "warn" },
  stderr: "inherit",
});
const client = new Client({ name: "smoke-test", version: "0.0.0" });

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  console.log(`connected to ${info?.name} ${info?.version}`);

  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length === 0) throw new Error("no tools registered");

  const result = await client.callTool({ name: "list_items", arguments: { limit: 2 } });
  if (result.isError) throw new Error(`list_items returned error: ${JSON.stringify(result.content)}`);
  console.log("list_items ok:", JSON.stringify(result.structuredContent));

  const missing = await client.callTool({ name: "get_item", arguments: { id: "itm_404" } });
  if (!missing.isError) throw new Error("expected get_item on a missing id to return isError");
  console.log("get_item error path ok");

  console.log("SMOKE PASSED");
} finally {
  await client.close();
}
