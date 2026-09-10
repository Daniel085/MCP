# Client configuration examples

These files show how each Claude surface connects to a server built from this toolkit. Replace names, paths, URLs, and environment variable names for your server. None of these files should ever contain a real secret; reference environment variables instead.

| File | Surface | Transport |
| --- | --- | --- |
| `claude-code/mcp.json.example` | Claude Code, project scope (`.mcp.json` committed to the repo) | stdio and HTTP |
| `claude-code/commands.md` | Claude Code, `claude mcp add` one-liners for local, project, and user scope | stdio and HTTP |
| `claude-desktop/claude_desktop_config.example.json` | Claude Desktop | stdio |
| `claude-api/connector.py`, `claude-api/connector.ts` | Claude API Messages requests using the MCP connector | HTTP (remote) |
| `docker-compose.yml` | Local stack: server plus fake API | HTTP |
