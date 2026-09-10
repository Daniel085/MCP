import httpx
import pytest

from mcp_server.api_client import ApiClient
from mcp_server.fake_api import create_fake_api
from mcp_server.server import create_server


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def make_server():
    """Builds an MCPServer whose API client talks to the in-process fake API over ASGI."""

    clients: list[ApiClient] = []

    def _make(api_key: str = ""):
        api = ApiClient(
            "http://fake-api",
            api_key=api_key,
            timeout_ms=5_000,
            transport=httpx.ASGITransport(app=create_fake_api()),
        )
        clients.append(api)
        return create_server(api)

    yield _make
