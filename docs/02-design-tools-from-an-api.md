# 2. Designing tools from an existing API

An MCP server is not a one-to-one mirror of an OpenAPI spec. A model performs far better with a small set of well-described, task-shaped tools than with 80 endpoint wrappers. Spend most of your effort here.

## Step 1: Inventory the API

Collect, for the API you are wrapping:

- The base URL and any environment variants (sandbox, production).
- Authentication: API key header, bearer token, OAuth client credentials, session cookie. Note token lifetimes.
- Rate limits and pagination conventions.
- The 5 to 15 operations a user actually performs through this API. Read the API's own "getting started" guide; it lists them.
- Error format. Most APIs return `{ "error": { "code": ..., "message": ... } }` or similar.

Write this down in the server's README. It is the contract your tools implement.

## Step 2: Choose the tool surface

Work from user tasks, not endpoints. For each task ask "what would a person type in the chat?" and design the tool that answers it in one call.

| Pattern | Do | Avoid |
| --- | --- | --- |
| Lookup | `get_customer(id)` returning the fields a human would want. | Separate tools for each sub-resource the person then has to join. |
| Search | `search_orders(query, status, limit)` with sensible defaults. | Exposing every filter parameter the API accepts. |
| Create/update | `create_ticket(title, body, priority)` with required fields only. | A generic `call_api(method, path, body)` tool. The model will misuse it and you lose all safety annotations. |
| Batch | One tool accepting a list when the API supports it. | Expecting the model to loop 50 times. |

Aim for under 20 tools. If you need more, split into multiple servers by domain.

## Step 3: Name and describe

Names are `snake_case`, verb first, unique across the servers a user is likely to run together: `github_create_issue` beats `create_issue` if the user also runs a Jira server.

Descriptions are prompts. Write them for the model, in this shape:

```
<What it does in one sentence.> <When to use it and when not to.> <What it returns.> <Any gotchas: rate limits, required IDs, side effects.>
```

Example:

```
Search invoices by free text, customer, or status. Use this when the user asks about invoices and does not give an exact invoice ID; use get_invoice when they do. Returns up to `limit` invoices with id, customer, amount, status, and due date. Results are newest first.
```

Every input field also gets a description. Say what format an ID takes and give an example value.

## Step 4: Shape the inputs

- Use typed schemas (Zod in TypeScript, type hints and Pydantic in Python). The SDK turns them into JSON Schema and validates arguments before your code runs.
- Prefer enums over free text for status fields.
- Give defaults for `limit` (10 to 25) and make pagination explicit with a `cursor` or `offset` input.
- Do not accept raw auth material as tool input. Credentials come from the server's environment.
- Keep flat objects. Nested inputs are harder for the model to fill correctly.

## Step 5: Shape the outputs

The model reads the output. Keep it short and relevant.

- Return the fields a person would want, not the raw payload. Drop internal IDs, HATEOAS links, and audit metadata unless they are needed for a follow-up call.
- Cap list results and say in the text when there are more (`Showing 10 of 340. Pass offset=10 for the next page.`).
- Provide `structuredContent` with an output schema when the data is tabular. Hosts and downstream code can use it; the model still gets the text.
- For long text (documents, logs), return the first N characters and offer a way to fetch more.

## Step 6: Errors

Map upstream failures to messages the model can act on. Return them as tool results with `isError: true`, not as thrown exceptions.

| Upstream | Tool result text |
| --- | --- |
| 401 / 403 | `Authentication failed. Check the API credentials configured for this server.` |
| 404 | `No customer found with id cus_123.` |
| 422 / 400 | `Invalid request: <validation message from the API>.` |
| 429 | `Rate limited by the API. Retry after 30 seconds.` |
| 5xx / network | `The upstream API is unavailable (HTTP 503). Try again shortly.` |

Never leak secrets, stack traces, or full request URLs with tokens in query strings.

## Step 7: Annotate

| Tool type | Annotations |
| --- | --- |
| Read, search, get | `readOnlyHint: true`, `openWorldHint: true` if it hits a remote API. |
| Create | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`. |
| Update | `destructiveHint: false` if reversible, `idempotentHint: true` if PUT-like. |
| Delete | `destructiveHint: true`. |

Hosts prompt users more aggressively for destructive tools. That is the point.

## Step 8: Write it down before coding

Fill this table for every tool. It becomes the tool registry in code and the reference section of the README.

| Tool | Upstream call(s) | Inputs | Output | Annotations |
| --- | --- | --- | --- | --- |
| `list_items` | `GET /items?q&limit&offset` | `query?`, `limit=10`, `offset=0` | items[], total | read-only, open-world |
| `get_item` | `GET /items/{id}` | `id` | item | read-only, open-world |
| `create_item` | `POST /items` | `name`, `description?` | item | not read-only, not destructive |

The templates implement exactly this table against a fake Items API so you can compare design to code.
