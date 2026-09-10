"""Streamable HTTP transport, stateless mode.

`MCPServer.streamable_http_app()` returns a Starlette app whose lifespan runs
the SDK's session manager. We wrap it in a small ASGI middleware that enforces
a bearer token on the MCP path and add a /healthz route.

Stateful variant (needed for server-initiated notifications): pass
`stateless_http=False`; the SDK then issues an Mcp-Session-Id header and keeps
per-session state in memory, so route each session to one replica.
"""

from __future__ import annotations

import hmac
import logging
from typing import Any

from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from . import SERVER_NAME, SERVER_VERSION
from .api_client import ApiClient
from .config import Config
from .server import create_server

log = logging.getLogger(__name__)


class BearerAuthMiddleware:
    def __init__(self, app: ASGIApp, token: str, protected_path: str) -> None:
        self.app = app
        self.token = token.encode()
        self.protected_path = protected_path.rstrip("/")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].rstrip("/").startswith(self.protected_path):
            await self.app(scope, receive, send)
            return
        header = dict(scope.get("headers", [])).get(b"authorization", b"")
        presented = header[7:] if header.startswith(b"Bearer ") else b""
        if not hmac.compare_digest(presented, self.token):
            response = JSONResponse(
                {"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": 'Bearer realm="mcp"'}
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def create_http_app(config: Config, api: ApiClient) -> ASGIApp:
    mcp = create_server(api)

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "name": SERVER_NAME, "version": SERVER_VERSION})

    security: TransportSecuritySettings | None = None
    loopback = config.http_host in ("127.0.0.1", "localhost", "::1")
    if config.allowed_hosts:
        security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True, allowed_hosts=config.allowed_hosts
        )
    elif not loopback:
        log.warning(
            "binding to %s without MCP_ALLOWED_HOSTS; DNS rebinding protection is off", config.http_host
        )
        security = TransportSecuritySettings(enable_dns_rebinding_protection=False)

    app: Any = mcp.streamable_http_app(
        streamable_http_path=config.http_path,
        stateless_http=True,
        json_response=False,
        transport_security=security,
        host=config.http_host,
    )

    if config.auth_token:
        app = BearerAuthMiddleware(app, config.auth_token, config.http_path)
    else:
        log.warning("MCP_AUTH_TOKEN is not set; the MCP endpoint is unauthenticated")
    return app


__all__ = ["BearerAuthMiddleware", "Starlette", "create_http_app"]
