# Python MCP server template

An MCP server that wraps an HTTP API, built on the `mcp` 2.x SDK (`MCPServer`, formerly `FastMCP`). Runs over stdio for local hosts or Streamable HTTP for remote deployment. Ships with a fake upstream API so it works offline.

## Run

```bash
uv sync --extra dev
uv run pytest            # in-process tests: tools, error mapping, HTTP transport, auth

uv run fake-api          # terminal 1: fake Items API on http://127.0.0.1:4010
uv run mcp-server        # terminal 2: server on stdio (Ctrl+C to stop)
uv run smoke             # terminal 3: spawns the server over stdio and exercises it

MCP_TRANSPORT=http uv run mcp-server   # Streamable HTTP on http://127.0.0.1:8000/mcp
```

Try it in the Inspector: `npx @modelcontextprotocol/inspector uv run mcp-server`.

Without `uv`: `python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`, then `python -m mcp_server`.

## Files

| File | Role |
| --- | --- |
| `src/mcp_server/__main__.py` | Entry point. Reads config, picks stdio or HTTP. |
| `src/mcp_server/server.py` | Creates the `MCPServer` and registers tools. |
| `src/mcp_server/tools/items.py` | Example tools and the error-mapping helper. Replace with your own. |
| `src/mcp_server/api_client.py` | Upstream HTTP client (httpx). Owns auth headers and timeouts. |
| `src/mcp_server/http.py` | Starlette app: `/healthz`, bearer auth middleware, stateless `/mcp`. |
| `src/mcp_server/config.py` | Environment variable parsing. |
| `src/mcp_server/logging_setup.py` | Stderr-only JSON logging. |
| `src/mcp_server/fake_api.py` | In-memory Items API for tests and demos. |
| `src/mcp_server/smoke.py` | Wire-level smoke test over stdio. |
| `tests/` | Pytest suites. |

## Configuration

See `.env.example`. Every variable has a default suitable for local development against the fake API.

## Adapting to a real API

1. Rename the package in `pyproject.toml` and `SERVER_NAME` in `src/mcp_server/__init__.py`.
2. Change the auth header and endpoint methods in `src/mcp_server/api_client.py`.
3. Replace `src/mcp_server/tools/items.py` using the design table from `docs/02-design-tools-from-an-api.md`.
4. Replace `src/mcp_server/fake_api.py` with a mock of your API so tests stay offline.
5. Update `.env.example`.

## Deployment

```bash
docker build -t my-mcp .
docker run --rm -p 8000:8000 -e API_BASE_URL=https://api.example.com -e API_KEY=... -e MCP_AUTH_TOKEN=... my-mcp
```

See `docs/05-deploy.md` for client registration and hosting notes.
