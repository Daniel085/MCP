# 9. What already exists, and when to use it instead

Nothing publicly available is exactly this repository: a language-paired, tested, deployable base for hand-designed MCP servers over an existing API with a fake upstream for offline tests and Claude-specific client configuration. But every individual piece has public counterparts, and for some situations one of them is the better choice. This page lists them honestly.

## Categories

### 1. OpenAPI-to-MCP generators (self-hosted, code you keep)

These read an OpenAPI document and emit or run an MCP server with one tool per operation.

| Tool | Language | Notes |
| --- | --- | --- |
| [FastMCP `from_openapi()`](https://gofastmcp.com/integrations/openapi) | Python | The standalone `fastmcp` package by Jeremy Lowin (not the `mcp` SDK's former `FastMCP` class). One call turns a spec plus an `httpx` client into a server. Route maps let you exclude or rename operations. Its own docs say curated servers perform "significantly better" than auto-converted ones for complex APIs. |
| [openapi-mcp-generator](https://github.com/harsha-iiiv/openapi-mcp-generator) | TypeScript | CLI that emits a server project with Zod schemas, stdio / Streamable HTTP transports, and env-based auth. Good scaffold if you want generated code you then edit. |
| [Speakeasy](https://www.speakeasy.com/product/mcp-server/) | TypeScript | Generates an MCP server alongside (or separate from) SDKs from OpenAPI. Supports Cloudflare Workers and Docker deployment. Commercial, free tier. |
| [Stainless](https://www.stainless.com/blog/generate-mcp-servers-from-openapi-specs/) | TypeScript | Generates an MCP server inside the SDK package from its own config DSL. Commercial, free for MCP generation. |
| [Kubb](https://xata.io/blog/built-xata-mcp-server) | TypeScript | General OpenAPI codegen with an MCP plugin; used by Xata for their server. |

**Use one of these when** the API has an accurate OpenAPI spec, fewer than roughly 20 relevant operations, and you want a server today rather than a designed one. Generated tool descriptions are the spec's `summary` fields, which were written for humans reading docs, not for a model choosing between tools; expect to edit them.

**Do not use them blindly when** the spec has hundreds of operations. A 200-endpoint spec converted one-to-one can push tens of thousands of tokens of schema into every request and degrades tool selection. The common pattern in 2026 is to generate, then prune to the operations that matter, which is most of the work this toolkit's design guide asks you to do up front.

### 2. Managed gateways (no code, vendor hosted)

| Product | Notes |
| --- | --- |
| [Azure API Management](https://learn.microsoft.com/en-us/azure/api-management/export-rest-mcp-server) | Expose selected operations of an APIM-managed REST API as a remote MCP server, with APIM policies for auth and rate limiting. Tools only, no resources or prompts. Requires a v2 tier. |
| [Gram (Speakeasy)](https://www.speakeasy.com/blog/generate-mcp-from-openapi) | Hosted: upload a spec, curate toolsets, get a URL. |
| Apigee, Kong, Tyk, and similar | Each has an MCP export or plugin path; see [api-to-mcp-server](https://github.com/meetrais/api-to-mcp-server) for a survey. Details change quickly; check the vendor's current docs. |
| Zapier MCP, Composio, Pipedream | Hosted catalogues of pre-built connectors to SaaS APIs. If your "existing API" is a well-known SaaS product, one of these may already expose it. |

**Use one of these when** the API already lives behind that gateway, you need enterprise auth and governance without owning code, and the vendor's constraints (tools only, hosting location) are acceptable.

### 3. Hosting-specific frameworks

| Tool | Notes |
| --- | --- |
| [Cloudflare Agents `McpAgent`](https://developers.cloudflare.com/agents/model-context-protocol/) | `npm create cloudflare@latest -- my-mcp --template=cloudflare/ai/demos/remote-mcp-authless`. A Durable Object per session, built-in OAuth options, deploys to Workers in minutes. The right choice if you are already on Cloudflare or want the cheapest remote hosting. Vendor-specific runtime. |

### 4. Generic starter templates

| Tool | Notes |
| --- | --- |
| [`@modelcontextprotocol/create-server`](https://github.com/modelcontextprotocol/create-typescript-server) | Official minimal TypeScript scaffold. No transport choice, no API client, no tests. |
| [alexanderop/mcp-server-starter-ts](https://github.com/alexanderop/mcp-server-starter-ts), [rully-saputra15/ts-mcp-starter-kit](https://github.com/rully-saputra15/ts-mcp-starter-kit), [ferrants/mcp-streamable-http-typescript-server](https://github.com/ferrants/mcp-streamable-http-typescript-server) | Community TypeScript starters with stdio and HTTP. Vary in currency with the SDK; check which registration API and transport they use before adopting. |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Reference servers (filesystem, git, fetch, memory, and more). Good for reading real code; not templates for an API wrapper. |

### 5. The SDKs themselves

[typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) and the Python `mcp` package ship runnable examples covering stateful and stateless Streamable HTTP, OAuth, elicitation, sampling, and tasks. This toolkit is a thin, opinionated layer over them; when you need a feature the templates do not show, the SDK examples are the next place to look.

## Where this toolkit fits

| You want | Use |
| --- | --- |
| A server from a spec in an afternoon, will prune later | FastMCP `from_openapi()` or openapi-mcp-generator |
| No code, API already in Azure APIM or a similar gateway | The gateway's MCP export |
| Cheapest remote hosting, already on Cloudflare | Cloudflare `McpAgent` |
| A designed tool surface for a model, in TypeScript or Python, tested offline, deployable anywhere, with Claude client configs ready | This toolkit |
| A SaaS product that Zapier or Composio already cover | Their hosted MCP |

The trade this toolkit makes is deliberate: it costs an hour of design per server and gives back a tool list a model can use well. Generators save the hour and hand the design problem to whoever prunes the output later. Both are valid; pick by how many operations matter and how much you care about the model's success rate.

## Sources

- [Speakeasy: Generate MCP servers from OpenAPI documents](https://www.speakeasy.com/blog/generate-mcp-from-openapi)
- [Speakeasy: Generating MCP tools from OpenAPI, benefits and limits](https://www.speakeasy.com/mcp/tool-design/generate-mcp-tools-from-openapi/)
- [Stainless: Generate MCP servers from OpenAPI specs](https://www.stainless.com/blog/generate-mcp-servers-from-openapi-specs/)
- [FastMCP OpenAPI integration](https://gofastmcp.com/integrations/openapi)
- [Jeremy Lowin: Stop converting your REST APIs to MCP](https://jlowin.dev/blog/stop-converting-rest-apis-to-mcp)
- [openapi-mcp-generator](https://github.com/harsha-iiiv/openapi-mcp-generator)
- [Xata: From OpenAPI spec to MCP server with Kubb](https://xata.io/blog/built-xata-mcp-server)
- [Azure API Management: Expose REST API as MCP server](https://learn.microsoft.com/en-us/azure/api-management/export-rest-mcp-server)
- [api-to-mcp-server survey](https://github.com/meetrais/api-to-mcp-server)
- [Cloudflare Agents: Model Context Protocol](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Cloudflare: Build a remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [modelcontextprotocol/create-typescript-server](https://github.com/modelcontextprotocol/create-typescript-server)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- [DigitalAPI: How to convert OpenAPI specs into an MCP server](https://www.digitalapi.ai/blogs/convert-openapi-specs-into-mcp-server)
