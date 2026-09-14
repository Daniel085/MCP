import fs from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAuthorizeUrl, login, pkcePair } from "../src/login.js";
import { buildContext, startFakeApi } from "./helpers.js";

describe("login (PKCE)", () => {
  let fake: Awaited<ReturnType<typeof startFakeApi>>;
  beforeAll(async () => {
    fake = await startFakeApi();
  });
  afterAll(async () => {
    await new Promise<void>((r) => fake.server.close(() => r()));
  });

  it("derives an S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("builds the authorize URL with every documented parameter", () => {
    const { config } = buildContext(fake.baseUrl, { userToken: "none" });
    const url = new URL(buildAuthorizeUrl(config, { challenge: "c", state: "s", scopes: "a b", redirectUri: "http://127.0.0.1:8765/callback", loginHint: "+14155551234" }));
    expect(url.pathname).toBe("/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "test-client",
      redirect_uri: "http://127.0.0.1:8765/callback",
      scope: "a b",
      state: "s",
      code_challenge: "c",
      code_challenge_method: "S256",
      login_hint: "+14155551234",
    });
  });

  it("completes the loopback flow and stores tokens", async () => {
    const { config, ctx, tokenFile } = buildContext(fake.baseUrl, { userToken: "none" });
    const port = 18765 + Math.floor(Math.random() * 1000);
    const fixedRedirect = `http://127.0.0.1:${port}/callback`;
    const done = login(config, ctx.auth, {
      redirectUri: fixedRedirect,
      openBrowser: false,
      onAuthorizeUrl: async (_url, state) => {
        const res = await fetch(`${fixedRedirect}?code=good-code&state=${state}`);
        expect(res.status).toBe(200);
      },
    });
    const set = await done;
    expect(set.expiresAt).toBeGreaterThan(Date.now());
    const stored = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    expect(stored.access_token).toMatch(/^user-token-/);
    expect(stored.refresh_token).toBe("rt-good");

    // The server can now use the stored token.
    expect(await ctx.auth.getToken("user")).toBe(stored.access_token);
  });

  it("rejects a callback with the wrong state", async () => {
    const { config, ctx } = buildContext(fake.baseUrl, { userToken: "none" });
    const port = 19765 + Math.floor(Math.random() * 1000);
    const redirect = `http://127.0.0.1:${port}/callback`;
    const attempt = login(config, ctx.auth, {
      redirectUri: redirect,
      openBrowser: false,
      onAuthorizeUrl: async () => {
        const res = await fetch(`${redirect}?code=good-code&state=wrong`);
        expect(res.status).toBe(400);
      },
    });
    await expect(attempt).rejects.toThrow(/state mismatch/i);
  });
});
