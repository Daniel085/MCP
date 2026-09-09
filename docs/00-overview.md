# 0. What this toolkit is and how it works

## In one paragraph

This repository is a starting point for putting an existing HTTP API in front of an AI model through the Model Context Protocol (MCP). It contains two complete, tested MCP servers (one TypeScript, one Python) that wrap a small fictional "Items" API, plus the guides, client configurations, and CI needed to turn one of them into a server for a real API and run it either on a developer's machine or as a hosted service. You do not write protocol code. You design a handful of tools, implement each as a typed function that calls your API, and the SDK does the rest.

## The problem it solves

Claude Code, Claude Desktop, claude.ai, and the Claude API can all call tools exposed by an MCP server. Your API already exists, but a model cannot use it directly: it has no credentials, no idea which endpoints matter, and no tolerance for raw payloads or cryptic errors. An MCP server sits between the two:

```
┌──────────────┐   MCP (JSON-RPC)   ┌──────────────────┐   HTTPS   ┌──────────────┐
│  Host        │ ◄────────────────► │  Your MCP server │ ────────► │  Your API    │
│  (Claude)    │  tools/list        │  (this toolkit)  │  GET/POST │  (existing)  │
│              │  tools/call        │                  │           │              │
└──────────────┘                    └──────────────────┘           └──────────────┘
      │                                      │
      │ user consent, tool selection         │ credentials, tool design, error mapping,
      │ argument filling                     │ output trimming, auth, logging
```

The server owns everything the host should not: the API credential, the choice of which operations to expose, the shape of the inputs and outputs, and the translation of failures into text the model can act on.

## How a request flows

Take the user typing "what's the item called Gizmo?" in Claude Code with the TypeScript template registered over stdio.

1. **Launch.** Claude Code spawns `node dist/index.js`. `src/index.ts` reads the environment (`src/config.ts`), builds an `ApiClient` (`src/api-client.ts`), builds the server (`src/server.ts`), and connects it to a `StdioServerTransport`. From now on stdout is the wire and every log line goes to stderr (`src/log.ts`).
2. **Handshake.** The host sends `initialize`. The SDK answers with the server's name, version, capabilities, and the `instructions` string from `createServer`. The host sends `notifications/initialized`.
3. **Discovery.** The host sends `tools/list`. The SDK returns the three tools registered in `src/tools/items.ts`, each with its title, description, JSON Schema derived from the Zod input schema, output schema, and annotations. The host puts these in the model's context.
4. **Selection.** The model reads the descriptions, decides `list_items` fits (the description says to use it when there is no exact id), and produces `{ "query": "Gizmo" }`. Because `list_items` is annotated `readOnlyHint: true`, most hosts run it without a confirmation prompt.
5. **Validation.** The host sends `tools/call`. The SDK validates the arguments against the schema, applies defaults (`limit: 10`, `offset: 0`), and invokes the handler. Bad arguments never reach your code.
6. **Upstream call.** The handler calls `api.listItems(...)`. The client builds `GET /items?q=Gizmo&limit=10&offset=0`, adds the `Authorization` header from `API_KEY`, and applies the timeout.
7. **Shaping.** The handler trims each record to the fields a person would want, writes a short text summary with a paging hint, and returns both `content` (text) and `structuredContent` (JSON matching the output schema).
8. **Failure path.** If the API had returned 404, 401, 429, or 5xx, the client would throw `ApiError`, and `withErrorHandling` would convert it to a tool result with `isError: true` and a mapped message such as "Rate limited by the upstream API. Retry after 30 seconds." The model sees that text and can retry, ask the user, or try a different tool. Only genuine bugs propagate as exceptions.
9. **Response.** The SDK serialises the result and the host hands it to the model, which answers the user.

The Python template follows the same sequence with `MCPServer`, `@mcp.tool`, `httpx`, and `ToolError`. Over Streamable HTTP the only difference is step 1: instead of a spawned process, each HTTP POST to `/mcp` builds a fresh server and transport, handles the request, and tears down (stateless mode), with a bearer-token check in front.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Guides | `docs/01` to `docs/07` | Concepts, tool design, building, testing, deployment, security, done-checklist. Read in order the first time. |
| Worked example | `docs/08-worked-example.md` | Adapts the template to a realistic ticketing API end to end, with the code. |
| Alternatives | `docs/09-alternatives.md` | What exists publicly, and when to use it instead of this toolkit. |
| TypeScript template | `templates/typescript/` | Server, API client, tools, HTTP app, fake API, tests, smoke test, Dockerfile. |
| Python template | `templates/python/` | Same, feature for feature. |
| Client configs | `deploy/` | Claude Code, Claude Desktop, Claude API connector, Docker Compose. |
| CI | `.github/workflows/ci.yml` | Typecheck, lint, tests, smoke tests, audit, and Docker builds for both templates. |

## Design principles baked into the templates

- **Tools are designed, not generated.** A model works best with a small set of task-shaped tools that have prompt-quality descriptions. The toolkit deliberately does not auto-generate one tool per endpoint. See `docs/09-alternatives.md` for when generation is the right call.
- **One place for credentials.** The API client is the only code that sees `API_KEY`. Tools call typed methods.
- **Errors are data.** Upstream failures become `isError` results with actionable text. The model recovers; the user is not shown a stack trace.
- **Same code, two transports.** `MCP_TRANSPORT=stdio` for local hosts, `MCP_TRANSPORT=http` for remote. Nothing in the tools changes.
- **Offline tests.** Each template ships a fake upstream API. Tests and the smoke test run with no network and no credentials.
- **Current SDKs.** TypeScript uses `registerTool` (the older `server.tool()` is deprecated). Python uses `MCPServer` from `mcp` 2.x (the older `FastMCP` name inside the official SDK was renamed in 2.0).

## What "using it for your own API" means in practice

1. Copy one template. Rename it.
2. Write down the 5 to 15 operations users actually need, as a tool table (`docs/02`).
3. Edit the API client: auth header, base URL, one typed method per upstream call.
4. Replace the example tools with yours. Each is 20 to 40 lines.
5. Extend the fake API so your tests cover success and failure paths.
6. Run it in the Inspector and in Claude Code. Fix descriptions until the model picks the right tool.
7. Register it (stdio) or containerise it (HTTP) using `deploy/` and `docs/05`.

`docs/08-worked-example.md` walks through exactly this for a ticketing API, in both languages.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20 or newer | TypeScript template, MCP Inspector |
| npm | bundled | TypeScript template |
| Python | 3.11 or newer | Python template |
| uv | any recent | Python template (pip works too) |
| Docker | any recent | Container builds and the compose stack (optional) |
| Claude Code, Claude Desktop, or an API key | | Trying the server from a real host |
