"""Builds a fully registered MCPServer."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import SERVER_NAME, SERVER_VERSION
from .api_client import ApiClient
from .tools.items import register_item_tools


def create_server(api: ApiClient) -> MCPServer:
    mcp = MCPServer(
        SERVER_NAME,
        version=SERVER_VERSION,
        instructions=(
            "Tools for working with items in the Items API. "
            "Prefer list_items for discovery and get_item when an id is known."
        ),
    )
    register_item_tools(mcp, api)
    return mcp
