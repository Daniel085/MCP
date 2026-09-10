# 8. Worked example: wrapping the Acme Helpdesk API

This guide takes the template from "fictional Items API" to a complete server for a realistic ticketing API, in both languages. Every code block below was compiled and tested exactly as shown. The Acme Helpdesk API is invented, but its shape (cursor paging, a nested comment resource, a state-changing action, structured errors) is what most SaaS APIs look like.

## The API we are wrapping

From Acme's (imaginary) developer docs:

| Aspect | Value |
| --- | --- |
| Base URL | `https://helpdesk.example.com/v1` |
| Auth | `X-Api-Key: <key>` header |
| Paging | `?page_size=&cursor=`; responses carry `next_cursor` (null on the last page) |
| Errors | `{ "error": { "code": "not_found", "message": "..." } }` with 401, 404, 409, 422, 429 |

| Endpoint | Purpose |
| --- | --- |
| `GET /tickets?q&status&page_size&cursor` | Search tickets |
| `GET /tickets/{id}` | One ticket with its comment thread |
| `POST /tickets` | Create a ticket |
| `POST /tickets/{id}/comments` | Add a comment |
| `POST /tickets/{id}/close` | Close a ticket (409 if already closed) |
| `PATCH /tickets/{id}`, `DELETE /tickets/{id}`, `GET /agents`, `GET /sla` | Exist, but we will not expose them |

The last row is the first design decision. Agents rarely need SLA tables or the agent directory, and deleting tickets is something we do not want a model doing at all. Four endpoints become five tools; the rest stay out.

## Step 1: The tool table

| Tool | Upstream | Inputs | Output | Annotations |
| --- | --- | --- | --- | --- |
| `helpdesk_search_tickets` | `GET /tickets` | `query?`, `status?`, `page_size=10`, `cursor?` | summaries + `next_cursor` | read-only, open-world |
| `helpdesk_get_ticket` | `GET /tickets/{id}` | `id` (`tkt_*`) | full ticket + comments | read-only, open-world |
| `helpdesk_create_ticket` | `POST /tickets` | `subject`, `body`, `requester_email`, `priority=normal` | full ticket | write, not destructive |
| `helpdesk_add_comment` | `POST /tickets/{id}/comments` | `ticket_id`, `body` | comment | write, not destructive |
| `helpdesk_close_ticket` | `POST /tickets/{id}/close` | `id` | full ticket | destructive, idempotent |

Decisions worth noting:

- Names carry a `helpdesk_` prefix so they cannot collide with a Jira or GitHub server the user also runs.
- Search returns summaries only. The model asks for a full ticket when it needs one, which keeps a ten-ticket search under a few hundred tokens.
- `close_ticket` is marked destructive even though Acme allows reopening, because the requester is notified. Hosts will confirm with the user, which is what we want.
- Ticket ids are validated with a regex in the schema so a bad id is rejected before any HTTP call.

## Step 2: Environment

`.env.example` gains nothing new; the variable names are already generic. Set them for the real API:

```bash
API_BASE_URL=https://helpdesk.example.com/v1
API_KEY=ak_live_...
```

## Step 3: The API client

Only the auth header and the endpoint methods change. Note the header is now `X-Api-Key` and the methods return typed objects.

### TypeScript: `src/api-client.ts`

```ts
/**
 * Client for the Acme Helpdesk API (fictional).
 *
 *   Base URL   https://helpdesk.example.com/v1
 *   Auth       X-Api-Key header
 *   Paging     cursor-based: ?page_size=&cursor= -> { tickets, next_cursor }
 *   Errors     { "error": { "code": "...", "message": "..." } }
 */
import type { Config } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type TicketStatus = "open" | "pending" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester_email: string;
  created_at: string;
  updated_at: string;
  comments?: Comment[];
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface TicketPage {
  tickets: Ticket[];
  next_cursor: string | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromConfig(config: Config, fetchImpl?: typeof fetch): ApiClient {
    return new ApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.apiTimeoutMs,
      fetchImpl,
    });
  }

  // ---- Endpoint methods ---------------------------------------------------

  searchTickets(params: {
    query?: string;
    status?: TicketStatus;
    pageSize: number;
    cursor?: string;
  }): Promise<TicketPage> {
    const search = new URLSearchParams({ page_size: String(params.pageSize) });
    if (params.query) search.set("q", params.query);
    if (params.status) search.set("status", params.status);
    if (params.cursor) search.set("cursor", params.cursor);
    return this.request<TicketPage>("GET", `/tickets?${search}`);
  }

  getTicket(id: string): Promise<Ticket> {
    return this.request<Ticket>("GET", `/tickets/${encodeURIComponent(id)}`);
  }

  createTicket(input: {
    subject: string;
    body: string;
    priority: TicketPriority;
    requester_email: string;
  }): Promise<Ticket> {
    return this.request<Ticket>("POST", "/tickets", input);
  }

  addComment(ticketId: string, body: string): Promise<Comment> {
    return this.request<Comment>("POST", `/tickets/${encodeURIComponent(ticketId)}/comments`, { body });
  }

  closeTicket(id: string): Promise<Ticket> {
    return this.request<Ticket>("POST", `/tickets/${encodeURIComponent(id)}/close`);
  }

  // ---- Transport ----------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (this.apiKey) headers.set("X-Api-Key", this.apiKey);
    if (body !== undefined) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "unreachable";
      throw new ApiError(0, `Upstream API ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ApiError(
        res.status,
        await extractErrorMessage(res),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
    if (data.message) return data.message;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}
```

### Python: `src/mcp_server/api_client.py`

```python
"""Client for the Acme Helpdesk API (fictional).

    Base URL   https://helpdesk.example.com/v1
    Auth       X-Api-Key header
    Paging     cursor-based: ?page_size=&cursor= -> { tickets, next_cursor }
    Errors     { "error": { "code": "...", "message": "..." } }
"""

from __future__ import annotations

from typing import Any, Literal

import httpx
from pydantic import BaseModel

from .config import Config

TicketStatus = Literal["open", "pending", "closed"]
TicketPriority = Literal["low", "normal", "high", "urgent"]


class ApiError(Exception):
    def __init__(self, status: int, message: str, retry_after_seconds: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class Comment(BaseModel):
    id: str
    author: str
    body: str
    created_at: str


class Ticket(BaseModel):
    id: str
    subject: str
    body: str
    status: TicketStatus
    priority: TicketPriority
    requester_email: str
    created_at: str
    updated_at: str
    comments: list[Comment] | None = None


class TicketPage(BaseModel):
    tickets: list[Ticket]
    next_cursor: str | None


class ApiClient:
    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        timeout_ms: int = 15_000,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"Accept": "application/json"}
        if api_key:
            headers["X-Api-Key"] = api_key
        self._client = httpx.AsyncClient(
            base_url=base_url, headers=headers, timeout=httpx.Timeout(timeout_ms / 1000), transport=transport
        )

    @classmethod
    def from_config(cls, config: Config, transport: httpx.AsyncBaseTransport | None = None) -> ApiClient:
        return cls(config.api_base_url, config.api_key, config.api_timeout_ms, transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    # ---- Endpoint methods ---------------------------------------------------

    async def search_tickets(
        self, query: str | None, status: TicketStatus | None, page_size: int, cursor: str | None
    ) -> TicketPage:
        params: dict[str, Any] = {"page_size": page_size}
        if query:
            params["q"] = query
        if status:
            params["status"] = status
        if cursor:
            params["cursor"] = cursor
        return TicketPage.model_validate(await self._request("GET", "/tickets", params=params))

    async def get_ticket(self, ticket_id: str) -> Ticket:
        return Ticket.model_validate(await self._request("GET", f"/tickets/{ticket_id}"))

    async def create_ticket(self, subject: str, body: str, priority: TicketPriority, requester_email: str) -> Ticket:
        payload = {"subject": subject, "body": body, "priority": priority, "requester_email": requester_email}
        return Ticket.model_validate(await self._request("POST", "/tickets", json=payload))

    async def add_comment(self, ticket_id: str, body: str) -> Comment:
        return Comment.model_validate(await self._request("POST", f"/tickets/{ticket_id}/comments", json={"body": body}))

    async def close_ticket(self, ticket_id: str) -> Ticket:
        return Ticket.model_validate(await self._request("POST", f"/tickets/{ticket_id}/close"))

    # ---- Transport ----------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            res = await self._client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise ApiError(0, "timed out") from exc
        except httpx.HTTPError as exc:
            raise ApiError(0, "unreachable") from exc
        if res.is_error:
            retry_after = res.headers.get("retry-after")
            raise ApiError(
                res.status_code,
                _extract_error_message(res),
                int(retry_after) if retry_after and retry_after.isdigit() else None,
            )
        if res.status_code == 204 or not res.content:
            return None
        return res.json()


def _extract_error_message(res: httpx.Response) -> str:
    try:
        data = res.json()
    except ValueError:
        return f"HTTP {res.status_code}"
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, str):
            return err
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return err["message"]
        if isinstance(data.get("message"), str):
            return data["message"]
    return f"HTTP {res.status_code}"
```

## Step 4: Error mapping

The mapping is shared by all tools, so it moves into its own module. The only change from the template is naming the API and adding 409 to the "rejected" group.

### TypeScript: `src/tools/errors.ts`

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "../api-client.js";
import { log } from "../log.js";

export function apiErrorToText(err: ApiError): string {
  switch (err.status) {
    case 0:
      return `The helpdesk API could not be reached (${err.message}). Try again shortly.`;
    case 401:
    case 403:
      return "Authentication with the helpdesk API failed. Check the API key configured for this server.";
    case 404:
      return `Not found: ${err.message}`;
    case 400:
    case 409:
    case 422:
      return `The helpdesk API rejected the request: ${err.message}`;
    case 429:
      return `Rate limited by the helpdesk API. Retry after ${err.retryAfterSeconds ?? 30} seconds.`;
    default:
      return err.status >= 500
        ? `The helpdesk API is unavailable (HTTP ${err.status}). Try again shortly.`
        : `Helpdesk API error (HTTP ${err.status}): ${err.message}`;
  }
}

export async function withErrorHandling(
  toolName: string,
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn("tool returned error", { tool: toolName, status: err.status, message: err.message });
      return { content: [{ type: "text", text: apiErrorToText(err) }], isError: true };
    }
    log.error("tool crashed", { tool: toolName, error: String(err) });
    throw err;
  }
}
```

### Python: `src/mcp_server/tools/errors.py`

```python
import logging

from mcp.server.mcpserver.exceptions import ToolError

from ..api_client import ApiError

log = logging.getLogger(__name__)


def api_error_to_text(err: ApiError) -> str:
    if err.status == 0:
        return f"The helpdesk API could not be reached ({err.message}). Try again shortly."
    if err.status in (401, 403):
        return "Authentication with the helpdesk API failed. Check the API key configured for this server."
    if err.status == 404:
        return f"Not found: {err.message}"
    if err.status in (400, 409, 422):
        return f"The helpdesk API rejected the request: {err.message}"
    if err.status == 429:
        return f"Rate limited by the helpdesk API. Retry after {err.retry_after_seconds or 30} seconds."
    if err.status >= 500:
        return f"The helpdesk API is unavailable (HTTP {err.status}). Try again shortly."
    return f"Helpdesk API error (HTTP {err.status}): {err.message}"


def api_error_to_tool_error(tool: str, err: ApiError) -> ToolError:
    log.warning("tool returned error", extra={"fields": {"tool": tool, "status": err.status, "message": err.message}})
    return ToolError(api_error_to_text(err))
```

## Step 5: The tools

This is where the design table becomes code. Read the descriptions as prompts: each says what the tool does, when to prefer a sibling tool, what comes back, and any side effect the user should hear about first.

### TypeScript: `src/tools/tickets.ts`

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, type Ticket } from "../api-client.js";
import { log } from "../log.js";
import { withErrorHandling } from "./errors.js";

const status = z.enum(["open", "pending", "closed"]);
const priority = z.enum(["low", "normal", "high", "urgent"]);

const ticketSummary = {
  id: z.string(),
  subject: z.string(),
  status,
  priority,
  requester_email: z.string(),
  updated_at: z.string(),
};
const commentShape = { id: z.string(), author: z.string(), body: z.string(), created_at: z.string() };
const ticketDetail = { ...ticketSummary, body: z.string(), created_at: z.string(), comments: z.array(z.object(commentShape)) };

function summary(t: Ticket) {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    requester_email: t.requester_email,
    updated_at: t.updated_at,
  };
}

function detail(t: Ticket) {
  return { ...summary(t), body: t.body, created_at: t.created_at, comments: t.comments ?? [] };
}

export function registerTicketTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "helpdesk_search_tickets",
    {
      title: "Search tickets",
      description:
        "Search helpdesk tickets by free text and/or status. Use this when the user refers to a ticket by topic, " +
        "requester, or state rather than by id; use helpdesk_get_ticket when an id like tkt_123 is known. " +
        "Returns a page of ticket summaries (no bodies or comments) and a next_cursor when more exist.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Free text matched against subject, body, and requester email."),
        status: status.optional().describe("Restrict to one status. Omit for all."),
        page_size: z.number().int().min(1).max(50).default(10).describe("Tickets per page."),
        cursor: z.string().optional().describe("next_cursor from a previous call, to fetch the following page."),
      },
      outputSchema: {
        tickets: z.array(z.object(ticketSummary)),
        next_cursor: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, status, page_size, cursor }) =>
      withErrorHandling("helpdesk_search_tickets", async () => {
        const page = await api.searchTickets({ query, status, pageSize: page_size, cursor });
        const tickets = page.tickets.map(summary);
        const lines = tickets.map((t) => `- ${t.id} [${t.status}/${t.priority}] ${t.subject} (${t.requester_email})`);
        const more = page.next_cursor ? `\nMore results available: pass cursor="${page.next_cursor}".` : "";
        const text = tickets.length === 0 ? "No tickets matched." : `${tickets.length} ticket(s):\n${lines.join("\n")}${more}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { tickets, next_cursor: page.next_cursor },
        };
      }),
  );

  server.registerTool(
    "helpdesk_get_ticket",
    {
      title: "Get ticket",
      description:
        "Fetch one ticket with its full body and comment thread by id (for example tkt_123). " +
        "Use helpdesk_search_tickets first if you only have a subject or requester.",
      inputSchema: { id: z.string().regex(/^tkt_\w+$/).describe("Ticket id, e.g. tkt_123") },
      outputSchema: ticketDetail,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) =>
      withErrorHandling("helpdesk_get_ticket", async () => {
        const t = detail(await api.getTicket(id));
        const thread = t.comments.map((c) => `\n[${c.created_at}] ${c.author}: ${c.body}`).join("");
        const text =
          `${t.id} [${t.status}/${t.priority}] ${t.subject}\nRequester: ${t.requester_email}\n\n${t.body}` +
          (thread ? `\n\nComments:${thread}` : "\n\nNo comments yet.");
        return { content: [{ type: "text", text }], structuredContent: t };
      }),
  );

  server.registerTool(
    "helpdesk_create_ticket",
    {
      title: "Create ticket",
      description:
        "Open a new helpdesk ticket on behalf of a requester. Confirm subject, requester email, and priority with the user " +
        "before calling. Returns the created ticket including its new id.",
      inputSchema: {
        subject: z.string().min(3).max(200).describe("Short summary of the problem."),
        body: z.string().min(1).max(5000).describe("Full description of the problem."),
        requester_email: z.string().email().describe("Email of the person the ticket is for."),
        priority: priority.default("normal").describe("Urgency. Default normal; use high or urgent only when the user says so."),
      },
      outputSchema: ticketDetail,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ subject, body, requester_email, priority }) =>
      withErrorHandling("helpdesk_create_ticket", async () => {
        const t = detail(await api.createTicket({ subject, body, requester_email, priority }));
        log.info("ticket created", { id: t.id });
        return { content: [{ type: "text", text: `Created ${t.id}: ${t.subject} (${t.priority}).` }], structuredContent: t };
      }),
  );

  server.registerTool(
    "helpdesk_add_comment",
    {
      title: "Add comment",
      description:
        "Post a comment on an existing ticket. The comment is visible to the requester. Use this to reply or add notes; " +
        "do not use it to close a ticket (use helpdesk_close_ticket).",
      inputSchema: {
        ticket_id: z.string().regex(/^tkt_\w+$/).describe("Ticket id, e.g. tkt_123"),
        body: z.string().min(1).max(5000).describe("Comment text."),
      },
      outputSchema: commentShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ ticket_id, body }) =>
      withErrorHandling("helpdesk_add_comment", async () => {
        const c = await api.addComment(ticket_id, body);
        return { content: [{ type: "text", text: `Added comment ${c.id} to ${ticket_id}.` }], structuredContent: { ...c } };
      }),
  );

  server.registerTool(
    "helpdesk_close_ticket",
    {
      title: "Close ticket",
      description:
        "Mark a ticket as closed. Ask the user to confirm before calling. A closed ticket can be reopened by an agent " +
        "in the helpdesk UI, but the requester is notified immediately. Returns the updated ticket.",
      inputSchema: { id: z.string().regex(/^tkt_\w+$/).describe("Ticket id, e.g. tkt_123") },
      outputSchema: ticketDetail,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) =>
      withErrorHandling("helpdesk_close_ticket", async () => {
        const t = detail(await api.closeTicket(id));
        log.info("ticket closed", { id: t.id });
        return { content: [{ type: "text", text: `Closed ${t.id}.` }], structuredContent: t };
      }),
  );
}
```

### Python: `src/mcp_server/tools/tickets.py`

The Python version returns Pydantic models, and the SDK derives both the text and the structured content from them. Note `EmailStr` requires the `pydantic[email]` extra in `pyproject.toml`.

```python
from __future__ import annotations

import logging
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from pydantic import BaseModel, EmailStr, Field

from ..api_client import ApiClient, ApiError, Comment, Ticket, TicketPriority, TicketStatus
from .errors import api_error_to_tool_error

log = logging.getLogger(__name__)

TicketId = Annotated[str, Field(description="Ticket id, e.g. tkt_123", pattern=r"^tkt_\w+$")]


class TicketSummary(BaseModel):
    id: str
    subject: str
    status: TicketStatus
    priority: TicketPriority
    requester_email: str
    updated_at: str

    @classmethod
    def from_ticket(cls, t: Ticket) -> TicketSummary:
        return cls(**t.model_dump(include=set(cls.model_fields)))


class TicketDetail(TicketSummary):
    body: str
    created_at: str
    comments: list[Comment] = []

    @classmethod
    def from_ticket(cls, t: Ticket) -> TicketDetail:
        return cls(**t.model_dump(include=set(cls.model_fields), exclude={"comments"}), comments=t.comments or [])


class TicketPageView(BaseModel):
    tickets: list[TicketSummary]
    next_cursor: str | None


READ = ToolAnnotations(read_only_hint=True, open_world_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=True)


def register_ticket_tools(mcp: MCPServer, api: ApiClient) -> None:
    @mcp.tool(
        name="helpdesk_search_tickets",
        title="Search tickets",
        description=(
            "Search helpdesk tickets by free text and/or status. Use this when the user refers to a ticket by topic, "
            "requester, or state rather than by id; use helpdesk_get_ticket when an id like tkt_123 is known. "
            "Returns a page of ticket summaries (no bodies or comments) and a next_cursor when more exist."
        ),
        annotations=READ,
    )
    async def search_tickets(
        query: Annotated[
            str | None, Field(description="Free text matched against subject, body, and requester email.", max_length=200)
        ] = None,
        status: Annotated[TicketStatus | None, Field(description="Restrict to one status. Omit for all.")] = None,
        page_size: Annotated[int, Field(description="Tickets per page.", ge=1, le=50)] = 10,
        cursor: Annotated[str | None, Field(description="next_cursor from a previous call.")] = None,
    ) -> TicketPageView:
        try:
            page = await api.search_tickets(query, status, page_size, cursor)
        except ApiError as err:
            raise api_error_to_tool_error("helpdesk_search_tickets", err) from err
        return TicketPageView(tickets=[TicketSummary.from_ticket(t) for t in page.tickets], next_cursor=page.next_cursor)

    @mcp.tool(
        name="helpdesk_get_ticket",
        title="Get ticket",
        description=(
            "Fetch one ticket with its full body and comment thread by id (for example tkt_123). "
            "Use helpdesk_search_tickets first if you only have a subject or requester."
        ),
        annotations=READ,
    )
    async def get_ticket(id: TicketId) -> TicketDetail:
        try:
            return TicketDetail.from_ticket(await api.get_ticket(id))
        except ApiError as err:
            raise api_error_to_tool_error("helpdesk_get_ticket", err) from err

    @mcp.tool(
        name="helpdesk_create_ticket",
        title="Create ticket",
        description=(
            "Open a new helpdesk ticket on behalf of a requester. Confirm subject, requester email, and priority with "
            "the user before calling. Returns the created ticket including its new id."
        ),
        annotations=WRITE,
    )
    async def create_ticket(
        subject: Annotated[str, Field(description="Short summary of the problem.", min_length=3, max_length=200)],
        body: Annotated[str, Field(description="Full description of the problem.", min_length=1, max_length=5000)],
        requester_email: Annotated[EmailStr, Field(description="Email of the person the ticket is for.")],
        priority: Annotated[
            TicketPriority,
            Field(description="Urgency. Default normal; use high or urgent only when the user says so."),
        ] = "normal",
    ) -> TicketDetail:
        try:
            t = await api.create_ticket(subject, body, priority, requester_email)
        except ApiError as err:
            raise api_error_to_tool_error("helpdesk_create_ticket", err) from err
        log.info("ticket created", extra={"fields": {"id": t.id}})
        return TicketDetail.from_ticket(t)

    @mcp.tool(
        name="helpdesk_add_comment",
        title="Add comment",
        description=(
            "Post a comment on an existing ticket. The comment is visible to the requester. Use this to reply or add "
            "notes; do not use it to close a ticket (use helpdesk_close_ticket)."
        ),
        annotations=WRITE,
    )
    async def add_comment(
        ticket_id: TicketId,
        body: Annotated[str, Field(description="Comment text.", min_length=1, max_length=5000)],
    ) -> Comment:
        try:
            return await api.add_comment(ticket_id, body)
        except ApiError as err:
            raise api_error_to_tool_error("helpdesk_add_comment", err) from err

    @mcp.tool(
        name="helpdesk_close_ticket",
        title="Close ticket",
        description=(
            "Mark a ticket as closed. Ask the user to confirm before calling. A closed ticket can be reopened by an "
            "agent in the helpdesk UI, but the requester is notified immediately. Returns the updated ticket."
        ),
        annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=True),
    )
    async def close_ticket(id: TicketId) -> TicketDetail:
        try:
            t = await api.close_ticket(id)
        except ApiError as err:
            raise api_error_to_tool_error("helpdesk_close_ticket", err) from err
        log.info("ticket closed", extra={"fields": {"id": t.id}})
        return TicketDetail.from_ticket(t)
```

## Step 6: Register the tools and name the server

### TypeScript: `src/server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./api-client.js";
import { registerTicketTools } from "./tools/tickets.js";

export const SERVER_NAME = "acme-helpdesk-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(api: ApiClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tools for the Acme Helpdesk. Search first when you do not have a ticket id. " +
        "Creating, commenting on, and closing tickets notify the requester, so confirm with the user before those calls.",
    },
  );
  registerTicketTools(server, api);
  return server;
}
```

### Python: `src/mcp_server/server.py` (and set `SERVER_NAME = "acme-helpdesk-mcp"` in `__init__.py`)

```python
from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from . import SERVER_NAME, SERVER_VERSION
from .api_client import ApiClient
from .tools.tickets import register_ticket_tools


def create_server(api: ApiClient) -> MCPServer:
    mcp = MCPServer(
        SERVER_NAME,
        version=SERVER_VERSION,
        instructions=(
            "Tools for the Acme Helpdesk. Search first when you do not have a ticket id. "
            "Creating, commenting on, and closing tickets notify the requester, so confirm with the user before those calls."
        ),
    )
    register_ticket_tools(mcp, api)
    return mcp
```

## Step 7: Replace the fake API

The fake API is the test fixture, so it has to speak the real API's dialect: `X-Api-Key`, cursor paging, the `{ error: { code, message } }` envelope, and the 409 on double close.

### TypeScript: `src/fake-api.ts`

```ts
#!/usr/bin/env node
/**
 * In-memory stand-in for the Acme Helpdesk API. Mirrors the real API's shapes
 * so tests and local demos need no credentials.
 */
import express from "express";
import type { Comment, Ticket } from "./api-client.js";

export function createFakeApi() {
  const app = express();
  app.use(express.json());

  const tickets: Ticket[] = [
    { id: "tkt_1", subject: "Cannot log in", body: "Password reset email never arrives.", status: "open", priority: "high", requester_email: "ana@example.com", created_at: "2026-08-01T09:00:00Z", updated_at: "2026-08-01T09:00:00Z", comments: [] },
    { id: "tkt_2", subject: "Invoice shows wrong amount", body: "August invoice is double.", status: "pending", priority: "normal", requester_email: "bo@example.com", created_at: "2026-08-02T10:00:00Z", updated_at: "2026-08-03T11:00:00Z", comments: [{ id: "cmt_1", author: "agent", body: "Looking into it.", created_at: "2026-08-03T11:00:00Z" }] },
    { id: "tkt_3", subject: "Feature request: dark mode", body: "Please add dark mode.", status: "closed", priority: "low", requester_email: "cy@example.com", created_at: "2026-07-20T08:00:00Z", updated_at: "2026-07-25T08:00:00Z", comments: [] },
  ];
  let nextTicket = 4;
  let nextComment = 2;

  app.use((req, res, next) => {
    if (req.headers["x-api-key"] === "bad-key") {
      res.status(401).json({ error: { code: "unauthorized", message: "invalid api key" } });
      return;
    }
    next();
  });

  app.get("/tickets", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const status = req.query.status as string | undefined;
    const pageSize = Math.min(Number(req.query.page_size ?? 10), 50);
    const offset = Number(req.query.cursor ?? 0);
    let matched = tickets;
    if (status) matched = matched.filter((t) => t.status === status);
    if (q) matched = matched.filter((t) => [t.subject, t.body, t.requester_email].some((s) => s.toLowerCase().includes(q)));
    const page = matched.slice(offset, offset + pageSize).map(({ comments: _c, ...t }) => t);
    const next = offset + pageSize < matched.length ? String(offset + pageSize) : null;
    res.json({ tickets: page, next_cursor: next });
  });

  app.get("/tickets/:id", (req, res) => {
    const t = tickets.find((x) => x.id === req.params.id);
    if (!t) {
      res.status(404).json({ error: { code: "not_found", message: `ticket ${req.params.id} does not exist` } });
      return;
    }
    res.json(t);
  });

  app.post("/tickets", (req, res) => {
    const { subject, body, priority, requester_email } = req.body ?? {};
    if (!subject || !body || !requester_email) {
      res.status(422).json({ error: { code: "validation", message: "subject, body, and requester_email are required" } });
      return;
    }
    const now = new Date().toISOString();
    const t: Ticket = { id: `tkt_${nextTicket++}`, subject, body, priority: priority ?? "normal", status: "open", requester_email, created_at: now, updated_at: now, comments: [] };
    tickets.push(t);
    res.status(201).json(t);
  });

  app.post("/tickets/:id/comments", (req, res) => {
    const t = tickets.find((x) => x.id === req.params.id);
    if (!t) {
      res.status(404).json({ error: { code: "not_found", message: `ticket ${req.params.id} does not exist` } });
      return;
    }
    const c: Comment = { id: `cmt_${nextComment++}`, author: "api", body: String(req.body?.body ?? ""), created_at: new Date().toISOString() };
    t.comments!.push(c);
    t.updated_at = c.created_at;
    res.status(201).json(c);
  });

  app.post("/tickets/:id/close", (req, res) => {
    const t = tickets.find((x) => x.id === req.params.id);
    if (!t) {
      res.status(404).json({ error: { code: "not_found", message: `ticket ${req.params.id} does not exist` } });
      return;
    }
    if (t.status === "closed") {
      res.status(409).json({ error: { code: "already_closed", message: `ticket ${t.id} is already closed` } });
      return;
    }
    t.status = "closed";
    t.updated_at = new Date().toISOString();
    res.json(t);
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.FAKE_API_PORT ?? 4010);
  createFakeApi().listen(port, "127.0.0.1", () => {
    process.stderr.write(`fake helpdesk api listening on http://127.0.0.1:${port}\n`);
  });
}
```

### Python: `src/mcp_server/fake_api.py`

```python
"""In-memory stand-in for the Acme Helpdesk API."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def create_fake_api() -> Starlette:
    tickets: list[dict] = [
        {"id": "tkt_1", "subject": "Cannot log in", "body": "Password reset email never arrives.", "status": "open", "priority": "high", "requester_email": "ana@example.com", "created_at": "2026-08-01T09:00:00Z", "updated_at": "2026-08-01T09:00:00Z", "comments": []},
        {"id": "tkt_2", "subject": "Invoice shows wrong amount", "body": "August invoice is double.", "status": "pending", "priority": "normal", "requester_email": "bo@example.com", "created_at": "2026-08-02T10:00:00Z", "updated_at": "2026-08-03T11:00:00Z", "comments": [{"id": "cmt_1", "author": "agent", "body": "Looking into it.", "created_at": "2026-08-03T11:00:00Z"}]},
        {"id": "tkt_3", "subject": "Feature request: dark mode", "body": "Please add dark mode.", "status": "closed", "priority": "low", "requester_email": "cy@example.com", "created_at": "2026-07-20T08:00:00Z", "updated_at": "2026-07-25T08:00:00Z", "comments": []},
    ]
    counters = {"ticket": 4, "comment": 2}

    def find(ticket_id: str) -> dict | None:
        return next((t for t in tickets if t["id"] == ticket_id), None)

    def unauthorized(request: Request) -> JSONResponse | None:
        if request.headers.get("x-api-key") == "bad-key":
            return _error(401, "unauthorized", "invalid api key")
        return None

    async def search(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        q = request.query_params.get("q", "").lower()
        status = request.query_params.get("status")
        page_size = min(int(request.query_params.get("page_size", 10)), 50)
        offset = int(request.query_params.get("cursor", 0))
        matched = tickets
        if status:
            matched = [t for t in matched if t["status"] == status]
        if q:
            matched = [t for t in matched if any(q in t[k].lower() for k in ("subject", "body", "requester_email"))]
        page = [{k: v for k, v in t.items() if k != "comments"} for t in matched[offset : offset + page_size]]
        next_cursor = str(offset + page_size) if offset + page_size < len(matched) else None
        return JSONResponse({"tickets": page, "next_cursor": next_cursor})

    async def get(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        t = find(request.path_params["id"])
        return JSONResponse(t) if t else _error(404, "not_found", f"ticket {request.path_params['id']} does not exist")

    async def create(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        body = await request.json()
        if not all(body.get(k) for k in ("subject", "body", "requester_email")):
            return _error(422, "validation", "subject, body, and requester_email are required")
        t = {
            "id": f"tkt_{counters['ticket']}", "subject": body["subject"], "body": body["body"],
            "priority": body.get("priority", "normal"), "status": "open", "requester_email": body["requester_email"],
            "created_at": _now(), "updated_at": _now(), "comments": [],
        }
        counters["ticket"] += 1
        tickets.append(t)
        return JSONResponse(t, status_code=201)

    async def comment(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        t = find(request.path_params["id"])
        if not t:
            return _error(404, "not_found", f"ticket {request.path_params['id']} does not exist")
        body = await request.json()
        c = {"id": f"cmt_{counters['comment']}", "author": "api", "body": body.get("body", ""), "created_at": _now()}
        counters["comment"] += 1
        t["comments"].append(c)
        t["updated_at"] = c["created_at"]
        return JSONResponse(c, status_code=201)

    async def close(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        t = find(request.path_params["id"])
        if not t:
            return _error(404, "not_found", f"ticket {request.path_params['id']} does not exist")
        if t["status"] == "closed":
            return _error(409, "already_closed", f"ticket {t['id']} is already closed")
        t["status"] = "closed"
        t["updated_at"] = _now()
        return JSONResponse(t)

    return Starlette(
        routes=[
            Route("/tickets", search, methods=["GET"]),
            Route("/tickets", create, methods=["POST"]),
            Route("/tickets/{id}", get, methods=["GET"]),
            Route("/tickets/{id}/comments", comment, methods=["POST"]),
            Route("/tickets/{id}/close", close, methods=["POST"]),
        ]
    )


def main() -> None:
    import uvicorn

    port = int(os.environ.get("FAKE_API_PORT", "4010"))
    print(f"fake helpdesk api listening on http://127.0.0.1:{port}", file=sys.stderr)
    uvicorn.run(create_fake_api(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
```

## Step 8: Tests

Replace the items tests. The HTTP transport test and smoke script only need their tool names and ids swapped (`helpdesk_get_ticket`, `tkt_2`, `tkt_404`).

### TypeScript: `test/tickets.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTestClient } from "./helpers.js";

const text = (r: { content: unknown }) => (r.content as Array<{ text: string }>)[0].text;

describe("helpdesk tools", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => { ctx = await connectTestClient(); });
  afterEach(async () => { await ctx.close(); });

  it("exposes the five designed tools", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "helpdesk_add_comment", "helpdesk_close_ticket", "helpdesk_create_ticket", "helpdesk_get_ticket", "helpdesk_search_tickets",
    ]);
    expect(tools.find((t) => t.name === "helpdesk_close_ticket")!.annotations?.destructiveHint).toBe(true);
  });

  it("search filters by status and pages with a cursor", async () => {
    const first = await ctx.client.callTool({ name: "helpdesk_search_tickets", arguments: { page_size: 2 } });
    const page1 = first.structuredContent as { tickets: Array<{ id: string }>; next_cursor: string | null };
    expect(page1.tickets.map((t) => t.id)).toEqual(["tkt_1", "tkt_2"]);
    expect(page1.next_cursor).toBe("2");
    expect(text(first)).toContain('cursor="2"');

    const second = await ctx.client.callTool({ name: "helpdesk_search_tickets", arguments: { page_size: 2, cursor: "2" } });
    expect((second.structuredContent as typeof page1).tickets.map((t) => t.id)).toEqual(["tkt_3"]);

    const closed = await ctx.client.callTool({ name: "helpdesk_search_tickets", arguments: { status: "closed" } });
    expect((closed.structuredContent as typeof page1).tickets.map((t) => t.id)).toEqual(["tkt_3"]);
  });

  it("get returns body and comments", async () => {
    const r = await ctx.client.callTool({ name: "helpdesk_get_ticket", arguments: { id: "tkt_2" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Looking into it.");
    expect((r.structuredContent as { comments: unknown[] }).comments).toHaveLength(1);
  });

  it("rejects an id that does not match the pattern before calling the API", async () => {
    const r = await ctx.client.callTool({ name: "helpdesk_get_ticket", arguments: { id: "123" } });
    expect(r.isError).toBe(true);
  });

  it("create, comment, close, then close again maps 409", async () => {
    const created = await ctx.client.callTool({
      name: "helpdesk_create_ticket",
      arguments: { subject: "Printer jam", body: "3rd floor printer", requester_email: "dee@example.com" },
    });
    const id = (created.structuredContent as { id: string; priority: string }).id;
    expect(id).toBe("tkt_4");
    expect((created.structuredContent as { priority: string }).priority).toBe("normal");

    const comment = await ctx.client.callTool({ name: "helpdesk_add_comment", arguments: { ticket_id: id, body: "On it." } });
    expect(comment.isError).toBeFalsy();

    const closed = await ctx.client.callTool({ name: "helpdesk_close_ticket", arguments: { id } });
    expect((closed.structuredContent as { status: string }).status).toBe("closed");

    const again = await ctx.client.callTool({ name: "helpdesk_close_ticket", arguments: { id } });
    expect(again.isError).toBe(true);
    expect(text(again)).toContain("already closed");
  });

  it("maps 401 without leaking the key", async () => {
    const bad = await connectTestClient({ apiKey: "bad-key" });
    try {
      const r = await bad.client.callTool({ name: "helpdesk_search_tickets", arguments: {} });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/authentication/i);
      expect(text(r)).not.toContain("bad-key");
    } finally {
      await bad.close();
    }
  });
});
```

### Python: `tests/test_tickets.py`

```python
import pytest
from mcp.server.mcpserver.exceptions import ToolError

pytestmark = pytest.mark.anyio


async def test_exposes_the_five_designed_tools(make_server):
    tools = await make_server().list_tools()
    assert sorted(t.name for t in tools) == [
        "helpdesk_add_comment", "helpdesk_close_ticket", "helpdesk_create_ticket", "helpdesk_get_ticket", "helpdesk_search_tickets",
    ]
    close = next(t for t in tools if t.name == "helpdesk_close_ticket")
    assert close.annotations.destructive_hint is True


async def test_search_filters_and_pages(make_server):
    mcp = make_server()
    first = await mcp.call_tool("helpdesk_search_tickets", {"page_size": 2})
    assert [t["id"] for t in first.structured_content["tickets"]] == ["tkt_1", "tkt_2"]
    assert first.structured_content["next_cursor"] == "2"
    second = await mcp.call_tool("helpdesk_search_tickets", {"page_size": 2, "cursor": "2"})
    assert [t["id"] for t in second.structured_content["tickets"]] == ["tkt_3"]
    closed = await mcp.call_tool("helpdesk_search_tickets", {"status": "closed"})
    assert [t["id"] for t in closed.structured_content["tickets"]] == ["tkt_3"]


async def test_get_returns_comments(make_server):
    r = await make_server().call_tool("helpdesk_get_ticket", {"id": "tkt_2"})
    assert r.structured_content["comments"][0]["body"] == "Looking into it."


async def test_bad_id_rejected_before_api_call(make_server):
    with pytest.raises(ToolError):
        await make_server().call_tool("helpdesk_get_ticket", {"id": "123"})


async def test_create_comment_close_and_409(make_server):
    mcp = make_server()
    created = await mcp.call_tool(
        "helpdesk_create_ticket",
        {"subject": "Printer jam", "body": "3rd floor printer", "requester_email": "dee@example.com"},
    )
    tid = created.structured_content["id"]
    assert tid == "tkt_4" and created.structured_content["priority"] == "normal"
    c = await mcp.call_tool("helpdesk_add_comment", {"ticket_id": tid, "body": "On it."})
    assert c.structured_content["id"] == "cmt_2"
    closed = await mcp.call_tool("helpdesk_close_ticket", {"id": tid})
    assert closed.structured_content["status"] == "closed"
    with pytest.raises(ToolError, match="already closed"):
        await mcp.call_tool("helpdesk_close_ticket", {"id": tid})


async def test_401_without_leaking_key(make_server):
    with pytest.raises(ToolError) as excinfo:
        await make_server(api_key="bad-key").call_tool("helpdesk_search_tickets", {})
    assert "authentication" in str(excinfo.value).lower() and "bad-key" not in str(excinfo.value)
```

Results when this guide was written:

| Suite | Result |
| --- | --- |
| TypeScript typecheck, vitest, build, stdio smoke | 9 tests passed, smoke passed |
| Python pytest | 9 tests passed |

## Step 9: Try it from a host

```bash
# Inspector, against the fake API
cd my-helpdesk-mcp && npm run build && npm run fake-api &
npx @modelcontextprotocol/inspector node dist/index.js

# Claude Code, against the real API
claude mcp add --transport stdio --scope local helpdesk \
  --env API_BASE_URL=https://helpdesk.example.com/v1 --env API_KEY=$HELPDESK_KEY \
  -- node /abs/path/my-helpdesk-mcp/dist/index.js
claude
```

Prompts to try, and what should happen:

| Prompt | Expected tool calls |
| --- | --- |
| "Any open tickets about login?" | `helpdesk_search_tickets` with `query: "login"`, `status: "open"` |
| "Show me tkt_2 in full" | `helpdesk_get_ticket` directly, no search |
| "Reply to tkt_2 that a refund is on its way" | `helpdesk_add_comment`; host may confirm |
| "Close tkt_2" | Claude asks for confirmation (description says to), then `helpdesk_close_ticket`; host confirms because of `destructiveHint` |
| "Delete tkt_3" | No tool fits; Claude says it cannot delete tickets |

If the model calls the wrong tool or fills an argument badly, edit the description, not the code, and try again.

## Step 10: Deploy

For a shared server, switch to HTTP and containerise:

```bash
docker build -t acme-helpdesk-mcp .
docker run --rm -p 3000:3000 \
  -e API_BASE_URL=https://helpdesk.example.com/v1 -e API_KEY=$HELPDESK_KEY \
  -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) -e MCP_ALLOWED_HOSTS=mcp.example.com \
  acme-helpdesk-mcp
```

Put TLS in front, register the URL with clients per `docs/05-deploy.md`, and work through `docs/07-checklist.md`.

## What changed, in total

| File | Lines touched | Why |
| --- | --- | --- |
| API client | replaced endpoint methods, one header | Real API shapes |
| `tools/errors` | new file, 30 lines | Shared mapping, named the API, added 409 |
| `tools/tickets` | new file, ~150 lines | Five designed tools |
| `server` | 5 lines | Name, instructions, registration |
| Fake API | replaced | Fixture matches the real API |
| Tests | replaced | Cover paging, validation, each write, 409, 401 |
| `.env` values | 2 | Real base URL and key |

Nothing in `config`, `http`, `index`/`__main__`, `log`, the Dockerfile, or CI changed. That is the intended split: the template owns transport and plumbing, you own the tool surface and the API client.
