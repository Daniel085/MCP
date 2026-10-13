import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDoctor } from "../src/cli/doctor.js";
import { claudeCodeCommand, claudeDesktopConfigPath, desktopEntry, serverCommand, writeDesktopConfig } from "../src/cli/install.js";
import { redirectUriInstructions, setup } from "../src/cli/setup.js";
import { loadConfig, readConfigFile, writeConfigFile } from "../src/config.js";
import { formatSummary, summarize, usage } from "../src/usage.js";
import { connectTestClient, EXPERIENCE_ID, startFakeApi, writeTokenFile } from "./helpers.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alianza-cli-"));
}

describe("config file", () => {
  it("is read, and environment variables override it", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeConfigFile(file, { env: "production", clientId: "file-client", clientSecret: "s", experienceId: EXPERIENCE_ID, usageLog: "off" });
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");

    const fromFile = loadConfig({ ALIANZA_CONFIG_FILE: file });
    expect(fromFile.env).toBe("production");
    expect(fromFile.apiBaseUrl).toBe("https://api.alianza.com");
    expect(fromFile.clientId).toBe("file-client");
    expect(fromFile.usageLog).toBeNull();

    const overridden = loadConfig({ ALIANZA_CONFIG_FILE: file, ALIANZA_CLIENT_ID: "env-client", ALIANZA_ENV: "sandbox" });
    expect(overridden.clientId).toBe("env-client");
    expect(overridden.apiBaseUrl).toBe("https://api.b2.alianza.com");
  });

  it("defaults sensibly when the file is missing", () => {
    const cfg = loadConfig({ ALIANZA_CONFIG_FILE: path.join(tmp(), "missing.json") });
    expect(cfg.env).toBe("sandbox");
    expect(cfg.usageLog).toMatch(/usage\.jsonl$/);
    expect(cfg.redirectUri).toBe("http://127.0.0.1:8765/callback");
  });
});

describe("setup (non-interactive)", () => {
  it("writes the config file from flags and skips login when asked", async () => {
    const file = path.join(tmp(), "config.json");
    await setup(
      ["--yes", "--no-login", "--env", "sandbox", "--client-id", "c1", "--client-secret", "s1", "--experience-id", EXPERIENCE_ID, "--config", file],
      {},
    );
    expect(readConfigFile(file)).toEqual({ env: "sandbox", clientId: "c1", clientSecret: "s1", experienceId: EXPERIENCE_ID, redirectUri: "http://127.0.0.1:8765/callback" });
  });

  it("keeps existing values and requires the mandatory ones", async () => {
    const file = path.join(tmp(), "config.json");
    writeConfigFile(file, { clientId: "keep-me", clientSecret: "keep", experienceId: EXPERIENCE_ID });
    await setup(["--yes", "--no-login", "--config", file, "--env", "production"], {});
    expect(readConfigFile(file)).toMatchObject({ clientId: "keep-me", env: "production" });

    const empty = path.join(tmp(), "config.json");
    await expect(setup(["--yes", "--no-login", "--config", empty], {})).rejects.toThrow(/--client-id is required/);
  });

  it("explains how to get the redirect URI registered", () => {
    const text = redirectUriInstructions("abc", "http://127.0.0.1:8765/callback");
    expect(text).toContain("OAuth client abc");
    expect(text).toContain("http://127.0.0.1:8765/callback");
  });
});

describe("install", () => {
  it("launches via npx when running from an installed package, via node from a checkout", () => {
    const pkg = serverCommand({ argv1: "/usr/lib/node_modules/alianza-mcp/dist/index.js", execPath: "/usr/bin/node" });
    expect(pkg.via).toBe("npx");
    expect(pkg.args).toEqual(["-y", "alianza-mcp"]);
    const dev = serverCommand({ argv1: "/home/me/MCP/servers/alianza/dist/index.js", execPath: "/usr/bin/node" });
    expect(dev).toEqual({ command: "/usr/bin/node", args: ["/home/me/MCP/servers/alianza/dist/index.js"], via: "node" });
  });

  it("renders the claude mcp add command without env vars", () => {
    const args = claudeCodeCommand({ command: "npx", args: ["-y", "alianza-mcp"], via: "npx" }, "user");
    expect(args).toEqual(["mcp", "add", "--transport", "stdio", "--scope", "user", "alianza", "--", "npx", "-y", "alianza-mcp"]);
  });

  it("locates the Claude Desktop config per platform", () => {
    expect(claudeDesktopConfigPath("darwin", "/Users/me", {})).toBe("/Users/me/Library/Application Support/Claude/claude_desktop_config.json");
    expect(claudeDesktopConfigPath("win32", "C:\\Users\\me", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" })).toMatch(/Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/);
    expect(claudeDesktopConfigPath("linux", "/home/me", {})).toBe("/home/me/.config/Claude/claude_desktop_config.json");
  });

  it("merges into an existing Claude Desktop config with a backup", () => {
    const file = path.join(tmp(), "claude_desktop_config.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }));
    const { json, backup } = writeDesktopConfig(file, desktopEntry({ command: "/usr/bin/node", args: ["/srv/index.js"], via: "node" }));
    expect(json).toEqual({ mcpServers: { other: { command: "x" }, alianza: { command: "/usr/bin/node", args: ["/srv/index.js"] } }, theme: "dark" });
    expect(backup && fs.existsSync(backup)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(json);

    const fresh = path.join(tmp(), "nested", "claude_desktop_config.json");
    expect(writeDesktopConfig(fresh, { command: "x", args: [] }).backup).toBeNull();
    expect(JSON.parse(fs.readFileSync(fresh, "utf8")).mcpServers.alianza).toEqual({ command: "x", args: [] });

    const bad = path.join(tmp(), "claude_desktop_config.json");
    fs.writeFileSync(bad, "{not json");
    expect(() => writeDesktopConfig(bad, {})).toThrow(/not valid JSON/);
  });
});

describe("doctor", () => {
  let fake: Awaited<ReturnType<typeof startFakeApi>>;
  beforeAll(async () => {
    fake = await startFakeApi();
  });
  afterAll(async () => {
    await new Promise<void>((r) => fake.server.close(() => r()));
  });

  function configFor(extra: Record<string, string>) {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeConfigFile(file, { clientId: "test-client", clientSecret: "test-secret", experienceId: EXPERIENCE_ID, apiBaseUrl: fake.baseUrl, authBaseUrl: fake.baseUrl, tokenFile: path.join(dir, "tokens.json") });
    return loadConfig({ ALIANZA_CONFIG_FILE: file, ALIANZA_USAGE_LOG: "off", ...extra });
  }

  it("passes when everything is configured and signed in", async () => {
    const config = configFor({});
    writeTokenFile(config.tokenFile, { auth_base_url: fake.baseUrl });
    const checks = await runDoctor(config);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName["Client credentials"].status).toBe("ok");
    expect(byName["User sign-in"].status).toBe("ok");
    expect(byName["User sign-in"].detail).toContain("users endpoint answered");
    expect(checks.some((c) => c.status === "fail")).toBe(false);
  });

  it("fails with login instructions when not signed in", async () => {
    const checks = await runDoctor(configFor({}));
    const signIn = checks.find((c) => c.name === "User sign-in")!;
    expect(signIn.status).toBe("fail");
    expect(signIn.detail).toContain("alianza-mcp login");
    expect(signIn.detail).toContain("redirect URI");
  });

  it("fails on bad client credentials", async () => {
    const checks = await runDoctor(configFor({ ALIANZA_CLIENT_SECRET: "wrong" }));
    expect(checks.find((c) => c.name === "Client credentials")!.status).toBe("fail");
  });
});

describe("usage log", () => {
  it("records tool outcomes without arguments and summarises them", async () => {
    const file = path.join(tmp(), "usage.jsonl");
    usage.configure(file, "test");
    const t = await connectTestClient({ usageLog: file });
    try {
      await t.call("alianza_check_assignability", { target_type: "PHONE_NUMBER", target_value: "+14155551234" });
      await t.call("alianza_get_user", { user_id: "nope" });
      await t.call("alianza_list_assignments", {});
    } finally {
      await t.close();
      usage.configure(null, "test");
    }
    await usage.flush();
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("+14155551234");
    expect(raw).not.toContain("nope");

    const s = summarize(file);
    expect(s.events).toBe(3);
    expect(s.tools.alianza_check_assignability).toMatchObject({ calls: 1, ok: 1 });
    expect(s.tools.alianza_get_user).toMatchObject({ calls: 1, error: 1, statuses: { "404": 1 } });
    expect(s.tools.alianza_list_assignments).toMatchObject({ calls: 1, error: 1 });
    const text = formatSummary(s);
    expect(text).toContain("3 tool calls");
    expect(text).toContain("alianza_get_user");
    expect(formatSummary(summarize(path.join(tmp(), "none.jsonl")))).toContain("No usage recorded");
  });
});
