# Alianza MCP server: beta setup guide

This guide gets the Alianza MCP server running on your machine and connected to Claude in about ten minutes. It lets Claude enable your Post-Call or Virtual Agent Experience for customer accounts and phone numbers, check and change connections and assignments, and look up users, all against your own Alianza credentials.

This is a beta. The server runs locally on your computer, uses your own OAuth client, and stores tokens only in your home directory. Nothing is sent anywhere except to Alianza's API.

## Before you start

You need:

1. **Node.js 20 or newer.** Check with `node --version`. Install from https://nodejs.org if needed.
2. **Your Alianza OAuth client id and client secret**, and your **Experience id**, from Alianza onboarding.
3. **A redirect URI registered on your OAuth client.** This is the one step you must ask Alianza for, and nothing works until it is done. Send your onboarding contact (or Alianza support) this request, replacing the client id:

   > Please add the following redirect URI to OAuth client `<your client id>`:
   > `http://127.0.0.1:8765/callback`

   The URI must match exactly, including the port and the path. It is a loopback address, which is the standard way command-line tools complete OAuth sign-in; the browser redirects to a small listener that the server starts on your machine for a few seconds during sign-in. If port 8765 is taken on your machine, choose another (for example 8766), register that instead, and give it to `setup` when asked.

4. **Claude Code** (`claude` on your PATH) or **Claude Desktop**.

## Step 1: run setup

```bash
npx -y alianza-mcp setup
```

Setup asks for the environment (`sandbox` unless Alianza has moved you to production), your client id, client secret, Experience id, and the redirect URI. It writes them to `~/.config/alianza-mcp/config.json`, readable only by you, so you never have to manage environment variables.

It then offers to sign you in. If Alianza has confirmed the redirect URI, say yes: a browser tab opens on Alianza's sign-in page. Sign in as the Alianza user whose account should be managed. If you are taken to the wrong identity provider, re-run with a phone number from your account as a hint:

```bash
npx -y alianza-mcp login --login-hint +14155551234
```

After sign-in, tokens are stored in `~/.config/alianza-mcp/tokens.json` and refreshed automatically. You should not need to sign in again unless Alianza revokes the session.

## Step 2: connect Claude

Claude Code:

```bash
npx -y alianza-mcp install claude-code
```

Claude Desktop:

```bash
npx -y alianza-mcp install claude-desktop
```

Then fully quit and reopen Claude Desktop. The install command edits `claude_desktop_config.json` for you and keeps a backup next to it. Add `--print` to see the change without applying it.

## Step 3: verify

```bash
npx -y alianza-mcp doctor
```

Every line should read `OK`. `doctor` checks Node, the config file, both credential kinds against Alianza's API, and the usage log. When something is wrong it says what to do.

Then, in Claude Code, type `/mcp` and confirm `alianza` shows as connected. In Claude Desktop, start a new chat and look for the tools icon.

## Try it

| Ask Claude | What happens |
| --- | --- |
| "Which Alianza environment are we connected to?" | Reports sandbox or production and the signed-in state. |
| "Can we enable our experience for +14155551234?" | Checks assignability. Read-only. |
| "Enable it for that customer." | Claude confirms with you, then runs the whole flow: connection, assignment, activation. |
| "Is the connection active for that account?" | Lists connections by phone number. |
| "Pause it." | Sets the connection INACTIVE. |
| "How many users does that account have?" | Lists users and reports the total. |

Claude will ask before anything that changes live call routing, and again before deleting anything.

## Feedback

The server keeps a small local log of which tools were called and whether they succeeded. It never records arguments, phone numbers, or ids. To see it:

```bash
npx -y alianza-mcp usage
```

Please paste that summary into your feedback, along with what you were trying to do when something went wrong. If a tool reported an error with a `traceId`, include it; Alianza support can look it up. To disable the log, set `"usageLog": "off"` in the config file.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Browser shows an error about the redirect URI | Alianza has not registered it yet, or it does not match exactly. See "Before you start". |
| `doctor` fails on "Client credentials" | Client id or secret is wrong, or the environment is wrong. Re-run `setup`. |
| `doctor` fails on "User sign-in" | Run `npx -y alianza-mcp login`. |
| Claude says a tool "lacks the users:manage scope" | Sign in again; the token was issued without that scope. |
| Claude Desktop does not show the tools | Fully quit the app (not just the window) and reopen. Check the file `install --print` names. |
| `claude mcp add` was not found | Install Claude Code, or run `install claude-code --print` and paste the printed command. |
| Something else | Run `npx -y alianza-mcp doctor` and send the output with your feedback. |

## Uninstall

```bash
claude mcp remove alianza          # Claude Code
rm -rf ~/.config/alianza-mcp       # config, tokens, usage log
```

For Claude Desktop, remove the `alianza` entry from `claude_desktop_config.json` (the backup written by `install` has the previous version).
