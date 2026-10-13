import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthManager } from "../src/auth.js";
import { buildContext, startFakeApi } from "./helpers.js";

describe("AuthManager", () => {
  let fake: Awaited<ReturnType<typeof startFakeApi>>;
  beforeAll(async () => {
    fake = await startFakeApi();
  });
  afterAll(async () => {
    await new Promise<void>((r) => fake.server.close(() => r()));
  });

  it("caches the client-credentials token until near expiry", async () => {
    let clock = 1_000_000;
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls++;
      return fetch(input, init);
    };
    const auth = new AuthManager({
      authBaseUrl: fake.baseUrl,
      clientId: "test-client",
      clientSecret: "test-secret",
      tokenFile: "/nonexistent/tokens.json",
      fetchImpl: counting,
      now: () => clock,
    });
    expect(await auth.getToken("assignability")).toBe("cc-token");
    expect(await auth.getToken("assignability")).toBe("cc-token");
    expect(calls).toBe(1);
    clock += 3600_000; // past expiry
    await auth.getToken("assignability");
    expect(calls).toBe(2);
  });

  it("persists refreshed tokens back to the token file", async () => {
    const { ctx, tokenFile } = buildContext(fake.baseUrl, { userToken: "expired" });
    const token = await ctx.auth.getToken("user");
    expect(token).toMatch(/^user-token-/);
    const stored = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    expect(stored.access_token).toBe(token);
    expect(stored.refresh_token).toBe("rt-good");
    expect(stored.expires_at).toBeGreaterThan(Date.now());
  });

  it("ignores a token file issued by a different auth server", async () => {
    const { ctx, tokenFile } = buildContext(fake.baseUrl, { userToken: "none" });
    fs.writeFileSync(tokenFile, JSON.stringify({ access_token: "x", refresh_token: "rt-good", expires_at: Date.now() + 1e6, auth_base_url: "https://auth.alianza.com" }));
    const fresh = new AuthManager({ authBaseUrl: fake.baseUrl, clientId: "test-client", clientSecret: "test-secret", tokenFile });
    await expect(fresh.getToken("user")).rejects.toThrow(/alianza-mcp login/);
    expect(ctx.auth.status({ env: "sandbox", apiBaseUrl: fake.baseUrl, experienceId: "" }).userToken.source).toBe("none");
  });

  it("surfaces a bad refresh token as a login-needed error", async () => {
    const { ctx } = buildContext(fake.baseUrl, { userToken: "none", envRefreshToken: "rt-bad" });
    await expect(ctx.auth.getToken("user")).rejects.toThrow(/refresh token is invalid.*alianza-mcp login/s);
  });
});
