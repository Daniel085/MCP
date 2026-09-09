"""All configuration comes from environment variables."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class Config:
    api_base_url: str = "http://127.0.0.1:4010"
    api_key: str = ""
    api_timeout_ms: int = 15_000
    transport: Literal["stdio", "http"] = "stdio"
    http_host: str = "127.0.0.1"
    http_port: int = 8000
    http_path: str = "/mcp"
    auth_token: str = ""
    allowed_hosts: list[str] = field(default_factory=list)
    log_level: str = "INFO"


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "")
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def load_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    transport = env.get("MCP_TRANSPORT", "stdio")
    if transport not in ("stdio", "http"):
        raise ValueError(f'MCP_TRANSPORT must be "stdio" or "http", got {transport!r}')
    log_level = env.get("LOG_LEVEL", "INFO").upper()
    if log_level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
        raise ValueError(f"LOG_LEVEL must be DEBUG|INFO|WARNING|ERROR, got {log_level!r}")
    return Config(
        api_base_url=env.get("API_BASE_URL", "http://127.0.0.1:4010").rstrip("/"),
        api_key=env.get("API_KEY", ""),
        api_timeout_ms=_int(env, "API_TIMEOUT_MS", 15_000),
        transport=transport,  # type: ignore[arg-type]
        http_host=env.get("MCP_HTTP_HOST", "127.0.0.1"),
        http_port=_int(env, "MCP_HTTP_PORT", 8000),
        http_path=env.get("MCP_HTTP_PATH", "/mcp"),
        auth_token=env.get("MCP_AUTH_TOKEN", ""),
        allowed_hosts=[h.strip() for h in env.get("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()],
        log_level=log_level,
    )
