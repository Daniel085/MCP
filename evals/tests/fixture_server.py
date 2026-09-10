"""Minimal stdio MCP server used by the tests. No upstream API."""

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

mcp = MCPServer("eval-fixture", instructions="Fixture server for evals.")


@mcp.tool(description="Look up a widget by id.", annotations=ToolAnnotations(read_only_hint=True))
def get_widget(id: str) -> dict:
    if id != "w1":
        raise ToolError(f"Not found: widget {id}")
    return {"id": "w1", "name": "Widget One"}


if __name__ == "__main__":
    mcp.run(transport="stdio")
