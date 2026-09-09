# 1. MCP concepts

The Model Context Protocol (MCP) is an open protocol for connecting LLM applications to external tools and data. It uses JSON-RPC 2.0 messages over a transport. This page covers only what you need to build a server that wraps an API.

## Roles

| Role | What it is | Examples |
| --- | --- | --- |
| Host | The LLM application the user is talking to. | Claude Code, Claude Desktop, the Claude API (via the MCP connector). |
| Client | The connector inside the host that speaks MCP to one server. One client per server. | Created by the host. You do not write it. |
| Server | Your process. It advertises capabilities and answers requests. | The thing this toolkit builds. |

## What a server can expose

| Feature | Who invokes it | Use it for |
| --- | --- | --- |
| Tools | The model, with user consent. | Actions and lookups. `search_orders`, `create_ticket`. This is 90% of an API wrapper. |
| Resources | The host or user attaches them to context. Read-only. | Documents, configuration, records addressed by URI. Optional for most API wrappers. |
| Prompts | The user picks them from a menu. | Reusable workflows: "triage this incident". Optional. |

Servers can also ask the client for things: elicitation (ask the user a question), sampling (ask the host's model), and logging. These are useful but not required.

## Tool shape

A tool is a name, a description, an input schema (JSON Schema), optional output schema, and optional annotations. The model sees the name, description, and schema. Annotations tell the host how risky the tool is:

| Annotation | Meaning |
| --- | --- |
| `readOnlyHint` | The tool does not modify anything. |
| `destructiveHint` | The tool may delete or irreversibly change data. Defaults to true for non-read-only tools. |
| `idempotentHint` | Calling it twice with the same arguments has no extra effect. |
| `openWorldHint` | The tool talks to external systems whose state you do not control. |

Hosts use these to decide when to prompt the user. Set them honestly.

A tool call result carries `content` (text, images, or embedded resources), optional `structuredContent` (JSON matching the output schema), and an `isError` flag. Return `isError: true` with a readable message for failures the model should recover from. Throw only for bugs.

## Transports

| Transport | When | How the host launches it |
| --- | --- | --- |
| stdio | Local use. The host spawns your process and talks over stdin/stdout. | `command` + `args` in the host's config. |
| Streamable HTTP | Remote or shared servers. A single `/mcp` endpoint that accepts POST and optionally streams responses with Server-Sent Events. | A URL in the host's config. |
| HTTP+SSE (legacy) | Older clients only. Deprecated. | Do not build new servers on it. |

One hard rule for stdio: nothing may write to stdout except the transport. A stray `console.log` or `print()` corrupts the stream. Log to stderr.

Streamable HTTP servers can be stateless (every request builds a fresh server, easy to scale behind a load balancer) or stateful (a session ID header ties requests together, needed for server-initiated notifications). The templates default to stateless.

## Lifecycle

1. Client sends `initialize` with its protocol version and capabilities. Server replies with its own.
2. Client sends `notifications/initialized`.
3. Client calls `tools/list`, then `tools/call` as the model decides.
4. Either side can send `ping`, progress notifications, and cancellations.

The SDKs handle all of this. You register tools and pick a transport.

## Specification

This toolkit targets the 2026-07-28 revision. The spec lives at https://modelcontextprotocol.io/specification/latest. The SDKs negotiate the protocol version, so you rarely need to read it. The two sections worth reading are Server Features (tools, resources, prompts) and the Authorization section under Base Protocol if you plan a remote server with OAuth.
