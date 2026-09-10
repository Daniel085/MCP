"""Case loading and a real stdio connection to the fixture server."""

import sys
from pathlib import Path

import pytest

from mcp_evals.cases import ServerSpec, load_suite
from mcp_evals.mcp_client import connect

pytestmark = pytest.mark.anyio
HERE = Path(__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_load_suite_expands_env_and_validates(tmp_path):
    f = tmp_path / "cases.yaml"
    f.write_text(
        """
server:
  command: ${CMD:-node}
  args: ["${ARG}"]
  env: {API_BASE_URL: "${BASE:-http://x}"}
cases:
  - name: a
    prompt: p
    expect: {first_tool: t, args_include: {q: 1}}
"""
    )
    suite = load_suite(f, env={"ARG": "server.js"})
    assert suite.server.command == "node"
    assert suite.server.args == ["server.js"]
    assert suite.server.env == {"API_BASE_URL": "http://x"}
    assert suite.cases[0].expect.first_tool == "t"


def test_case_without_expectations_is_rejected(tmp_path):
    f = tmp_path / "cases.yaml"
    f.write_text("server: {command: x}\ncases:\n  - {name: a, prompt: p}\n")
    with pytest.raises(ValueError, match="no expectations"):
        load_suite(f, env={})


async def test_connects_to_stdio_server_and_maps_tools():
    spec = ServerSpec(command=sys.executable, args=[str(HERE / "fixture_server.py")], env={}, cwd=None)
    async with connect(spec) as server:
        assert server.instructions == "Fixture server for evals."
        assert [t["name"] for t in server.tools] == ["get_widget"]
        tool = server.tools[0]
        assert tool["description"] == "Look up a widget by id."
        assert tool["input_schema"]["properties"]["id"]["type"] == "string"

        ok = await server.call("get_widget", {"id": "w1"})
        assert not ok.is_error and "Widget One" in ok.text

        missing = await server.call("get_widget", {"id": "w2"})
        assert missing.is_error and "Not found" in missing.text
