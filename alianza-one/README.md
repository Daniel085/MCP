# Alianza One MCP server

An MCP server for the [Alianza One](https://infrastructure.developer.alianza.com/api-guides) cloud voice platform, built from this toolkit's TypeScript template on `@modelcontextprotocol/sdk` 1.30. It wraps the Alianza Public API v2 with 20 task-shaped tools for the work a service provider's support and provisioning staff actually do: find a customer, see their users, numbers, and devices, check call history and voicemail, track number ports and activations, and provision a new customer end to end.

Runs over stdio for local hosts (Claude Code, Claude Desktop) or Streamable HTTP for remote deployment. Ships with a fake Alianza API so tests and local runs need no credentials.

## The API in one paragraph

Alianza is multi-tenant. A **partition** is the service provider; it contains **accounts** (customers). An account contains **end users** (the call-routing object for Business Cloud Communications and Home Phone), **telephone numbers**, and **device lines** (IP phones and ATAs). Inbound calls to a number go to whatever the number *references* (usually an END_USER, sometimes a SIP trunk, IVR, hunt group, ...); all of a user's devices ring together. Every API path is scoped by partition id. Authentication is `POST /v2/authorize` with an Admin Portal username and password; the returned `authToken` goes in an `X-AUTH-TOKEN` header and is valid for 8 hours from last use. The login response also tells you your partition id.

| Environment | Base URL |
| --- | --- |
| Development | `https://api.d2.alianza.com` |
| QA | `https://api.q2.alianza.com` |
| Beta (default) | `https://api.b2.alianza.com` |
| Production | `https://api.alianza.com` |

Beta partitions are provisioned by your Alianza representative and have different partition, carrier, and calling plan ids from production. The full OpenAPI spec (472 operations) is at `https://api.alianza.com/v2/apidocs/`; this server wraps 21 of them.

## Run

```bash
npm install
npm test                # in-process tests: every tool, auth flow, error mapping, HTTP transport
npm run build

npm run fake-api        # terminal 1: fake Alianza API on http://127.0.0.1:4010
ALIANZA_BASE_URL=http://127.0.0.1:4010 ALIANZA_USERNAME=api@example.com ALIANZA_PASSWORD=correct-horse npm run dev
npm run smoke           # terminal 3: spawns dist/index.js over stdio against the fake API

npm run dev:http        # Streamable HTTP on http://127.0.0.1:3000/mcp
```

Against real Alianza, copy `.env.example` to `.env`, fill in `ALIANZA_USERNAME` and `ALIANZA_PASSWORD` (create a dedicated API-only Admin Portal user), and pick `ALIANZA_BASE_URL`. Try it in the Inspector with `npm run inspect`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALIANZA_BASE_URL` | `https://api.b2.alianza.com` | Alianza API root. Beta by default so a missing setting never touches production. |
| `ALIANZA_USERNAME` | | Admin Portal / API user (an email address). Required unless `ALIANZA_AUTH_TOKEN` is set. |
| `ALIANZA_PASSWORD` | | Its password. |
| `ALIANZA_AUTH_TOKEN` | | Pre-issued token instead of username/password. Not refreshed on expiry. |
| `ALIANZA_PARTITION_ID` | | Default partition. Empty means the partition of the login. Set for sub-partitions. |
| `API_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` / `MCP_HTTP_PATH` | `127.0.0.1` / `3000` / `/mcp` | HTTP bind. Use `0.0.0.0` in containers. |
| `MCP_AUTH_TOKEN` | | If set, HTTP clients must send `Authorization: Bearer <token>`. |
| `MCP_ALLOWED_HOSTS` | | Comma-separated Host allowlist for non-loopback binds. |
| `LOG_LEVEL` | `info` | Stderr logging verbosity. |

The server logs in lazily on the first tool call, caches the token, and logs in again once if Alianza answers 401 (token expired). Credentials never reach tool inputs, outputs, or logs.

## Tools

Every tool takes an optional `partitionId` (defaults to the server's partition). Phone numbers are accepted in any common format and normalised to Alianza's 11-digit `18015551212` form. All tools return `isError` results with actionable text on upstream failures.

### Lookups

| Tool | Upstream call(s) | Inputs | Output |
| --- | --- | --- | --- |
| `alianza_get_partition` | `GET /v2/partition/{p}`, login info | | partition (name, status, sub-partitions, default time zone, allowed device types) and the login (username, permissions) |
| `alianza_search_accounts` | `GET /partition/{p}/account/search?q=` | `query`, `limit=20`, `offset` | accounts[] (id, number, name, status, type, matched field) |
| `alianza_get_account` | `GET /partition/{p}/account/{id}?accountIdType=` | `id`, `lookupBy` = Id \| AccountNumber \| PhoneNumber \| MacAddress | account (type, platform, time zone, extension length, billing day, user count, calling plans) |
| `alianza_get_account_history` | `GET /account/{id}/accounthistorysearch` | `accountId`, `startDate?`, `endDate?`, `historyTypes?`, `limit=20`, `offset` | who changed what and when |
| `alianza_list_users` | `GET /account/{id}/user` | `accountId`, `limit=50`, `offset` | users[] (name, username, email, extension, plan, admin type, caller id, device count) |
| `alianza_get_user` | `GET /account/{id}/user/{u}?idType=` | `accountId`, `userId`, `lookupBy` = ID \| UserName | user with call handling summary, devices, calling plan minutes |
| `alianza_list_phone_numbers` | `GET /account/{id}/telephonenumber` | `accountId`, `limit=50`, `offset` | numbers[] (routing, carrier status, port id, caller id name, E911 address, listing) |
| `alianza_get_phone_number` | `GET /partition/{p}/telephonenumber/{tn}` + account view | `phoneNumber` | inventory view (which account, rate center, cooldown) plus routing when assigned |
| `alianza_list_devices` | `GET /account/{id}/deviceline[?filterType]` (+ `registrationstatus` per device) | `accountId`, `macAddress?`, `userId?`, `includeRegistration=false`, `limit=50`, `offset` | device lines[] with optional SIP registration flag |
| `alianza_search_call_records` | `GET /account/{id}/cdrsearch` | `accountId`, `startDate`, `endDate`, `callType?`, `result?`, `fromNumber?`, `dialedNumber?`, `toNumber?`, `sort`, `sortOrder`, `limit=20`, `offset` | total + calls[] (direction, outcome, numbers, duration, cost) |
| `alianza_list_voicemails` | `GET /account/{id}/user/{u}/voicemail` | `accountId`, `userId`, `unreadOnly=false`, `limit=20`, `offset` | messages[] newest first, with transcription |
| `alianza_search_available_numbers` | `GET /partition/{p}/telephonenumber/search` | `searchType`, `query?`, `latitude?`, `longitude?`, `functionType=ELS`, `maxResults=10` | inventory numbers[] with rate center and distance |
| `alianza_validate_address` | `GET /v2/address/validate` | `address`, `postalCode?`, `country=USA` | parsed address fields, lat/long, valid flag, required fields |
| `alianza_search_number_orders` | `GET /partition/{p}/telephonenumber/statussearch` | `accountId?`, `phoneNumber?`, `statuses?`, `orderTypes?`, `startDate?`, `endDate?`, `dateType`, `limit=20`, `offset` | activation / port orders with status, FOC date, latest log entry |

### Writes

| Tool | Upstream call(s) | Inputs | Annotations |
| --- | --- | --- | --- |
| `alianza_create_account` | `POST /partition/{p}/account` | `accountNumber`, `accountName`, `accountType=ADVANCED`, `timeZone`, `extensionLength?`, `billingCycleDay=1`, `dialingBehaviorType?`, `platformType=CPE2`, `regulatoryType?`, `customField?` | not read-only, not destructive, not idempotent |
| `alianza_create_user` | `POST /account/{id}/user` (+ `GET account` for the time zone) | `accountId`, `firstName`, `lastName`, `extension?`, `userProductPlan?`, `endUserType=STANDARD`, `username?`, `emailAddress?`, `timeZone?`, `allowPortalAccess=false`, `blockEmail=false` | not read-only, not destructive |
| `alianza_add_phone_number` | `POST /account/{id}/telephonenumber` | `accountId`, `phoneNumber`, `customerType`, name fields, flat address fields, `latitude?`, `longitude?`, `directoryListingType=NOT_LIST_NOT_PUBLISH`, `holdActivation=false`, `referenceType?`, `referenceId?` | not read-only, not destructive (creates a carrier order) |
| `alianza_set_phone_number_destination` | `PUT /account/{id}/telephonenumber/{tn}/destination` | `accountId`, `phoneNumber`, `referenceType`, `referenceId`, `assignAsCallerId=false` | idempotent |
| `alianza_create_device_line` | `POST /account/{id}/deviceline` | `accountId`, `userId`, `deviceName`, `deviceTypeId`, `macAddress?`, `lineNumber=1`, `emergencyNumber?`, `faxEnabled=false` | not read-only, not destructive |
| `alianza_reserve_phone_number` | `PUT` / `DELETE /partition/{p}/telephonenumber/{tn}/reserve` | `phoneNumber`, `action=reserve` \| release | idempotent, reversible |

Nothing here deletes, suspends, or ports numbers. Those are deliberately out of scope for a first cut (see "Not wrapped" below).

### Provisioning a new customer

The order the Alianza *Account Create via API* guide prescribes, as tool calls:

1. `alianza_create_account` (ADVANCED for business, SIMPLE for Home Phone)
2. `alianza_create_user` (skip for Business Lines and SIP trunk accounts)
3. `alianza_validate_address` to get parsed address fields and lat/long
4. `alianza_search_available_numbers` (LAT_LONG is the most accurate) and optionally `alianza_reserve_phone_number`
5. `alianza_add_phone_number` with the parsed address, routing straight to the user, or `alianza_set_phone_number_destination` afterwards
6. `alianza_create_device_line` for each physical phone or ATA port
7. `alianza_search_number_orders` to watch the activation complete

### Prompts to try

- "Find the Acme Dental account and tell me which of their phones are not registered."
- "Where does 801-555-1002 ring, and is its port done yet?"
- "Show missed calls for account ACME-1001 last week."
- "Does Jane Doe have any unread voicemails?"
- "Who suspended account HOME-2002?"
- "Set up a new business account SP-200 for Lindon Bakery in US/Mountain with 4-digit extensions, add user Sam Lee ext 2000 on the Standard plan, and give them a Lindon number."

## Files

| File | Role |
| --- | --- |
| `src/index.ts` | Entry point. Reads config, picks stdio or HTTP. |
| `src/server.ts` | Creates the `McpServer`, sets the instructions, registers the tool groups. |
| `src/config.ts` | Environment variable parsing; fails fast without credentials. |
| `src/api-client.ts` | Alianza HTTP client: login, token cache and refresh, typed endpoint methods, error extraction. |
| `src/alianza-types.ts` | The subset of Alianza schemas the tools read and write. |
| `src/tools/partition.ts`, `accounts.ts`, `users.ts`, `numbers.ts`, `devices.ts`, `activity.ts` | The 20 tools, one file per domain. |
| `src/tools/common.ts` | Shared input fragments, phone/MAC normalisation, address formatting, paging. |
| `src/tools/errors.ts` | Maps `ApiError` and input errors to `isError` results. |
| `src/http.ts` | Express app: `/healthz`, bearer auth, stateless `/mcp`. |
| `src/fake-api.ts`, `src/fake-data.ts` | In-memory Alianza API for tests and demos (login, two accounts, users, numbers, devices, CDRs, history, voicemail, orders, inventory). |
| `scripts/smoke.ts` | Wire-level smoke test over stdio. |
| `test/` | Vitest suites: tool registry, auth flow, every tool's success and failure paths, HTTP transport. |

## Deployment

```bash
docker build -t alianza-one-mcp .
docker run --rm -p 3000:3000 \
  -e ALIANZA_BASE_URL=https://api.alianza.com \
  -e ALIANZA_USERNAME=... -e ALIANZA_PASSWORD=... \
  -e MCP_AUTH_TOKEN=... -e MCP_ALLOWED_HOSTS=mcp.example.com \
  alianza-one-mcp
```

Client configuration examples for Claude Code, Claude Desktop, and the Claude API are in `../deploy/`. Put TLS in front of any HTTP deployment. See `../docs/05-deploy.md`.

## Security review

Answers to the questions in `../docs/06-security.md`:

1. **Worst case for a compromised model.** It can create accounts, users, and device lines, and activate inventory numbers on any account in the partition, each of which can incur charges; it can reroute an existing number to a different user and change a user's caller id; and it can read call records, voicemail transcriptions, and E911 addresses for every customer. It cannot delete or suspend anything, port numbers, change passwords, or reach other partitions the login cannot see.
2. **What the host confirms.** All six write tools carry `readOnlyHint: false`; hosts prompt on them. Descriptions instruct the model to confirm details with the user before creating or activating, and the server `instructions` say the same. Reads are `readOnlyHint: true` and run without prompts.
3. **What logs and errors reveal.** Logs go to stderr as JSON with ids (partition, account, user, device, phone number) and upstream status codes, never credentials, tokens, or request bodies. Error text returned to the model carries Alianza's message but the 401 path replaces it with a fixed sentence so a bad password is never echoed.
4. **Credential rotation.** The Alianza user is a normal Admin Portal user; rotate its password in the portal and restart the server (or set a fresh `ALIANZA_AUTH_TOKEN`). Only the deployment environment holds the secret. Scope the user to the smallest Alianza permission set that still allows the writes you want; drop write permission and the six write tools fail cleanly with a permission message.

## Not wrapped

Deliberately left out of the first cut, either because they are destructive, need human judgement, or need clarification about how your partition is set up:

- Deleting or suspending accounts, users, numbers, or devices.
- Porting numbers in (`port` object on the activation request), updating or cancelling ports, triggering ports, LOAs.
- Password resets and voicemail PIN unlocks (they send email to the customer).
- Business Lines, SIP trunks, hunt groups, IVRs, auto attendants, call queues, contact center.
- Bulk operations, reports, CSV exports, dynamic inventory orders, BYOTN.
- Sub-partition management, calling plan products, device inventory management.

Each of these maps onto the same client and tool pattern; add a tool per task, extend the fake API, and add a test.
