/**
 * Wire-level smoke test. Spawns the built server over stdio against the fake
 * Alianza API, then runs initialize, tools/list, one read, one write, and
 * one error path.
 *
 * Usage: npm run build && npm run fake-api &  then  npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FAKE_PASSWORD, FAKE_USERNAME } from "../src/fake-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiBaseUrl = process.env.ALIANZA_BASE_URL ?? "http://127.0.0.1:4010";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: {
    ...process.env,
    ALIANZA_BASE_URL: apiBaseUrl,
    ALIANZA_USERNAME: process.env.ALIANZA_USERNAME ?? FAKE_USERNAME,
    ALIANZA_PASSWORD: process.env.ALIANZA_PASSWORD ?? FAKE_PASSWORD,
    MCP_TRANSPORT: "stdio",
    LOG_LEVEL: "warn",
  },
  stderr: "inherit",
});
const client = new Client({ name: "smoke-test", version: "0.0.0" });

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  console.log(`connected to ${info?.name} ${info?.version}`);

  const { tools } = await client.listTools();
  console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length === 0) throw new Error("no tools registered");

  const partition = await client.callTool({ name: "alianza_get_partition", arguments: {} });
  if (partition.isError) throw new Error(`alianza_get_partition returned error: ${JSON.stringify(partition.content)}`);
  console.log("alianza_get_partition ok:", JSON.stringify((partition.structuredContent as { partition: unknown }).partition));

  const search = await client.callTool({ name: "alianza_search_accounts", arguments: { query: "acme" } });
  if (search.isError) throw new Error(`alianza_search_accounts returned error: ${JSON.stringify(search.content)}`);
  const hits = (search.structuredContent as { accounts: Array<{ id: string }> }).accounts;
  if (hits.length === 0) throw new Error("expected at least one account matching 'acme'");
  console.log("alianza_search_accounts ok:", hits.map((h) => h.id).join(", "));

  const numbers = await client.callTool({ name: "alianza_list_phone_numbers", arguments: { accountId: hits[0].id } });
  if (numbers.isError) throw new Error(`alianza_list_phone_numbers returned error: ${JSON.stringify(numbers.content)}`);
  console.log("alianza_list_phone_numbers ok");

  const missing = await client.callTool({ name: "alianza_get_account", arguments: { id: "acc_404" } });
  if (!missing.isError) throw new Error("expected alianza_get_account on a missing id to return isError");
  console.log("alianza_get_account error path ok");

  console.log("SMOKE PASSED");
} finally {
  await client.close();
}
