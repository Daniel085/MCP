# MCP Server Toolkit

Instructions, templates, and deployment recipes for building a Model Context Protocol (MCP) server that wraps an existing API, then running it locally or as a remote service.

This repository is the generic base. To build a real server for a specific API, branch from `main`, copy one template, and follow the guides in `docs/`.

## What is in here

| Path | Purpose |
| --- | --- |
| `docs/` | Step-by-step guides: concepts, tool design, building, testing, deployment, security, and a done checklist. |
| `alianza-one/` | A real server built from the TypeScript template for the [Alianza One](https://infrastructure.developer.alianza.com/api-guides) cloud voice platform: 20 tools over accounts, users, numbers, devices, call records, and voicemail, with a fake Alianza API and tests. See `alianza-one/README.md`. |
| `templates/typescript/` | Runnable TypeScript server (`@modelcontextprotocol/sdk`) with stdio and Streamable HTTP transports, a fake API for offline testing, tests, and a Dockerfile. |
| `templates/python/` | The same server in Python (`mcp` 2.x, `MCPServer`), with stdio and Streamable HTTP, a fake API, tests, and a Dockerfile. |
| `deploy/` | Client configuration examples: Claude Code, Claude Desktop, the Claude API MCP connector, and Docker Compose. |
| `evals/` | Tool-selection evals: YAML prompts and expectations run through the Claude API against any stdio MCP server, to check the model picks the right tool. |
| `CLAUDE.md` | Working conventions for Claude Code sessions in this repository. |

## Quick start

Pick a language. Both templates expose the same three example tools (`list_items`, `get_item`, `create_item`) against a fictional Items API so you can see the full loop before touching a real API.

TypeScript:

```bash
cd templates/typescript
npm install
npm test                 # unit tests over an in-memory transport
npm run fake-api         # terminal 1: fake upstream API on :4010
npm run dev              # terminal 2: MCP server on stdio, pointed at the fake API
```

Python:

```bash
cd templates/python
uv sync --extra dev
uv run pytest
uv run fake-api          # terminal 1
uv run mcp-server        # terminal 2 (stdio)
```

Then point a client at it. The fastest check is the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node templates/typescript/dist/index.js
```

## Documentation

| Guide | Read it for |
| --- | --- |
| `docs/00-overview.md` | What this toolkit is, how a request flows through it, and how the pieces fit. Start here. |
| `docs/01-concepts.md` | MCP in one page: roles, tools, transports, lifecycle. |
| `docs/02-design-tools-from-an-api.md` | Turning an API into a small set of tools a model can use well. |
| `docs/03-build.md` | Template anatomy and the steps to adapt it. |
| `docs/04-test.md` | Unit, smoke, Inspector, and Claude Code testing. |
| `docs/05-deploy.md` | stdio installs, Streamable HTTP hosting, auth, client registration. |
| `docs/06-security.md` | Credentials, inputs, destructive tools, prompt injection. |
| `docs/07-checklist.md` | Definition of done for a new server. |
| `docs/08-worked-example.md` | Full adaptation to a realistic helpdesk API, both languages, with tested code. |
| `docs/09-alternatives.md` | Public generators, gateways, and templates, and when to use them instead. |

## Building a server for a real API

1. Read `docs/00-overview.md`, then `docs/01-concepts.md` if MCP is new to you.
2. Work through `docs/02-design-tools-from-an-api.md` to decide which endpoints become tools and how they are shaped.
3. Follow `docs/03-build.md` to copy a template and replace the example tools. `docs/08-worked-example.md` shows every change for a realistic API.
4. Test with `docs/04-test.md`, deploy with `docs/05-deploy.md`, and review `docs/06-security.md`.
5. Tick through `docs/07-checklist.md` before calling it done.

## Versions this toolkit targets

| Component | Version |
| --- | --- |
| MCP specification | 2026-07-28 |
| `@modelcontextprotocol/sdk` (TypeScript) | 1.30.x |
| `mcp` (Python) | 2.2.x |
| Node.js | 20 or newer |
| Python | 3.11 or newer |

Both SDKs moved recently. The Python SDK renamed `FastMCP` to `MCPServer` in 2.0, and the TypeScript SDK deprecated `server.tool()` in favour of `registerTool()`. The templates use the current APIs.
