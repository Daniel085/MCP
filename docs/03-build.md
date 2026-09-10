# 3. Building the server

Both templates have the same structure. Pick the language your team maintains best; the wrapped API does not care.

## Template anatomy

| Concern | TypeScript | Python |
| --- | --- | --- |
| Entry point, picks transport from env | `src/index.ts` | `src/mcp_server/__main__.py` |
| Server factory, registers tools | `src/server.ts` | `src/mcp_server/server.py` |
| Upstream API client | `src/api-client.ts` | `src/mcp_server/api_client.py` |
| Configuration from env | `src/config.ts` | `src/mcp_server/config.py` |
| Tools, one file per group | `src/tools/items.ts` | `src/mcp_server/tools/items.py` |
| Shared error mapping | `src/tools/errors.ts` | `src/mcp_server/tools/errors.py` |
| Streamable HTTP app and auth | `src/http.ts` | `src/mcp_server/http.py` |
| Fake upstream API for local runs and tests | `src/fake-api.ts` | `src/mcp_server/fake_api.py` |
| Tests | `test/*.test.ts` (vitest) | `tests/test_*.py` (pytest) |

## Step 1: Copy and rename

```bash
cp -r templates/typescript my-api-mcp    # or templates/python
cd my-api-mcp
```

Change the package name in `package.json` or `pyproject.toml`, and the server name and version passed to `McpServer` / `MCPServer`. Hosts show that name to users.

## Step 2: Point the API client at the real API

The client is a thin wrapper around `fetch` (TypeScript) or `httpx` (Python) that:

- Reads `API_BASE_URL` and `API_KEY` from the environment.
- Sets the auth header once.
- Applies a request timeout.
- Converts non-2xx responses into an `ApiError` with status and message.

Change the auth header to whatever the API wants. Common variants:

```ts
// Bearer
headers.set("Authorization", `Bearer ${config.apiKey}`);
// Custom header
headers.set("X-Api-Key", config.apiKey);
// Basic
headers.set("Authorization", "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"));
```

If the API uses OAuth client credentials, add a token cache to the client that refreshes before expiry. Keep it inside the API client so tools never see tokens.

## Step 3: Replace the tools

Delete the example items tools and write yours from the table you built in the design guide. The registration call looks like this.

TypeScript (`registerTool` is current; `server.tool()` is deprecated):

```ts
server.registerTool(
  "get_item",
  {
    title: "Get item",
    description: "Fetch one item by id. Use list_items when you only have a name.",
    inputSchema: { id: z.string().describe("Item id, e.g. itm_123") },
    outputSchema: { id: z.string(), name: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id }) => {
    const item = await api.getItem(id);
    return {
      content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
      structuredContent: item,
    };
  },
);
```

Python (`mcp` 2.x; `FastMCP` was renamed to `MCPServer`):

```python
@mcp.tool(
    title="Get item",
    description="Fetch one item by id. Use list_items when you only have a name.",
    annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True),
)
async def get_item(id: Annotated[str, Field(description="Item id, e.g. itm_123")]) -> Item:
    return await api.get_item(id)
```

In Python, returning a Pydantic model or a dict produces both text and structured content automatically. Raise `ToolError("...")` for failures the model should see. Any other exception is treated as a crash and the model only sees a generic message.

## Step 4: Handle errors in one place

Both templates keep the mapping in one module so every tool behaves the same: `withErrorHandling` in `src/tools/errors.ts` wraps a tool body and returns an `isError` result for `ApiError`; `api_error_to_tool_error` in `src/mcp_server/tools/errors.py` converts an `ApiError` into a `ToolError` to raise. Edit the status-to-text mapping there, not in the tools.

## Step 5: Configuration

All configuration comes from environment variables. The templates read:

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_BASE_URL` | `http://127.0.0.1:4010` | Upstream API root. |
| `API_KEY` | empty | Credential sent to the upstream API. |
| `API_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address for HTTP. Use `0.0.0.0` in containers. |
| `MCP_HTTP_PORT` | `3000` (TS) / `8000` (Py) | HTTP port. |
| `MCP_HTTP_PATH` | `/mcp` | Endpoint path. |
| `MCP_AUTH_TOKEN` | empty | If set, HTTP requests must send `Authorization: Bearer <token>`. |
| `MCP_ALLOWED_HOSTS` | empty | Comma-separated Host header allowlist for DNS-rebinding protection when binding to a non-loopback address. |
| `LOG_LEVEL` | `info` | Logging verbosity on stderr. |

Copy `.env.example` to `.env` for local runs. Never commit `.env`.

## Step 6: Logging

Log to stderr, structured if you can. In the stdio transport stdout is the wire; a single stray line breaks the connection. The templates configure this for you. In TypeScript use the provided `log` helper, not `console.log`. In Python use the `logging` module, which the template routes to stderr.

## Step 7: Keep the fake API honest

The fake API is what tests run against. When you add a real tool, add the matching route and a fixture to the fake API, or replace it with recorded responses from the real API. Do not let tests depend on the network.

## Common mistakes

- Registering a tool per endpoint. Design first.
- A tool named `query` or `run`. Names must say what they do.
- Descriptions that repeat the name. Say when to use it and what comes back.
- Returning the raw upstream JSON. Trim it.
- Throwing on a 404. Return `isError: true` so the model can try something else.
- Reading credentials from tool arguments.
- `console.log` in a stdio server.
