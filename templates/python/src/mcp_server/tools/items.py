"""Example tools wrapping the fictional Items API.

Replace this module with tools designed per docs/02-design-tools-from-an-api.md.
Keep the pattern: typed inputs, trimmed outputs, anticipated failures raised as
ToolError, honest annotations.
"""

from __future__ import annotations

import logging
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

from ..api_client import ApiClient, ApiError, Item

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


class ItemView(BaseModel):
    """Trimmed view of an item: only what the model needs."""

    id: str
    name: str
    description: str
    created_at: str

    @classmethod
    def from_item(cls, item: Item) -> ItemView:
        return cls(id=item.id, name=item.name, description=item.description, created_at=item.created_at)


class ItemPageView(BaseModel):
    items: list[ItemView]
    total: int
    offset: int
    limit: int


def register_item_tools(mcp: MCPServer, api: ApiClient) -> None:
    @mcp.tool(
        title="List items",
        description=(
            "List or search items. Use this when the user does not give an exact item id; "
            "use get_item when they do. Returns up to `limit` items (id, name, description, created_at) "
            "and the total count. Pass `offset` to page through more results."
        ),
        annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True),
    )
    async def list_items(
        query: Annotated[
            str | None, Field(description="Free-text filter on name and description.", max_length=200)
        ] = None,
        limit: Annotated[int, Field(description="Maximum items to return.", ge=1, le=100)] = 10,
        offset: Annotated[int, Field(description="Number of items to skip for paging.", ge=0)] = 0,
    ) -> ItemPageView:
        try:
            page = await api.list_items(query, limit, offset)
        except ApiError as err:
            raise api_error_to_tool_error("list_items", err) from err
        return ItemPageView(
            items=[ItemView.from_item(i) for i in page.items], total=page.total, offset=offset, limit=limit
        )

    @mcp.tool(
        title="Get item",
        description="Fetch one item by its id (for example itm_1). Use list_items first if you only have a name.",
        annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True),
    )
    async def get_item(
        id: Annotated[str, Field(description="Item id, e.g. itm_1", min_length=1)],
    ) -> ItemView:
        try:
            return ItemView.from_item(await api.get_item(id))
        except ApiError as err:
            raise api_error_to_tool_error("get_item", err) from err

    @mcp.tool(
        title="Create item",
        description=(
            "Create a new item. Confirm the name with the user before calling. "
            "Returns the created item including its new id."
        ),
        annotations=ToolAnnotations(
            read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=True
        ),
    )
    async def create_item(
        name: Annotated[str, Field(description="Display name for the item.", min_length=1, max_length=120)],
        description: Annotated[
            str | None, Field(description="Optional longer description.", max_length=2000)
        ] = None,
    ) -> ItemView:
        try:
            item = await api.create_item(name, description)
        except ApiError as err:
            raise api_error_to_tool_error("create_item", err) from err
        log.info("item created", extra={"fields": {"id": item.id}})
        return ItemView.from_item(item)
