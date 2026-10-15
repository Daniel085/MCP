"""Command-line entry point."""

from __future__ import annotations

import argparse
import functools
import json
import sys
import urllib.request
from dataclasses import asdict
from pathlib import Path

import anthropic
import anyio

from .cases import Case, ResetSpec, Suite, load_qa_cases, load_suite
from .mcp_client import connect
from .runner import DEFAULT_SYSTEM, QA_SYSTEM, CaseResult, run_case


def build_system(suite_system: str | None, instructions: str | None) -> str:
    parts = [suite_system or DEFAULT_SYSTEM]
    if instructions:
        parts.append(f"Server instructions:\n{instructions}")
    return "\n\n".join(parts)


def reset_server(spec: ResetSpec) -> None:
    req = urllib.request.Request(spec.url, method=spec.method)
    with urllib.request.urlopen(req, timeout=10) as res:
        if res.status >= 300:
            raise SystemExit(f"reset request to {spec.url} returned HTTP {res.status}")


async def run_suite(
    suite: Suite,
    *,
    model: str,
    max_turns: int,
    only: str | None,
    cases: list[Case] | None = None,
    default_system: str = DEFAULT_SYSTEM,
) -> list[CaseResult]:
    client = anthropic.Anthropic()
    results: list[CaseResult] = []
    async with connect(suite.server) as server:
        if not server.tools:
            raise SystemExit("server exposes no tools")
        system = build_system(suite.system or default_system, server.instructions)

        async def execute(name: str, arguments: dict) -> tuple[str, bool]:
            r = await server.call(name, arguments)
            return r.text, r.is_error

        for case in cases if cases is not None else suite.cases:
            if only and only not in case.name:
                continue
            if suite.reset:
                reset_server(suite.reset)
            result = await run_case(
                case,
                create=client.beta.messages.create,
                tools=server.tools,
                execute=execute,
                model=model,
                system=build_system(case.system, server.instructions) if case.system else system,
                max_turns=max_turns,
            )
            results.append(result)
            print(format_line(result), flush=True)
    return results


def format_line(r: CaseResult) -> str:
    status = "PASS" if r.passed else "FAIL"
    calls = (
        " -> ".join(f"{c.name}({json.dumps(c.arguments, sort_keys=True)})" for c in r.calls) or "(no tool)"
    )
    line = f"[{status}] {r.case.name}\n        calls: {calls}"
    for f in r.failures:
        line += f"\n        ! {f}"
    return line


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check which MCP tools Claude picks for each prompt.")
    parser.add_argument(
        "cases", type=Path, help="YAML suite file (server launch settings and tool-selection cases)"
    )
    parser.add_argument(
        "--qa",
        type=Path,
        help="Run the question/answer pairs in this <evaluation> XML file instead of the YAML cases, using the YAML's server block",
    )
    parser.add_argument("--model", default="claude-opus-5")
    parser.add_argument("--max-turns", type=int, default=12)
    parser.add_argument("--only", help="Run only cases whose name contains this text")
    parser.add_argument("--report", type=Path, help="Write a JSON report here")
    args = parser.parse_args(argv)

    suite = load_suite(args.cases)
    qa_cases = load_qa_cases(args.qa) if args.qa else None
    auth_failed = False
    connection_error: str | None = None
    results: list[CaseResult] = []
    try:
        results = anyio.run(
            functools.partial(
                run_suite,
                suite,
                model=args.model,
                max_turns=args.max_turns,
                only=args.only,
                cases=qa_cases,
                default_system=QA_SYSTEM if qa_cases else DEFAULT_SYSTEM,
            )
        )
    except* anthropic.AuthenticationError:
        # anyio task groups wrap exceptions in an ExceptionGroup, hence except*.
        auth_failed = True
    except* anthropic.APIConnectionError as group:
        connection_error = str(group.exceptions[0])
    if auth_failed:
        print(
            "Claude API authentication failed. Set ANTHROPIC_API_KEY or run `ant auth login`.",
            file=sys.stderr,
        )
        return 2
    if connection_error:
        print(f"Could not reach the Claude API: {connection_error}", file=sys.stderr)
        return 2

    passed = sum(1 for r in results if r.passed)
    print(f"\n{passed}/{len(results)} cases passed (model {args.model})")

    if args.report:
        payload = [
            {
                "name": r.case.name,
                "prompt": r.case.prompt,
                "passed": r.passed,
                "failures": r.failures,
                "calls": [asdict(c) for c in r.calls],
                "final_text": r.final_text,
                "stop_reason": r.stop_reason,
                "turns": r.turns,
            }
            for r in results
        ]
        args.report.write_text(json.dumps({"model": args.model, "results": payload}, indent=2))
        print(f"report written to {args.report}")

    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
