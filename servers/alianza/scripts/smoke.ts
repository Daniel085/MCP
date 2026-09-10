/**
 * Wire-level smoke test. Spawns the built server over stdio against the fake
 * Crux API (which also serves the fake token endpoint), then runs initialize,
 * tools/list, and a few tools/call round trips.
 *
 * Usage: npm run build && npm run fake-api &  then  npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.FAKE_API_URL ?? "http://127.0.0.1:4010";
const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "alianza-smoke-")), "tokens.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: {
    ...process.env,
    ALIANZA_API_BASE_URL: baseUrl,
    ALIANZA_AUTH_BASE_URL: baseUrl,
    ALIANZA_CLIENT_ID: "test-client",
    ALIANZA_CLIENT_SECRET: "test-secret",
    ALIANZA_EXPERIENCE_ID: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    ALIANZA_REFRESH_TOKEN: "rt-good",
    ALIANZA_TOKEN_FILE: tokenFile,
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
  if (tools.length !== 14) throw new Error(`expected 14 tools, got ${tools.length}`);

  const status = await client.callTool({ name: "alianza_auth_status", arguments: {} });
  console.log("auth status:", (status.content as Array<{ text: string }>)[0].text.split("\n")[0]);

  const check = await client.callTool({ name: "alianza_check_assignability", arguments: { target_type: "PHONE_NUMBER", target_value: "+14155551234" } });
  if (check.isError) throw new Error(`assignability failed: ${JSON.stringify(check.content)}`);
  console.log("assignability ok:", JSON.stringify(check.structuredContent));

  const enable = await client.callTool({ name: "alianza_enable_experience", arguments: { telephone_number: "+14155551234" } });
  if (enable.isError) throw new Error(`enable failed: ${JSON.stringify(enable.content)}`);
  console.log("enable ok:", (enable.content as Array<{ text: string }>)[0].text.split("\n")[0]);

  const missing = await client.callTool({ name: "alianza_get_user", arguments: { user_id: "nope" } });
  if (!missing.isError) throw new Error("expected get_user on a missing id to return isError");
  console.log("error path ok");

  console.log("SMOKE PASSED");
} finally {
  await client.close();
}
