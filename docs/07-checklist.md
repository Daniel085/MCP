# 7. Definition of done

Copy this into the pull request for a new server and tick it off.

## Design

- [ ] Tool table written (name, upstream calls, inputs, output, annotations) and matches the code.
- [ ] Fewer than 20 tools, each named verb-first and unique across likely co-installed servers.
- [ ] Every tool and every input has a description written for a model, including when not to use the tool.
- [ ] List tools have `limit` defaults and explicit pagination.

## Code

- [ ] Current SDK APIs: `registerTool` (TypeScript) or `MCPServer` with `@mcp.tool` (Python).
- [ ] Upstream errors map to `isError` results with actionable text; secrets never appear in messages.
- [ ] Credentials come only from environment variables. `.env.example` lists every variable with a default or a placeholder.
- [ ] No stdout writes outside the transport. Logging goes to stderr.
- [ ] Annotations set on every tool and honest about side effects.
- [ ] Server name and version set in the `initialize` info.

## Tests

- [ ] Unit tests cover `tools/list`, one success and one failure path per tool, and one schema-validation rejection.
- [ ] Tests need no network. Fake API or recorded fixtures are checked in.
- [ ] Smoke test runs against the built artefact in CI.
- [ ] Manual pass with the MCP Inspector done and any confusing descriptions fixed.

## Deployment

- [ ] stdio: install command documented and tested on a clean machine.
- [ ] HTTP: container builds, `/healthz` responds, auth required on `/mcp`, `MCP_ALLOWED_HOSTS` set for non-loopback binds.
- [ ] TLS in front of any HTTP deployment.
- [ ] Client configuration examples in `deploy/` updated for this server.

## Security

- [ ] Section 6 review questions answered in the README.
- [ ] Upstream credential scoped to the minimum operations.
- [ ] Destructive tools annotated and logged.
- [ ] Dependency audit clean.
