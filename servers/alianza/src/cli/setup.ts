/**
 * `alianza-mcp setup`: collect credentials, write the config file, log in,
 * and print the next step. Fully scriptable with flags; interactive otherwise.
 */
import { AuthManager } from "../auth.js";
import { DEFAULT_REDIRECT_URI, defaultConfigFile, expandHome, loadConfig, readConfigFile, writeConfigFile, type AlianzaEnv, type FileConfig } from "../config.js";
import { login } from "../login.js";
import { bool, parseArgs, str } from "./args.js";
import { ask, confirm, isInteractive } from "./prompt.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redirectUriInstructions(clientId: string, redirectUri: string): string {
  return [
    "Before you can sign in, Alianza must allow this redirect URI on your OAuth client.",
    "Send your Alianza onboarding contact (or support) a request like:",
    "",
    `    Please add the following redirect URI to OAuth client ${clientId || "<your client id>"}:`,
    `    ${redirectUri}`,
    "",
    "The URI must match exactly, including the port and path. Loopback (127.0.0.1) redirect",
    "URIs are the standard for command-line tools and are what this server uses.",
  ].join("\n");
}

export async function setup(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { flags } = parseArgs(argv);
  const configFile = expandHome(str(flags, "config") ?? env.ALIANZA_CONFIG_FILE ?? defaultConfigFile());
  const existing = readConfigFile(configFile) ?? {};
  const interactive = isInteractive() && !bool(flags, "yes", false);

  const pick = async (flag: string, key: keyof FileConfig, question: string, opts: { secret?: boolean; required?: boolean; validate?: (v: string) => string | null; fallback?: string }) => {
    const fromFlag = str(flags, flag);
    if (fromFlag !== undefined) return fromFlag;
    const current = (existing[key] as string | undefined) ?? opts.fallback;
    if (!interactive) {
      if (!current && opts.required) throw new Error(`--${flag} is required when not running interactively.`);
      return current ?? "";
    }
    return ask(question, { default: current, secret: opts.secret, required: opts.required, validate: opts.validate });
  };

  if (interactive) {
    process.stderr.write("Alianza MCP setup. Values in brackets are kept when you press Enter.\n\n");
  }
  const envName = (await pick("env", "env", "Environment (sandbox or production)", {
    fallback: "sandbox",
    validate: (v) => (v === "sandbox" || v === "production" ? null : "Enter sandbox or production."),
  })) as AlianzaEnv;
  const clientId = await pick("client-id", "clientId", "OAuth client id (from Alianza onboarding)", { required: true });
  const clientSecret = await pick("client-secret", "clientSecret", "OAuth client secret", { required: true, secret: true });
  const experienceId = await pick("experience-id", "experienceId", "Experience id (UUID)", {
    required: true,
    validate: (v) => (UUID.test(v) ? null : "Enter a UUID, e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890."),
  });
  const redirectUri = await pick("redirect-uri", "redirectUri", "Redirect URI registered with Alianza", { fallback: DEFAULT_REDIRECT_URI });

  const next: FileConfig = { ...existing, env: envName, clientId, clientSecret, experienceId, redirectUri };
  const apiBase = str(flags, "api-base-url");
  const authBase = str(flags, "auth-base-url");
  if (apiBase) next.apiBaseUrl = apiBase;
  if (authBase) next.authBaseUrl = authBase;
  writeConfigFile(configFile, next);
  process.stderr.write(`\nSaved ${configFile} (readable only by you).\n\n`);

  process.stderr.write(redirectUriInstructions(clientId, redirectUri) + "\n\n");

  const wantLogin = bool(flags, "login", true) && (interactive ? await confirm("Has Alianza confirmed the redirect URI? Sign in now?", true) : true);
  if (wantLogin) {
    const config = loadConfig({ ...env, ALIANZA_CONFIG_FILE: configFile });
    const auth = AuthManager.fromConfig(config);
    await login(config, auth, { loginHint: str(flags, "login-hint"), openBrowser: bool(flags, "browser", true) });
  } else {
    process.stderr.write("Skipping sign-in. Run `alianza-mcp login` once the redirect URI is registered.\n");
  }

  process.stderr.write(
    "\nNext: connect it to your Claude client:\n" +
      "  alianza-mcp install claude-code       (Claude Code CLI)\n" +
      "  alianza-mcp install claude-desktop    (Claude Desktop app)\n" +
      "Then run `alianza-mcp doctor` to verify everything end to end.\n",
  );
}
