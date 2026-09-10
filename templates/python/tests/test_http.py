"""Runs the Streamable HTTP app under uvicorn on an ephemeral port and drives it with the SDK client."""

import socket
import threading

import httpx
import pytest
import uvicorn
from mcp.client.session import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from mcp_server.api_client import ApiClient
from mcp_server.config import load_config
from mcp_server.fake_api import create_fake_api
from mcp_server.http import create_http_app

pytestmark = pytest.mark.anyio
TOKEN = "test-token"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def http_server():
    port = _free_port()
    config = load_config(
        {
            "MCP_TRANSPORT": "http",
            "MCP_HTTP_PORT": str(port),
            "MCP_AUTH_TOKEN": TOKEN,
            "API_BASE_URL": "http://fake",
        }
    )
    api = ApiClient.from_config(config, transport=httpx.ASGITransport(app=create_fake_api()))
    server = uvicorn.Server(
        uvicorn.Config(create_http_app(config, api), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    import time

    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started, "uvicorn did not start"
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def test_health_without_auth(http_server):
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{http_server}/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


async def test_rejects_missing_bearer(http_server):
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{http_server}/mcp", json={})
    assert res.status_code == 401


async def test_full_session_with_bearer(http_server):
    http_client = create_mcp_http_client(headers={"Authorization": f"Bearer {TOKEN}"})
    async with (
        streamable_http_client(f"{http_server}/mcp", http_client=http_client) as (read, write, *_),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        tools = await session.list_tools()
        assert "get_item" in [t.name for t in tools.tools]
        result = await session.call_tool("get_item", {"id": "itm_2"})
        assert not result.is_error
        assert result.structured_content["name"] == "Gadget"

        missing = await session.call_tool("get_item", {"id": "itm_404"})
        assert missing.is_error
        text = "\n".join(getattr(b, "text", "") for b in missing.content)
        assert "not found" in text.lower() and "itm_404" in text
