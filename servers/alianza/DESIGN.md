# Alianza Experience API MCP server: design

Wraps the Alianza **Crux API** (the Experience integration API used by the Post-Call and Virtual Agent guides). It does not cover the separate Alianza Public API v2 (partition/account provisioning), which is a different product. SIPREC and SIP media are network protocols, not REST, so they are out of scope for an MCP server; this server manages the control plane that turns them on.

## Upstream inventory

| Aspect | Value |
| --- | --- |
| API base | Sandbox `https://api.b2.alianza.com`; production `https://api.alianza.com` (override with `ALIANZA_API_BASE_URL`) |
| Auth base | Sandbox `https://auth.beta.alianza.com`; production `https://auth.alianza.com` |
| Auth | OAuth 2.0 bearer. Two token kinds: **client credentials** (`scope=experience-assignability:check`, partner context) and **user context** via Authorization Code + PKCE (`experience-connections:manage experience-assignments:manage users:manage offline_access`). |
| Token endpoint | `POST {auth}/oauth/token`, form-encoded. `expires_in` typically 3600. Cache and refresh before expiry. |
| Authorize | `GET {auth}/authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256&login_hint=<E.164>` (`login_hint` drives home-realm discovery). Confidential clients also send `client_secret` on exchange. |
| Paging | Cursor-based: `pageSize` (1-100; users 1-200), `cursor`; response `{ entities, cursor, pageSize }`, users add `count`. Cursor is opaque and bound to the exact filter/sort. |
| Errors | RFC 9457 problem details: `{ type?, title, status, detail?, instance?, traceId, errors? }`. 400 bad param, 401 token, 403 scope, 404 (also used for "not authorised to see"), 409 conflict, 422 invalid data, 429 rate limit (100 rps per credential), 5xx. |
| IDs | UUIDs; phone numbers E.164. |

### Operations

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/experience/experiences/{experienceId}/assignability?targetType&targetValue` | `experience-assignability:check` | `assignable: false` when target not found. |
| GET | `/experience/assignments?targetType&targetValue&accountId&experienceId&cursor&pageSize` | `experience-assignments:manage` | At least one filter. `targetValue` needs `targetType`; `experienceId` needs `accountId`. |
| POST | `/experience/assignments` | same | Body `{ experienceId, targetType, targetValue }`. 409 if it cannot be created in this state. |
| GET / DELETE | `/experience/assignments/{assignmentId}` | same | 204 on delete. |
| GET | `/experience/connections?accountId|telephoneNumber&experienceId&cursor&pageSize` | `experience-connections:manage` | One of `accountId` or `telephoneNumber` required. |
| POST | `/experience/connections?telephoneNumber` | same | Body `{ experienceId, state }`. Resolves `accountId` from the number. 409 if exists. |
| GET / PUT / DELETE | `/experience/connections/{id}` | same | PUT takes the full resource; setting the state it already has returns 409. |
| GET | `/users?accountId&cursor&pageSize&sortBy&sortOrder` | `users:manage` | `sortBy` in `createdAt, lastName, firstName`. Eventually consistent. |
| GET | `/users/{userId}` | `users:manage` | Accepts unified UUID or native One id. 404 hides unauthorised users. |

### Webhooks

Subscriptions are created by Alianza during onboarding; there is no REST surface for them. Out of scope.

## Tool surface

Prefix `alianza_` avoids collisions with other telephony servers. Fourteen tools: one composite that performs the guides' four-step flow, twelve thin wrappers, and an auth status tool.

| Tool | Upstream | Inputs | Annotations |
| --- | --- | --- | --- |
| `alianza_auth_status` | none | | read-only |
| `alianza_check_assignability` | GET assignability | `target_type`, `target_value`, `experience_id?` | read-only, open-world |
| `alianza_list_assignments` | GET assignments | `account_id?`, `experience_id?`, `target_type?`, `target_value?`, `page_size=50`, `cursor?` | read-only |
| `alianza_get_assignment` | GET assignment | `assignment_id` | read-only |
| `alianza_create_assignment` | POST assignments | `target_type`, `target_value`, `experience_id?` | write |
| `alianza_delete_assignment` | DELETE assignment | `assignment_id` | destructive |
| `alianza_list_connections` | GET connections | `account_id?` or `telephone_number?`, `experience_id?`, `page_size=50`, `cursor?` | read-only |
| `alianza_get_connection` | GET connection | `connection_id` | read-only |
| `alianza_create_connection` | POST connections (+ GET on 409) | `telephone_number`, `experience_id?`, `state=INACTIVE` | write |
| `alianza_set_connection_state` | GET + PUT connection | `connection_id`, `state` | write, idempotent |
| `alianza_delete_connection` | DELETE connection | `connection_id` | destructive |
| `alianza_list_users` | GET users | `account_id?`, `page_size=50`, `cursor?`, `sort_by`, `sort_order` | read-only |
| `alianza_get_user` | GET user | `user_id` | read-only |
| `alianza_enable_experience` | assignability, connections, assignments, PUT | `telephone_number`, `target_type=ACCOUNT`, `target_value?`, `experience_id?` | write, idempotent (converges) |

`experience_id` defaults to `ALIANZA_EXPERIENCE_ID` everywhere, since a partner normally has one.

Decisions:

- **A composite tool for the onboarding flow.** "Enable our experience for +1415..." is the task users actually have. Four separate calls with 409 handling in between is exactly what a model gets wrong. The composite checks eligibility, creates or finds the connection, creates or finds the assignment, activates, and reports each step. Re-running converges, so it is annotated idempotent.
- **Deletes are separate, destructive tools.** Hosts confirm them. The composite never deletes.
- **No tool for the deprecated `tn` parameter or `CONNECTED` state.** Inputs accept only `ACTIVE` and `INACTIVE`; responses pass `CONNECTED` through with a note.
- **Users are read-only.** The API has no user writes.
- **Two token kinds handled inside the client.** Assignability uses client credentials when configured (the documented path), everything else uses the user-context token. Tools never see tokens. `alianza_auth_status` tells the model, and the user, when a login is needed.

## Authentication model in the server

| Source | Used for | Configured by |
| --- | --- | --- |
| Client credentials | assignability check | `ALIANZA_CLIENT_ID` + `ALIANZA_CLIENT_SECRET` |
| User-context token file | everything else | `alianza-mcp login` (PKCE in the browser) writes `ALIANZA_TOKEN_FILE`, default `~/.config/alianza-mcp/tokens.json`; refreshed automatically |
| Refresh token in env | same | `ALIANZA_REFRESH_TOKEN` (for headless deployments) |
| Static access token | same, until it expires | `ALIANZA_ACCESS_TOKEN` (quick tests only) |

`alianza-mcp login` runs Authorization Code + PKCE against a loopback redirect URI (`http://127.0.0.1:8765/callback` by default). That redirect URI must be registered with Alianza for your client. Pass `--login-hint +1415...` so home-realm discovery routes the user to the right identity provider.

## Errors the model will see

| Upstream | Tool text |
| --- | --- |
| 401 after refresh | "Alianza rejected the token. Run `alianza-mcp login` again." |
| 403 | "The token lacks the `<scope>` scope required for this operation." |
| 404 | "Not found (or not visible to this token): <detail>" |
| 409 | "Conflict: <detail>" plus, for connection create, the existing connection |
| 400/422 | "Alianza rejected the request: <detail>" with per-field errors |
| 429 | "Rate limited (100 requests/second per credential). Retry after N seconds." |
| 5xx / network | "Alianza API unavailable (HTTP n) traceId=…" |

Every error includes `traceId` when Alianza returned one, so support tickets can reference it.
