import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiClient } from "../src/api-client.js";
import { AuthManager, type StoredTokens } from "../src/auth.js";
import { loadConfig, type Config } from "../src/config.js";
import { createFakeApi } from "../src/fake-api.js";
import { createServer } from "../src/server.js";
import type { ToolContext } from "../src/tools/context.js";

export const EXPERIENCE_ID = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
export const ACME_ID = "11111111-1111-4111-8111-111111111111";
export const BETA_ID = "22222222-2222-4222-8222-222222222222";
export const JANE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

export async function startFakeApi(): Promise<{ server: HttpServer; baseUrl: string }> {
  const server: HttpServer = await new Promise((resolve) => {
    const s = createFakeApi().listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

export interface TestSetup {
  /** Omit client credentials to test the "not configured" paths. */
  clientCredentials?: boolean;
  /** What to seed the token file with. "fresh" = valid access token; "expired" = forces a refresh; "none" = no file. */
  userToken?: "fresh" | "expired" | "none";
  envRefreshToken?: string;
  staticAccessToken?: string;
  experienceId?: string;
}

export function writeTokenFile(file: string, tokens: Partial<StoredTokens> & { auth_base_url: string }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      access_token: "static-user-token",
      refresh_token: "rt-good",
      expires_at: Date.now() + 3600_000,
      scope: "experience-connections:manage experience-assignments:manage users:manage",
      obtained_at: new Date().toISOString(),
      ...tokens,
    }),
  );
}

export function buildContext(baseUrl: string, setup: TestSetup = {}): { ctx: ToolContext; config: Config; tokenFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alianza-mcp-test-"));
  const tokenFile = path.join(dir, "tokens.json");
  const userToken = setup.userToken ?? "fresh";
  if (userToken === "fresh") writeTokenFile(tokenFile, { auth_base_url: baseUrl });
  if (userToken === "expired") writeTokenFile(tokenFile, { auth_base_url: baseUrl, access_token: "expired-token", expires_at: Date.now() - 1000 });

  const config = loadConfig({
    ALIANZA_API_BASE_URL: baseUrl,
    ALIANZA_AUTH_BASE_URL: baseUrl,
    ALIANZA_CLIENT_ID: setup.clientCredentials === false ? "" : "test-client",
    ALIANZA_CLIENT_SECRET: setup.clientCredentials === false ? "" : "test-secret",
    ALIANZA_EXPERIENCE_ID: setup.experienceId ?? EXPERIENCE_ID,
    ALIANZA_TOKEN_FILE: tokenFile,
    ALIANZA_REFRESH_TOKEN: setup.envRefreshToken ?? "",
    ALIANZA_ACCESS_TOKEN: setup.staticAccessToken ?? "",
    API_TIMEOUT_MS: "5000",
  });
  const auth = AuthManager.fromConfig(config);
  const api = ApiClient.fromConfig(config, auth);
  return { ctx: { api, auth, config }, config, tokenFile };
}

export async function connectTestClient(setup: TestSetup = {}) {
  const fake = await startFakeApi();
  const { ctx, config, tokenFile } = buildContext(fake.baseUrl, setup);
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    ctx,
    config,
    tokenFile,
    baseUrl: fake.baseUrl,
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
      return { raw: r, text, isError: Boolean(r.isError), data: r.structuredContent as Record<string, any> | undefined };
    },
    async close() {
      await client.close();
      await server.close();
      await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    },
  };
}
