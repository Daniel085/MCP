"""Connect to a stdio MCP server and expose its tools to the Claude API."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.types import CallToolResult

from .cases import ServerSpec


@dataclass
class ToolResult:
    text: str
    is_error: bool


@dataclass
class ConnectedServer:
    session: ClientSession
    instructions: str | None
    tools: list[dict[str, Any]]

    async def call(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        result = await self.session.call_tool(name, arguments)
        if not isinstance(result, CallToolResult):
            return ToolResult(text=f"Tool {name} returned an unsupported result type", is_error=True)
        parts: list[str] = []
        for block in result.content:
            text = getattr(block, "text", None)
            parts.append(text if isinstance(text, str) else f"[{block.type} content]")
        if not parts and result.structured_content is not None:
            parts.append(json.dumps(result.structured_content))
        return ToolResult(text="\n".join(parts), is_error=bool(result.is_error))


def to_claude_tool(tool: Any) -> dict[str, Any]:
    """Map an MCP tool definition onto a Claude API custom tool definition."""
    schema = (
        tool.input_schema if isinstance(tool.input_schema, dict) else {"type": "object", "properties": {}}
    )
    return {"name": tool.name, "description": tool.description or "", "input_schema": schema}


@asynccontextmanager
async def connect(spec: ServerSpec) -> AsyncIterator[ConnectedServer]:
    params = StdioServerParameters(command=spec.command, args=spec.args, env=spec.env or None, cwd=spec.cwd)
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        init = await session.initialize()
        listed = await session.list_tools()
        yield ConnectedServer(
            session=session,
            instructions=init.instructions,
            tools=[to_claude_tool(t) for t in listed.tools],
        )
