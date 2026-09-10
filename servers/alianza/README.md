# alianza-mcp

An MCP server for the Alianza Experience (Crux) API. It lets Claude enable a partner's Post-Call or Virtual Agent Experience for customer accounts and phone numbers, inspect and change connections and assignments, and read users. Built from the toolkit in this repository; see `DESIGN.md` for the API inventory and tool design.

Scope: the Crux API only (`/experience/*` and `/users`). The separate Alianza Public API v2 is a different product and is not covered. SIPREC and SIP media are network protocols, not REST, so they are out of scope; this server manages the control plane that turns them on.

## Tools

| Tool | What it does |
| --- | --- |
| `alianza_auth_status` | Which environment and credentials the server has; whether a login is needed. |
| `alianza_check_assignability` | Can this Experience be assigned to a phone number, account, or user? |
| `alianza_enable_experience` | The full onboarding flow: check, connect, assign, activate. Safe to re-run. |
| `alianza_list_connections`, `alianza_get_connection` | Connections link the Experience to an account; state gates media. |
| `alianza_create_connection` | Create (INACTIVE by default) or return the existing connection. |
| `alianza_set_connection_state` | ACTIVE or INACTIVE, with no-op detection. |
| `alianza_delete_connection` | Destructive; hosts confirm. |
| `alianza_list_assignments`, `alianza_get_assignment` | Which targets the Experience applies to. |
| `alianza_create_assignment` | ACCOUNT (Post-Call), PHONE_NUMBER (Virtual Agent), or USER. |
| `alianza_delete_assignment` | Destructive; hosts confirm. |
| `alianza_list_users`, `alianza_get_user` | Unified users, with `count` for seat totals. |

## Beta customers: start with BETA-SETUP.md

`BETA-SETUP.md` is the customer-facing guide: `npx -y alianza-mcp setup`, `install`, `doctor`. Everything below is for people working on the server.

## Commands

| Command | Purpose |
| --- | --- |
| `alianza-mcp` | Run the MCP server (stdio by default). |
| `alianza-mcp setup` | Collect credentials into `~/.config/alianza-mcp/config.json`, explain redirect-URI registration, sign in. Scriptable with flags and `--yes`. |
| `alianza-mcp login` | Sign in via Authorization Code + PKCE. |
| `alianza-mcp install claude-code` / `claude-desktop` | Register the server with a Claude client. `--print` to preview. |
| `alianza-mcp doctor` | Check Node, config, both credential kinds against the API, usage log. Non-zero exit on failure. |
| `alianza-mcp usage` | Summarise the local usage log (tool names and outcomes only). |
| `alianza-mcp auth-status` | Credential status as JSON. |

Configuration precedence is defaults, then the config file, then environment variables, so containers keep working with env vars alone.

## Credentials

The Crux API uses OAuth 2.0 with two token kinds. The server handles both; tools never see tokens.

| Need | Provide |
| --- | --- |
| Eligibility checks | `ALIANZA_CLIENT_ID` and `ALIANZA_CLIENT_SECRET` (client credentials, `experience-assignability:check`). |
| Everything else | A user-context token. Run `alianza-mcp login` once; it opens the browser (Authorization Code + PKCE), stores the tokens in `ALIANZA_TOKEN_FILE` (default `~/.config/alianza-mcp/tokens.json`), and the server refreshes them automatically. |
| Headless deployments | `ALIANZA_REFRESH_TOKEN` instead of the token file. |

Customers register the redirect URI themselves by asking Alianza; `setup` prints the exact request to send.

The `login` command needs a loopback redirect URI registered with Alianza for your client (default `http://127.0.0.1:8765/callback`; change with `ALIANZA_REDIRECT_URI`). Pass `--login-hint +14155551234` so home-realm discovery sends the user to the right identity provider.

```bash
export ALIANZA_CLIENT_ID=... ALIANZA_CLIENT_SECRET=... ALIANZA_EXPERIENCE_ID=...
npx alianza-mcp login --login-hint +14155551234
npx alianza-mcp auth-status
```

`ALIANZA_ENV=sandbox` (default) targets `api.b2.alianza.com` and `auth.beta.alianza.com`; `production` targets `api.alianza.com` and `auth.alianza.com`. Override either with `ALIANZA_API_BASE_URL` / `ALIANZA_AUTH_BASE_URL`.

## Run

```bash
npm install
npm test                 # 30+ tests over an in-memory transport and a fake Crux API, no network
npm run build

npm run fake-api         # terminal 1: fake Crux API + token endpoint on :4010
npm run smoke            # terminal 2: spawns dist/index.js over stdio and exercises it
```

Against the real sandbox, after `login`:

```bash
npm run dev              # stdio
npm run inspect          # MCP Inspector
```

## Register with Claude Code

```bash
claude mcp add --transport stdio --scope user alianza \
  --env ALIANZA_CLIENT_ID=$ALIANZA_CLIENT_ID \
  --env ALIANZA_CLIENT_SECRET=$ALIANZA_CLIENT_SECRET \
  --env ALIANZA_EXPERIENCE_ID=$ALIANZA_EXPERIENCE_ID \
  -- node /abs/path/servers/alianza/dist/index.js
```

The token file written by `login` is picked up automatically. Prompts to try:

| Prompt | Expected |
| --- | --- |
| "Can we enable our experience for +14155551234?" | `alianza_check_assignability` |
| "Enable it for that customer" | `alianza_enable_experience` after confirming |
| "Is the connection active for Acme?" | `alianza_list_connections` |
| "Pause it" | `alianza_set_connection_state` INACTIVE |
| "How many users does account X have?" | `alianza_list_users` and reads `count` |
| "Delete the connection" | Claude asks for confirmation, then `alianza_delete_connection` |

Tool-selection evals for these live in `evals/cases/alianza.yaml`.

## Deploy over HTTP

Same as the template: `MCP_TRANSPORT=http`, `MCP_AUTH_TOKEN` for the bearer, `MCP_ALLOWED_HOSTS` when bound to a non-loopback address, and the multi-stage `Dockerfile`. Provide `ALIANZA_REFRESH_TOKEN` in the container's environment since there is no browser to log in with.

## Files

| File | Role |
| --- | --- |
| `src/index.ts` | Entry point and command dispatch. |
| `src/cli/*.ts` | `setup`, `install`, `doctor`, flag parsing, prompts. |
| `src/usage.ts` | Local usage log and summary. |
| `src/auth.ts` | Token manager: client credentials, refresh, token file. |
| `src/login.ts` | Authorization Code + PKCE on a loopback redirect. |
| `src/api-client.ts` | Crux endpoints, problem-details errors, one 401 retry after refresh. |
| `src/tools/*.ts` | Tools by resource; `errors.ts` maps upstream failures; `enable.ts` is the composite. |
| `src/fake-api.ts` | In-memory Crux API and token endpoint for tests and demos. |
| `src/http.ts`, `src/config.ts`, `src/log.ts` | Transport and plumbing from the template. |
