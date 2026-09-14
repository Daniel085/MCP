# Claude Code registration commands

Scopes: `local` (this project, you only; default), `project` (writes `.mcp.json`, shared with the team), `user` (every project, you only).

## stdio, from a git checkout

```bash
# TypeScript build
claude mcp add --transport stdio --scope local items \
  --env API_BASE_URL=http://127.0.0.1:4010 --env API_KEY=$API_KEY \
  -- node /abs/path/to/templates/typescript/dist/index.js

# Python via uv
claude mcp add --transport stdio --scope local items-py \
  --env API_BASE_URL=http://127.0.0.1:4010 --env API_KEY=$API_KEY \
  -- uv --directory /abs/path/to/templates/python run mcp-server
```

## stdio, Alianza One server

```bash
claude mcp add --transport stdio --scope local alianza-one \
  --env ALIANZA_BASE_URL=https://api.b2.alianza.com \
  --env ALIANZA_USERNAME=$ALIANZA_USERNAME --env ALIANZA_PASSWORD=$ALIANZA_PASSWORD \
  -- node /abs/path/to/alianza-one/dist/index.js
```

## stdio, from a published package

```bash
claude mcp add --transport stdio --scope user items --env API_KEY=$API_KEY -- npx -y my-api-mcp
claude mcp add --transport stdio --scope user items --env API_KEY=$API_KEY -- uvx my-api-mcp
```

## Streamable HTTP, shared bearer token

```bash
claude mcp add --transport http --scope user items https://mcp.example.com/mcp \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

## Streamable HTTP, OAuth

```bash
claude mcp add --transport http --scope user items https://mcp.example.com/mcp
claude            # then type /mcp and complete the browser login
```

## Manage

```bash
claude mcp list
claude mcp get items
claude mcp remove items
```
