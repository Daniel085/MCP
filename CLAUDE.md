# Working in this repository

This repo is a generic toolkit for building and deploying MCP servers. It is not itself a product server. Keep the templates generic and runnable; concrete servers for real APIs live on their own branches or repos.

## Layout

- `docs/` holds the guides, numbered 00 to 09. Keep them in step with the templates: if you change an SDK call in a template, update the doc that shows it. `docs/08-worked-example.md` embeds code that was compiled and tested; if you change the template's structure, re-verify that example rather than editing its code blocks by hand.
- `templates/typescript/` and `templates/python/` are complete, runnable servers. Each has a fake upstream API, tests, and a Dockerfile. They must stay in sync feature-for-feature.
- `deploy/` holds client-side configuration examples only. No secrets, ever.
- `evals/` is the tool-selection harness. It is language-agnostic (drives any stdio server). Its unit tests run without an API key; `cases/*.yaml` need one. When you change a tool description in a template, run the matching cases file.

## Conventions

- Tools are the unit of design. Every tool needs a title, a description written for a model, a typed input schema, tool annotations, and an error path that returns `isError` rather than throwing. Error mapping lives in `tools/errors.*`, shared by every tool.
- Never write to stdout in a stdio server except through the MCP transport. Log to stderr.
- Read configuration from environment variables with documented defaults. Keep `.env.example` current.
- The fake API in each template is the test fixture. Extend it when you add example tools.
- Pin SDK versions in `package.json` and `pyproject.toml`. Bump them deliberately and re-run the tests.

## Starting a real server from this toolkit

1. Branch from `main`.
2. Copy one template to the repo root or a new directory, rename the package, and delete the other template if it is not needed.
3. Replace `src/tools/*` (TypeScript) or `src/mcp_server/tools/*` (Python) with tools designed per `docs/02-design-tools-from-an-api.md`.
4. Replace the fake API with recorded fixtures or a mock of the real API for tests.
5. Follow `docs/07-checklist.md` before opening a pull request.

## Verifying changes

```bash
cd templates/typescript && npm install && npm run build && npm test
cd templates/python && uv sync --extra dev && uv run pytest
cd evals && uv sync --extra dev && uv run pytest
```

CI runs both on every push.
