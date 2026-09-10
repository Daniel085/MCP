# Tool-selection evals

Does Claude pick the right tool, with the right arguments, for the prompts your users will type? This harness answers that with a YAML file of prompts and expectations. It connects to your MCP server over stdio, hands its tools to the Claude API, runs each prompt as a real agent loop (tool calls execute against your server), and grades what happened.

It is language-agnostic: it drives any stdio MCP server, so the same harness covers both templates and any server you build from them.

## Why this exists

Unit tests prove the tools work when called. They say nothing about whether the model will call them. The lever for that is the tool descriptions, and until now the only way to check them was to try prompts by hand in Claude Code. This turns that into a repeatable check you run after every description change.

## Run

Needs a Claude API key (`ANTHROPIC_API_KEY`, or `ant auth login`). Each case costs a few API calls.

```bash
# Build the server under test and start its fake API
(cd ../templates/typescript && npm run build && npm run fake-api &)

cd evals
uv sync --extra dev
uv run mcp-evals cases/items.yaml
uv run mcp-evals cases/items.yaml --only "known id" --report out.json
uv run mcp-evals cases/items.yaml --model claude-sonnet-5
```

Output, per case: PASS or FAIL, the tool calls the model made with their arguments, and each failed expectation. Exit code is non-zero if any case failed.

## Case file format

```yaml
server:                       # how to launch the server under test (stdio)
  command: node
  args: [../templates/typescript/dist/index.js]
  env: { API_BASE_URL: "http://127.0.0.1:4010" }
  # cwd: optional
system: optional override of the default system prompt for every case

cases:
  - name: short unique label
    prompt: "what the user would type"
    system: optional per-case override
    expect:
      first_tool: list_items            # name of the first tool called
      args_include: { query: gizmo }    # subset of the first call's arguments; strings compare case-insensitively
      tools: [list_items, get_item]     # exact ordered sequence of every call
      no_tool: true                     # the model must not call any tool
      answer_contains: "Gadget"         # substring of the final reply, case-insensitive
```

`${VAR}` and `${VAR:-default}` expand from the environment anywhere in `server`. The server's `instructions` string is appended to the system prompt, as hosts do.

Every case needs at least one expectation. A refusal from the model fails the case with the refusal reason.

## Writing good cases

- One case per row of your "prompts to try" table. Cover the id-known path, the search path, each write, and one prompt no tool should answer.
- Phrase prompts the way users talk, not the way the tool is named. "Is there an item called Gizmo?" tests the description; "call list_items with query gizmo" tests nothing.
- Prefer `first_tool` and `args_include` over `tools`. Exact sequences are brittle; the model may legitimately search before fetching.
- Use `no_tool` for actions you deliberately did not expose. If the model reaches for a wrong tool instead, the fix is usually in that tool's description ("do not use this to delete").

## Reading failures

| Failure | Usual cause | Fix |
| --- | --- | --- |
| Wrong first tool | Two descriptions overlap, or the preferred tool does not say when to use it | Add "use X when ..., use Y when ..." to both |
| Missing or wrong argument | Input description is vague, or the default is not what users expect | Describe the format with an example; reconsider the default |
| Tool called when `no_tool` expected | A tool sounds like it can do the thing | Say what the tool does not do |
| Extra calls before the expected one | The model is exploring | Fine if results are correct; tighten `tools` only if the extra calls are harmful |
| Refusal | Prompt or tool text tripped a safety classifier | Rephrase; the run already retries on the fallback route |

## How it works

`src/mcp_evals/`:

| File | Role |
| --- | --- |
| `cases.py` | Loads and validates the YAML, expands environment variables. |
| `mcp_client.py` | Spawns the server over stdio, lists tools, converts them to Claude tool definitions, executes calls. |
| `runner.py` | The agent loop: sends the prompt and tools, executes each `tool_use`, feeds results back, stops on `end_turn`. Then grades. |
| `cli.py` | Argument parsing, output, JSON report, exit code. |

The loop uses `client.beta.messages.create` with adaptive thinking and the server-side refusal fallback enabled, so a policy refusal on the primary model is retried automatically. Tool results are sent back with `is_error` set when the server flagged them, exactly as a host would.

## Tests

```bash
uv run pytest
```

The tests use a scripted fake Claude client (no API key, no network) for the loop and grader, and a real stdio connection to a tiny fixture server for the MCP side. CI runs them.
