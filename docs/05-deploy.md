# 5. Deployment

There are two deployment shapes. Local stdio is simplest and right for personal or developer tooling. Streamable HTTP is for shared servers, hosted services, and the Claude API connector.

## Option A: local stdio

The host spawns your process. Users need the runtime (Node or Python) installed.

### Distribute the code

| Method | Command users run | Notes |
| --- | --- | --- |
| npm package with a `bin` | `npx -y my-api-mcp` | Publish to npm or a private registry. The template's `package.json` already declares `bin`. |
| PyPI package with a script | `uvx my-api-mcp` | The template's `pyproject.toml` declares `[project.scripts]`. |
| Git checkout | `node dist/index.js` or `uv run mcp-server` | Fine for internal teams. |

### Register with Claude Code

```bash
claude mcp add --transport stdio --scope user my-api \
  --env API_BASE_URL=https://api.example.com \
  --env API_KEY=... \
  -- npx -y my-api-mcp
```

Scopes: `local` (this project, this user), `project` (writes `.mcp.json`, committed and shared), `user` (all projects for this user). For a shared `.mcp.json`, reference secrets by environment variable so nothing lands in git. See `deploy/claude-code/mcp.json.example`.

### Register with Claude Desktop

Edit `claude_desktop_config.json` (Settings, Developer, Edit Config). See `deploy/claude-desktop/claude_desktop_config.example.json`. Claude Desktop only supports stdio in that file; remote servers are added as Connectors in Settings.

## Option B: Streamable HTTP

Run the server as a long-lived HTTP service exposing `POST /mcp`. Both templates switch on `MCP_TRANSPORT=http`.

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=3000 \
API_BASE_URL=https://api.example.com API_KEY=... MCP_AUTH_TOKEN=... \
node dist/index.js
```

### Stateless vs stateful

The templates run stateless: a fresh `McpServer` per request, no session header, safe behind any load balancer. Choose stateful only if you need server-initiated notifications (`tools/list_changed`, resource subscriptions) or long-lived per-client state. In stateful mode the SDK issues an `Mcp-Session-Id` header and you must route all of a session's requests to the same instance (sticky sessions or a shared event store). The TypeScript template's `src/http.ts` shows the stateless wiring and comments on the stateful variant.

### Container

Each template has a multi-stage `Dockerfile`. Build and run:

```bash
docker build -t my-api-mcp templates/typescript
docker run --rm -p 3000:3000 \
  -e MCP_TRANSPORT=http -e MCP_HTTP_HOST=0.0.0.0 \
  -e API_BASE_URL=https://api.example.com -e API_KEY=... -e MCP_AUTH_TOKEN=... \
  my-api-mcp
```

`deploy/docker-compose.yml` runs the server together with the fake API for a full local stack.

The container exposes `GET /healthz` for liveness probes. It does not require auth.

### Where to host

Anything that runs a container and forwards HTTP works. Requirements:

- HTTPS termination (a reverse proxy, a cloud load balancer, or the platform's ingress).
- Support for streaming responses. Streamable HTTP uses Server-Sent Events for long tool calls; disable proxy response buffering (`proxy_buffering off` in nginx) or set `json_response` mode in the template if your proxy cannot stream.
- Request timeouts long enough for your slowest tool.

Platforms that fit well: Cloud Run, Fly.io, ECS/Fargate, Azure Container Apps, Kubernetes, a plain VM with systemd and Caddy. Serverless functions work only in stateless mode and only if they can stream.

### Authentication

Pick one:

1. Shared bearer token (`MCP_AUTH_TOKEN`). Built into the templates. Fine for internal tools and single-tenant deployments. Rotate it like any other secret. Clients send `Authorization: Bearer <token>`.
2. OAuth 2.1 resource server. Required if the server is multi-user or public. The server validates tokens issued by an authorization server and publishes protected-resource metadata so clients can discover it. Both SDKs ship the pieces: `requireBearerAuth` and `mcpAuthMetadataRouter` in TypeScript, `token_verifier` plus `AuthSettings` in Python. Use your identity provider (Auth0, Okta, Entra, Keycloak) as the authorization server; do not write one.
3. Network only. A private network with no auth on the server is acceptable for a prototype, never for anything with real credentials behind it.

Also enable DNS-rebinding protection when binding to a non-loopback address: set `MCP_ALLOWED_HOSTS` to the hostnames clients will use.

### Register a remote server with clients

Claude Code:

```bash
claude mcp add --transport http --scope user my-api https://mcp.example.com/mcp \
  --header "Authorization: Bearer ${MCP_AUTH_TOKEN}"
```

For OAuth servers omit the header; Claude Code runs the browser flow when you type `/mcp`.

Claude Desktop and claude.ai: add the URL as a custom Connector in Settings.

Claude API (server-side connection from a Messages request): see `deploy/claude-api/`. Two parts are required together, `mcp_servers` and an `mcp_toolset` entry in `tools`, plus the `mcp-client-2025-11-20` beta header. The server must be reachable from Anthropic's network over HTTPS.

## Operational checklist

- Health endpoint wired to the platform's probes.
- Logs go to stderr, are structured, and never include tokens.
- Secrets injected from the platform's secret store, not baked into the image.
- A staging deployment pointed at the API's sandbox environment.
- Version pinned in the server's `initialize` response so clients can report it.
