# 4. Testing

Test at three levels: unit tests over an in-process transport, a wire-level smoke test against the built artefact, and a manual pass with the MCP Inspector and a real host.

## Unit tests (fast, no network)

Both templates ship tests that start the server in-process and call tools through a real MCP client.

TypeScript uses `InMemoryTransport.createLinkedPair()` from the SDK, a `Client`, and a stubbed `fetch` so the API client never leaves the process:

```bash
cd templates/typescript
npm test
```

Python calls `mcp.call_tool()` and `mcp.list_tools()` directly on the `MCPServer` and points the API client at the fake API through `httpx.ASGITransport`, so no socket is opened:

```bash
cd templates/python
uv run pytest
```

One difference to know: a direct `mcp.call_tool()` raises `ToolError` for a failed tool, while a client on the other side of a transport receives a result with `is_error=True` and the same message. The Python HTTP test covers the wire-level shape; the item tests assert on the raised error.

What to assert:

- `tools/list` returns exactly the tools you designed, with descriptions and annotations present.
- Each tool returns the trimmed shape you documented, not the raw upstream payload.
- Upstream 404, 401, 429, and 500 become `isError` results with the mapped text.
- Argument validation rejects bad input before your code runs (the SDK does this; test one case to be sure the schema is wired).

## Smoke test (wire level)

The smoke scripts spawn the real server over stdio, against the fake API, and run `initialize`, `tools/list`, and one `tools/call`.

```bash
# TypeScript
npm run build && npm run fake-api &
npm run smoke

# Python
uv run fake-api &
uv run smoke
```

Run this in CI after the build so that packaging problems (wrong entry point, missing shebang, stdout pollution) are caught.

## MCP Inspector (manual)

The Inspector is a browser UI that connects to any server and lets you call tools by hand.

```bash
# stdio
npx @modelcontextprotocol/inspector node templates/typescript/dist/index.js
npx @modelcontextprotocol/inspector uv --directory templates/python run mcp-server

# Streamable HTTP (server already running on :3000)
npx @modelcontextprotocol/inspector
# then choose "Streamable HTTP" and enter http://127.0.0.1:3000/mcp
```

Check: the tool list reads well, descriptions make sense out of context, a bad ID gives a helpful error, and nothing appears in the server's stdout.

## Claude Code (manual)

Add the server for the current project only, try it, then remove it:

```bash
claude mcp add --transport stdio --scope local items-dev \
  --env API_BASE_URL=http://127.0.0.1:4010 \
  -- node /abs/path/templates/typescript/dist/index.js

claude
# ask: "list the items, then create one called 'test'"
# check with /mcp that the server shows as connected

claude mcp remove items-dev
```

Watch how the model picks tools. If it calls the wrong one or fills arguments badly, the fix is almost always in the description, not the code.

## What good looks like

- Tests run in under 10 seconds and need no network.
- The smoke test runs in CI.
- Someone who has never seen the API can read `tools/list` and guess what each tool does.
