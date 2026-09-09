# TypeScript MCP server template

An MCP server that wraps an HTTP API, built on `@modelcontextprotocol/sdk` 1.30. Runs over stdio for local hosts or Streamable HTTP for remote deployment. Ships with a fake upstream API so it works offline.

## Run

```bash
npm install
npm test                # in-process tests: tools, error mapping, HTTP transport, auth
npm run build

npm run fake-api        # terminal 1: fake Items API on http://127.0.0.1:4010
npm run dev             # terminal 2: server on stdio (Ctrl+C to stop)
npm run smoke           # terminal 3: spawns dist/index.js over stdio and exercises it

npm run dev:http        # Streamable HTTP on http://127.0.0.1:3000/mcp
```

Try it in the Inspector: `npm run inspect`.

## Files

| File | Role |
| --- | --- |
| `src/index.ts` | Entry point. Reads config, picks stdio or HTTP. |
| `src/server.ts` | Creates the `McpServer` and registers tools. |
| `src/tools/items.ts` | Example tools and the error-mapping helper. Replace with your own. |
| `src/api-client.ts` | Upstream HTTP client. Owns auth headers and timeouts. |
| `src/http.ts` | Express app: `/healthz`, bearer auth, stateless `/mcp`. |
| `src/config.ts` | Environment variable parsing. |
| `src/log.ts` | Stderr-only JSON logger. |
| `src/fake-api.ts` | In-memory Items API for tests and demos. |
| `scripts/smoke.ts` | Wire-level smoke test over stdio. |
| `test/` | Vitest suites. |

## Configuration

See `.env.example`. Every variable has a default suitable for local development against the fake API.

## Adapting to a real API

1. Rename the package and `SERVER_NAME` in `src/server.ts`.
2. Change the auth header and endpoint methods in `src/api-client.ts`.
3. Replace `src/tools/items.ts` using the design table from `docs/02-design-tools-from-an-api.md`.
4. Replace `src/fake-api.ts` with a mock of your API so tests stay offline.
5. Update `.env.example`.

## Deployment

```bash
docker build -t my-mcp .
docker run --rm -p 3000:3000 -e API_BASE_URL=https://api.example.com -e API_KEY=... -e MCP_AUTH_TOKEN=... my-mcp
```

See `docs/05-deploy.md` for client registration and hosting notes.
