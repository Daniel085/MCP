"""Shared error handling for tools.

Upstream failures become ToolError, which the SDK turns into an is_error
result with text the model can act on. Any other exception is treated as a
crash and the model only sees a generic message.
"""

from __future__ import annotations

import logging

from mcp.server.mcpserver.exceptions import ToolError

from ..api_client import ApiError

log = logging.getLogger(__name__)


def api_error_to_text(err: ApiError) -> str:
    """Convert an upstream failure into text the model can act on."""
    if err.status == 0:
        return f"The upstream API could not be reached ({err.message}). Try again shortly."
    if err.status in (401, 403):
        return "Authentication with the upstream API failed. Check the API credentials configured for this server."
    if err.status == 404:
        return f"Not found: {err.message}"
    if err.status in (400, 422):
        return f"The API rejected the request: {err.message}"
    if err.status == 429:
        return f"Rate limited by the upstream API. Retry after {err.retry_after_seconds or 30} seconds."
    if err.status >= 500:
        return f"The upstream API is unavailable (HTTP {err.status}). Try again shortly."
    return f"Upstream API error (HTTP {err.status}): {err.message}"


def api_error_to_tool_error(tool: str, err: ApiError) -> ToolError:
    """ToolError reaches the model as an is_error result; other exceptions do not."""
    log.warning(
        "tool returned error", extra={"fields": {"tool": tool, "status": err.status, "message": err.message}}
    )
    return ToolError(api_error_to_text(err))
