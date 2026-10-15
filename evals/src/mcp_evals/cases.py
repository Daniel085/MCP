"""Case file loading and expectation model."""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class ServerSpec:
    command: str
    args: list[str]
    env: dict[str, str]
    cwd: str | None


@dataclass(frozen=True)
class ResetSpec:
    """An HTTP request made before every case so cases are independent."""

    url: str
    method: str = "POST"


@dataclass(frozen=True)
class Expect:
    first_tool: str | None = None
    args_include: dict[str, Any] | None = None
    tools: list[str] | None = None
    no_tool: bool = False
    answer_contains: str | None = None
    answer_exact: str | None = None

    def is_empty(self) -> bool:
        return not any(
            [
                self.first_tool,
                self.args_include,
                self.tools,
                self.no_tool,
                self.answer_contains,
                self.answer_exact,
            ]
        )


@dataclass(frozen=True)
class Case:
    name: str
    prompt: str
    expect: Expect
    system: str | None = None


@dataclass(frozen=True)
class Suite:
    server: ServerSpec
    system: str | None
    cases: list[Case] = field(default_factory=list)
    reset: ResetSpec | None = None


def _expand(value: str, env: dict[str, str]) -> str:
    """Expand ${VAR} and ${VAR:-default} using the given environment."""
    out = value
    while "${" in out:
        start = out.index("${")
        end = out.index("}", start)
        expr = out[start + 2 : end]
        name, _, default = expr.partition(":-")
        out = out[:start] + env.get(name, default) + out[end + 1 :]
    return out


def load_suite(path: Path, env: dict[str, str] | None = None) -> Suite:
    env = dict(os.environ if env is None else env)
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict) or "server" not in raw or "cases" not in raw:
        raise ValueError(f"{path}: expected top-level 'server' and 'cases' keys")

    srv = raw["server"]
    server = ServerSpec(
        command=_expand(str(srv["command"]), env),
        args=[_expand(str(a), env) for a in srv.get("args", [])],
        env={k: _expand(str(v), env) for k, v in (srv.get("env") or {}).items()},
        cwd=_expand(str(srv["cwd"]), env) if srv.get("cwd") else None,
    )

    reset: ResetSpec | None = None
    if raw.get("reset"):
        r = raw["reset"]
        reset = ResetSpec(url=_expand(str(r["url"]), env), method=str(r.get("method", "POST")).upper())

    cases: list[Case] = []
    for i, c in enumerate(raw["cases"]):
        if "name" not in c or "prompt" not in c:
            raise ValueError(f"{path}: case {i} needs 'name' and 'prompt'")
        e = c.get("expect") or {}
        expect = Expect(
            first_tool=e.get("first_tool"),
            args_include=e.get("args_include"),
            tools=list(e["tools"]) if e.get("tools") is not None else None,
            no_tool=bool(e.get("no_tool", False)),
            answer_contains=e.get("answer_contains"),
            answer_exact=e.get("answer_exact"),
        )
        if expect.is_empty():
            raise ValueError(f"{path}: case '{c['name']}' has no expectations")
        cases.append(
            Case(name=str(c["name"]), prompt=str(c["prompt"]), expect=expect, system=c.get("system"))
        )

    return Suite(server=server, system=raw.get("system"), cases=cases, reset=reset)


def load_qa_cases(path: Path) -> list[Case]:
    """Load question/answer pairs from the `<evaluation><qa_pair>` XML format.

    Each pair becomes a Case graded on an exact (normalised) final answer.
    """
    root = ET.parse(path).getroot()
    if root.tag != "evaluation":
        raise ValueError(f"{path}: root element must be <evaluation>, got <{root.tag}>")
    cases: list[Case] = []
    for i, pair in enumerate(root.findall("qa_pair"), start=1):
        question = (pair.findtext("question") or "").strip()
        answer = (pair.findtext("answer") or "").strip()
        if not question or not answer:
            raise ValueError(f"{path}: qa_pair {i} needs non-empty <question> and <answer>")
        cases.append(
            Case(name=f"qa{i}: {question[:60]}", prompt=question, expect=Expect(answer_exact=answer))
        )
    if not cases:
        raise ValueError(f"{path}: no <qa_pair> elements")
    return cases
