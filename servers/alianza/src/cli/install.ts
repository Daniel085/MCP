/**
 * `alianza-mcp install claude-code|claude-desktop`: register this server with
 * a Claude client. No environment variables are needed because everything
 * lives in the config file, so the registration is just the command.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bool, parseArgs, str } from "./args.js";

export const SERVER_KEY = "alianza";

/** How a Claude client should launch this server. */
export function serverCommand(opts: { argv1?: string; execPath?: string } = {}): { command: string; args: string[]; via: "npx" | "node" } {
  const argv1 = opts.argv1 ?? process.argv[1] ?? "";
  const execPath = opts.execPath ?? process.execPath;
  const fromPackage = /node_modules[\\/]/.test(argv1) || /[\\/]_npx[\\/]/.test(argv1);
  if (fromPackage) {
    const npx = path.join(path.dirname(execPath), process.platform === "win32" ? "npx.cmd" : "npx");
    return { command: fs.existsSync(npx) ? npx : "npx", args: ["-y", "alianza-mcp"], via: "npx" };
  }
  return { command: execPath, args: [path.resolve(argv1)], via: "node" };
}

export function claudeDesktopConfigPath(platform = process.platform, home = os.homedir(), env = process.env): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

export function desktopEntry(cmd: ReturnType<typeof serverCommand>): Record<string, unknown> {
  return { command: cmd.command, args: cmd.args };
}

/** Merge our server into a Claude Desktop config file, backing it up first. Returns the written JSON. */
export function writeDesktopConfig(file: string, entry: Record<string, unknown>): { json: Record<string, unknown>; backup: string | null } {
  let json: Record<string, unknown> = {};
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    try {
      json = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${file} is not valid JSON. Fix or remove it, then run install again.`);
    }
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
  }
  const servers = (json.mcpServers ??= {}) as Record<string, unknown>;
  servers[SERVER_KEY] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  return { json, backup };
}

export function claudeCodeCommand(cmd: ReturnType<typeof serverCommand>, scope: string): string[] {
  return ["mcp", "add", "--transport", "stdio", "--scope", scope, SERVER_KEY, "--", cmd.command, ...cmd.args];
}

export async function install(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const target = positional[0];
  const printOnly = bool(flags, "print", false);
  const cmd = serverCommand();
  const out = (s: string) => process.stderr.write(s + "\n");

  if (target === "claude-code") {
    const scope = str(flags, "scope") ?? "user";
    const args = claudeCodeCommand(cmd, scope);
    const rendered = ["claude", ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(" ");
    if (printOnly) {
      out(rendered);
      return;
    }
    const result = spawnSync("claude", args, { stdio: "inherit" });
    if (result.error || result.status !== 0) {
      out(`Could not run the Claude Code CLI automatically. Run this yourself:\n\n  ${rendered}\n`);
      return;
    }
    out(`\nRegistered "${SERVER_KEY}" with Claude Code (scope ${scope}). Start claude and type /mcp to check it is connected.`);
    return;
  }

  if (target === "claude-desktop") {
    const file = str(flags, "config") ?? claudeDesktopConfigPath();
    const entry = desktopEntry(cmd);
    if (printOnly) {
      out(`Add this to ${file} under "mcpServers":\n\n${JSON.stringify({ [SERVER_KEY]: entry }, null, 2)}`);
      return;
    }
    const { backup } = writeDesktopConfig(file, entry);
    out(`Wrote "${SERVER_KEY}" into ${file}${backup ? ` (backup at ${backup})` : ""}.`);
    out("Fully quit and reopen Claude Desktop, then look for the tools icon in a new chat.");
    return;
  }

  throw new Error("Usage: alianza-mcp install claude-code [--scope user|local|project] [--print]\n       alianza-mcp install claude-desktop [--config PATH] [--print]");
}
