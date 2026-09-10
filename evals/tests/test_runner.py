"""Runner and grader tests with a scripted fake Claude client."""

from types import SimpleNamespace

import pytest

from mcp_evals.cases import Case, Expect
from mcp_evals.runner import grade, run_case

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool_results(messages):
    """All tool_result blocks in a message list, keyed by tool_use_id."""
    out = {}
    for m in messages:
        if m["role"] == "user" and isinstance(m["content"], list):
            for block in m["content"]:
                if block.get("type") == "tool_result":
                    out[block["tool_use_id"]] = block
    return out


def tool_use(name, inp, id="tu_1"):
    return SimpleNamespace(type="tool_use", name=name, input=inp, id=id)


def response(content, stop_reason):
    return SimpleNamespace(content=content, stop_reason=stop_reason, stop_details=None)


class ScriptedClient:
    """Returns responses in order and records the requests it received."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, **kwargs):
        self.requests.append(kwargs)
        return self.responses.pop(0)


async def execute_ok(name, args):
    return f"{name} result for {args}", False


TOOLS = [{"name": "get_widget", "description": "d", "input_schema": {"type": "object", "properties": {}}}]


async def test_tool_call_then_answer_passes():
    client = ScriptedClient(
        [
            response([tool_use("get_widget", {"id": "w1"})], "tool_use"),
            response([text("Widget One is here.")], "end_turn"),
        ]
    )
    case = Case(
        "c",
        "show w1",
        Expect(first_tool="get_widget", args_include={"id": "W1"}, answer_contains="widget one"),
    )
    r = await run_case(case, create=client, tools=TOOLS, execute=execute_ok, model="m", system="s")
    assert r.passed, r.failures
    assert [c.name for c in r.calls] == ["get_widget"]
    assert r.turns == 2
    # The tool result went back to the model with the matching tool_use_id.
    results = tool_results(client.requests[1]["messages"])
    assert set(results) == {"tu_1"}
    assert results["tu_1"]["is_error"] is False
    assert client.requests[0]["fallbacks"] == "default"
    assert client.requests[0]["thinking"] == {"type": "adaptive"}


async def test_wrong_tool_fails_with_reason():
    client = ScriptedClient(
        [
            response([tool_use("other_tool", {})], "tool_use"),
            response([text("done")], "end_turn"),
        ]
    )
    case = Case("c", "p", Expect(first_tool="get_widget"))
    r = await run_case(case, create=client, tools=TOOLS, execute=execute_ok, model="m", system="s")
    assert not r.passed
    assert r.failures == ["expected first tool get_widget, got other_tool"]


async def test_no_tool_expectation():
    client = ScriptedClient([response([text("I cannot delete widgets.")], "end_turn")])
    case = Case("c", "delete w1", Expect(no_tool=True, answer_contains="cannot"))
    r = await run_case(case, create=client, tools=TOOLS, execute=execute_ok, model="m", system="s")
    assert r.passed, r.failures


async def test_sequence_and_error_result_propagates():
    async def execute(name, args):
        return ("Not found", True) if args.get("id") == "w9" else ("ok", False)

    client = ScriptedClient(
        [
            response([tool_use("get_widget", {"id": "w9"}, "a")], "tool_use"),
            response([tool_use("get_widget", {"id": "w1"}, "b")], "tool_use"),
            response([text("Found w1.")], "end_turn"),
        ]
    )
    case = Case("c", "p", Expect(tools=["get_widget", "get_widget"]))
    r = await run_case(case, create=client, tools=TOOLS, execute=execute, model="m", system="s")
    assert r.passed, r.failures
    assert r.calls[0].is_error and not r.calls[1].is_error
    results = tool_results(client.requests[2]["messages"])
    assert results["a"]["is_error"] is True
    assert results["b"]["is_error"] is False


async def test_refusal_is_a_failure():
    refused = SimpleNamespace(
        content=[], stop_reason="refusal", stop_details=SimpleNamespace(explanation="policy")
    )
    client = ScriptedClient([refused])
    case = Case("c", "p", Expect(first_tool="get_widget"))
    r = await run_case(case, create=client, tools=TOOLS, execute=execute_ok, model="m", system="s")
    assert r.failures == ["model refused: policy"]


async def test_turn_limit():
    client = ScriptedClient([response([tool_use("get_widget", {})], "tool_use")] * 3)
    case = Case("c", "p", Expect(first_tool="get_widget"))
    r = await run_case(
        case, create=client, tools=TOOLS, execute=execute_ok, model="m", system="s", max_turns=3
    )
    assert "did not finish within 3 turns" in r.failures


def test_grade_arg_subset_is_case_insensitive_for_strings():
    from mcp_evals.runner import CaseResult, ToolCall

    r = CaseResult(case=Case("c", "p", Expect()))
    r.calls.append(ToolCall("t", {"query": "Gizmo", "limit": 10}))
    assert grade(Expect(args_include={"query": "gizmo"}), r) == []
    assert grade(Expect(args_include={"limit": 5}), r) == ["argument 'limit': expected 5, got 10"]
    assert grade(Expect(args_include={"missing": 1}), r)[0].startswith(
        "first call missing argument 'missing'"
    )
