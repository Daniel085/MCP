import pytest
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import CallToolResult

pytestmark = pytest.mark.anyio


async def test_lists_exactly_the_designed_tools(make_server):
    mcp = make_server()
    tools = await mcp.list_tools()
    assert sorted(t.name for t in tools) == ["create_item", "get_item", "list_items"]
    for tool in tools:
        assert tool.description, f"{tool.name} needs a description"
        assert tool.annotations is not None, f"{tool.name} needs annotations"
        assert tool.input_schema["type"] == "object"
    by_name = {t.name: t for t in tools}
    assert by_name["get_item"].annotations.read_only_hint is True
    assert by_name["create_item"].annotations.read_only_hint is False
    assert by_name["create_item"].annotations.destructive_hint is False


async def test_list_items_returns_trimmed_page(make_server):
    mcp = make_server()
    result = await mcp.call_tool("list_items", {"limit": 2})
    assert isinstance(result, CallToolResult)
    assert not result.is_error
    assert result.structured_content["total"] == 3
    assert len(result.structured_content["items"]) == 2
    assert set(result.structured_content["items"][0]) == {"id", "name", "description", "created_at"}


async def test_list_items_filters_by_query(make_server):
    mcp = make_server()
    result = await mcp.call_tool("list_items", {"query": "gizmo"})
    assert [i["id"] for i in result.structured_content["items"]] == ["itm_3"]


async def test_get_item_returns_item(make_server):
    mcp = make_server()
    result = await mcp.call_tool("get_item", {"id": "itm_1"})
    assert not result.is_error
    assert result.structured_content["name"] == "Widget"


async def test_get_item_maps_404_to_tool_error(make_server):
    # Direct calls raise ToolError; over a transport the client sees is_error=True
    # with the same message (covered in test_http.py).
    mcp = make_server()
    with pytest.raises(ToolError, match=r"(?i)not found.*itm_404"):
        await mcp.call_tool("get_item", {"id": "itm_404"})


async def test_create_item_then_get(make_server):
    mcp = make_server()
    created = await mcp.call_tool("create_item", {"name": "Thing", "description": "made in test"})
    assert not created.is_error
    assert created.structured_content["id"] == "itm_4"
    fetched = await mcp.call_tool("get_item", {"id": "itm_4"})
    assert fetched.structured_content["name"] == "Thing"


async def test_invalid_arguments_rejected_before_tool_runs(make_server):
    mcp = make_server()
    with pytest.raises(ToolError):
        await mcp.call_tool("list_items", {"limit": 0})


async def test_upstream_401_maps_to_auth_error(make_server):
    mcp = make_server(api_key="bad-key")
    with pytest.raises(ToolError) as excinfo:
        await mcp.call_tool("list_items", {})
    assert "authentication" in str(excinfo.value).lower()
    assert "bad-key" not in str(excinfo.value)
