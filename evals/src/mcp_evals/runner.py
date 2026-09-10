"""Run one case: drive Claude with the server's tools, record calls, grade."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .cases import Case, Expect

DEFAULT_SYSTEM = (
    "You are an assistant connected to an MCP server. Use its tools to answer the user's request. "
    "If no tool fits the request, say so plainly instead of guessing or calling an unrelated tool. "
    "Before taking an action that changes data, state what you are about to do."
)

BETAS = ["server-side-fallback-2026-07-01"]


class CreateFn(Protocol):
    def __call__(self, **kwargs: Any) -> Any: ...


ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[tuple[str, bool]]]


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]
    result_text: str = ""
    is_error: bool = False


@dataclass
class CaseResult:
    case: Case
    calls: list[ToolCall] = field(default_factory=list)
    final_text: str = ""
    stop_reason: str = ""
    refusal: str | None = None
    failures: list[str] = field(default_factory=list)
    turns: int = 0

    @property
    def passed(self) -> bool:
        return not self.failures


async def run_case(
    case: Case,
    *,
    create: CreateFn,
    tools: list[dict[str, Any]],
    execute: ToolExecutor,
    model: str,
    system: str,
    max_turns: int = 6,
    max_tokens: int = 4096,
) -> CaseResult:
    result = CaseResult(case=case)
    messages: list[dict[str, Any]] = [{"role": "user", "content": case.prompt}]

    while result.turns < max_turns:
        result.turns += 1
        response = create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            tools=tools,
            messages=messages,
            betas=BETAS,
            fallbacks="default",
            thinking={"type": "adaptive"},
        )
        result.stop_reason = response.stop_reason or ""

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            result.refusal = getattr(details, "explanation", None) or "refused"
            break

        text_parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
        tool_uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        if text_parts:
            result.final_text = "\n".join(text_parts)

        if response.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": response.content})
            continue

        if not tool_uses or response.stop_reason != "tool_use":
            break

        messages.append({"role": "assistant", "content": response.content})
        tool_results: list[dict[str, Any]] = []
        for use in tool_uses:
            call = ToolCall(name=use.name, arguments=dict(use.input))
            text, is_error = await execute(use.name, call.arguments)
            call.result_text, call.is_error = text, is_error
            result.calls.append(call)
            tool_results.append(
                {"type": "tool_result", "tool_use_id": use.id, "content": text, "is_error": is_error}
            )
        messages.append({"role": "user", "content": tool_results})
    else:
        result.failures.append(f"did not finish within {max_turns} turns")

    result.failures.extend(grade(case.expect, result))
    return result


def _matches(expected: Any, actual: Any) -> bool:
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.lower() == actual.lower()
    if isinstance(expected, dict) and isinstance(actual, dict):
        return all(k in actual and _matches(v, actual[k]) for k, v in expected.items())
    if isinstance(expected, list) and isinstance(actual, list):
        return len(expected) == len(actual) and all(_matches(e, a) for e, a in zip(expected, actual))
    return expected == actual


def grade(expect: Expect, result: CaseResult) -> list[str]:
    failures: list[str] = []
    names = [c.name for c in result.calls]

    if result.refusal:
        failures.append(f"model refused: {result.refusal}")
        return failures

    if expect.no_tool and names:
        failures.append(f"expected no tool call, got {names}")

    if expect.first_tool:
        if not names:
            failures.append(f"expected first tool {expect.first_tool}, but no tool was called")
        elif names[0] != expect.first_tool:
            failures.append(f"expected first tool {expect.first_tool}, got {names[0]}")

    if expect.args_include:
        if not result.calls:
            failures.append("expected arguments on first call, but no tool was called")
        else:
            actual = result.calls[0].arguments
            for key, value in expect.args_include.items():
                if key not in actual:
                    failures.append(f"first call missing argument {key!r} (got {actual})")
                elif not _matches(value, actual[key]):
                    failures.append(f"argument {key!r}: expected {value!r}, got {actual[key]!r}")

    if expect.tools is not None and names != expect.tools:
        failures.append(f"expected tool sequence {expect.tools}, got {names}")

    if expect.answer_contains and expect.answer_contains.lower() not in result.final_text.lower():
        failures.append(f"final answer does not contain {expect.answer_contains!r}")

    return failures
