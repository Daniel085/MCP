"""Wire-level smoke test.

Spawns the server over stdio against the fake API, then runs initialize,
tools/list, and one tools/call.

Usage: uv run fake-api &  then  uv run smoke
"""

from __future__ import annotations

import os
import sys

import anyio
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


async def run() -> None:
    env = {
        **os.environ,
        "API_BASE_URL": os.environ.get("API_BASE_URL", "http://127.0.0.1:4010"),
        "MCP_TRANSPORT": "stdio",
        "LOG_LEVEL": "WARNING",
    }
    params = StdioServerParameters(command=sys.executable, args=["-m", "mcp_server"], env=env)
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        init = await session.initialize()
        print(f"connected to {init.server_info.name} {init.server_info.version}")

        tools = await session.list_tools()
        names = [t.name for t in tools.tools]
        print("tools:", ", ".join(names))
        if not names:
            raise SystemExit("no tools registered")

        result = await session.call_tool("list_items", {"limit": 2})
        if result.is_error:
            raise SystemExit(f"list_items returned error: {result.content}")
        print("list_items ok:", result.structured_content)

        missing = await session.call_tool("get_item", {"id": "itm_404"})
        if not missing.is_error:
            raise SystemExit("expected get_item on a missing id to return is_error")
        print("get_item error path ok")

        print("SMOKE PASSED")


def main() -> None:
    anyio.run(run)


if __name__ == "__main__":
    main()
