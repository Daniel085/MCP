"""Case loading and a real stdio connection to the fixture server."""

import sys
from pathlib import Path

import pytest

from mcp_evals.cases import ServerSpec, load_qa_cases, load_suite
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


def test_reset_block_and_qa_file(tmp_path):
    f = tmp_path / "cases.yaml"
    f.write_text(
        "server: {command: x}\nreset: {url: 'http://127.0.0.1:${PORT:-4010}/__reset'}\n"
        "cases:\n  - {name: a, prompt: p, expect: {answer_exact: '3'}}\n"
    )
    suite = load_suite(f, env={})
    assert suite.reset is not None
    assert suite.reset.url == "http://127.0.0.1:4010/__reset" and suite.reset.method == "POST"
    assert suite.cases[0].expect.answer_exact == "3"

    qa = tmp_path / "qa.xml"
    qa.write_text(
        "<evaluation>\n  <qa_pair><question>How many?</question><answer>3</answer></qa_pair>\n"
        "  <qa_pair><question>Which one?</question><answer>Gamma Logistics</answer></qa_pair>\n</evaluation>\n"
    )
    cases = load_qa_cases(qa)
    assert [c.prompt for c in cases] == ["How many?", "Which one?"]
    assert cases[1].expect.answer_exact == "Gamma Logistics"
    assert cases[0].name.startswith("qa1: ")

    bad = tmp_path / "bad.xml"
    bad.write_text("<evaluation><qa_pair><question>x</question></qa_pair></evaluation>")
    with pytest.raises(ValueError, match="non-empty"):
        load_qa_cases(bad)


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
