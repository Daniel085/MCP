# Claude API MCP connector

The Messages API can connect to a remote Streamable HTTP MCP server directly. Anthropic's servers make the MCP connection, so the server must be reachable over public HTTPS and must not require a browser-based login. A shared bearer token passed as `authorization_token` works with the templates' `MCP_AUTH_TOKEN` setting.

Two request parts are required together:

1. `mcp_servers`: the server URL and a name.
2. A `tools` entry of type `mcp_toolset` whose `mcp_server_name` matches that name.

The beta header is `mcp-client-2025-11-20`. Omitting the toolset entry is a validation error.

Run:

```bash
export ANTHROPIC_API_KEY=...        # or `ant auth login`
export MCP_SERVER_URL=https://mcp.example.com/mcp
export MCP_AUTH_TOKEN=...

pip install anthropic && python connector.py
npm install @anthropic-ai/sdk && npx tsx connector.ts
```

Both examples enable the server-side refusal fallback so a safety refusal on the primary model is re-routed automatically. Remove the `fallbacks` and the second beta flag if you do not want that.
