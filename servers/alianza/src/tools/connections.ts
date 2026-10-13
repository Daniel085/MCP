import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type Connection } from "../api-client.js";
import { log } from "../log.js";
import { withErrorHandling } from "./errors.js";
import { errorResult, resolveExperienceId, type ToolContext } from "./context.js";
import { connectionShape, e164, experienceIdInput, pageShape, pagingHint, settableState, uuid } from "./schemas.js";

export function describeConnection(c: Connection): string {
  const legacy = c.state === "CONNECTED" ? " (legacy value, behaves as INACTIVE)" : "";
  return `- ${c.id}: ${c.state}${legacy}, account ${c.accountName ? `${c.accountName} (${c.accountId})` : c.accountId}, experience ${c.experienceId}, updated ${c.updatedAt}`;
}

/** Find the connection for a phone number's account and an experience, or null. */
export async function findConnection(ctx: ToolContext, telephoneNumber: string, experienceId: string): Promise<Connection | null> {
  const page = await ctx.api.listConnections({ telephoneNumber, experienceId, pageSize: 10 });
  return page.entities.find((c) => c.experienceId === experienceId) ?? page.entities[0] ?? null;
}

export function registerConnectionTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_list_connections",
    {
      title: "List connections",
      description:
        "List Experience Connections for an account. A connection links an Experience to one Alianza account and its " +
        "state (ACTIVE/INACTIVE) controls whether media flows for that account's assigned targets. Identify the account by " +
        "account_id or by any telephone_number on it. Use this to answer \"is our experience connected/active for this customer?\".",
      inputSchema: {
        account_id: uuid.optional().describe("Account id. If given, telephone_number is ignored."),
        telephone_number: e164.optional().describe("Any phone number on the account, E.164. Used when account_id is unknown."),
        experience_id: uuid.optional().describe("Restrict to one Experience."),
        page_size: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      },
      outputSchema: { entities: z.array(z.object(connectionShape)), ...pageShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account_id, telephone_number, experience_id, page_size, cursor }) =>
      withErrorHandling(
        "alianza_list_connections",
        async () => {
          if (!account_id && !telephone_number) return errorResult("Provide account_id or telephone_number.");
          const page = await ctx.api.listConnections({
            accountId: account_id,
            telephoneNumber: account_id ? undefined : telephone_number,
            experienceId: experience_id,
            pageSize: page_size,
            cursor,
          });
          const text =
            page.entities.length === 0
              ? "No connections found for that account."
              : `${page.entities.length} connection(s):\n${page.entities.map(describeConnection).join("\n")}${pagingHint(page.cursor, "cursor")}`;
          return { content: [{ type: "text", text }], structuredContent: { entities: page.entities, cursor: page.cursor, pageSize: page.pageSize } };
        },
        { path: "/experience/connections" },
      ),
  );

  server.registerTool(
    "alianza_get_connection",
    {
      title: "Get connection",
      description: "Fetch one Experience Connection by id. Use alianza_list_connections when you only know the account or a phone number.",
      inputSchema: { connection_id: uuid.describe("Connection id (UUID).") },
      outputSchema: connectionShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ connection_id }) =>
      withErrorHandling(
        "alianza_get_connection",
        async () => {
          const c = await ctx.api.getConnection(connection_id);
          return { content: [{ type: "text", text: describeConnection(c) }], structuredContent: { ...c } };
        },
        { path: "/experience/connections" },
      ),
  );

  server.registerTool(
    "alianza_create_connection",
    {
      title: "Create connection",
      description:
        "Create an Experience Connection for the account that owns telephone_number. Alianza resolves the account from " +
        "the number. Creates it INACTIVE by default so you can add assignments first, then activate with " +
        "alianza_set_connection_state. If a connection already exists, returns the existing one instead of failing. " +
        "For the complete onboarding flow use alianza_enable_experience.",
      inputSchema: {
        telephone_number: e164.describe("Any phone number on the customer's account, E.164."),
        experience_id: experienceIdInput,
        state: settableState.default("INACTIVE").describe("Initial state. Keep INACTIVE until assignments exist."),
      },
      outputSchema: { ...connectionShape, created: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ telephone_number, experience_id, state }) =>
      withErrorHandling(
        "alianza_create_connection",
        async () => {
          const experienceId = resolveExperienceId(ctx, experience_id);
          try {
            const c = await ctx.api.createConnection(telephone_number, { experienceId, state });
            log.info("connection created", { id: c.id, accountId: c.accountId, state: c.state });
            return {
              content: [{ type: "text", text: `Created connection ${c.id} (${c.state}) for account ${c.accountName ?? c.accountId} (${c.accountId}). Use accountId ${c.accountId} for assignments.` }],
              structuredContent: { ...c, created: true },
            };
          } catch (err) {
            if (!(err instanceof ApiError) || err.status !== 409) throw err;
            const existing = await findConnection(ctx, telephone_number, experienceId);
            if (!existing) throw err;
            return {
              content: [{ type: "text", text: `A connection already exists for that account and experience:\n${describeConnection(existing)}` }],
              structuredContent: { ...existing, created: false },
            };
          }
        },
        { path: "/experience/connections" },
      ),
  );

  server.registerTool(
    "alianza_set_connection_state",
    {
      title: "Set connection state",
      description:
        "Activate or deactivate an Experience Connection. ACTIVE makes the Experience live for every assigned target on " +
        "the account (Alianza starts sending SIPREC or routing SIP calls); INACTIVE pauses it without removing assignments. " +
        "Confirm with the user before activating. If the connection is already in the requested state, reports that and " +
        "makes no change.",
      inputSchema: {
        connection_id: uuid.describe("Connection id (UUID)."),
        state: settableState,
      },
      outputSchema: { ...connectionShape, changed: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ connection_id, state }) =>
      withErrorHandling(
        "alianza_set_connection_state",
        async () => {
          const current = await ctx.api.getConnection(connection_id);
          const effective = current.state === "CONNECTED" ? "INACTIVE" : current.state;
          if (effective === state) {
            return {
              content: [{ type: "text", text: `Connection ${current.id} is already ${state}. No change made.` }],
              structuredContent: { ...current, changed: false },
            };
          }
          const updated = await ctx.api.updateConnection(connection_id, { ...current, state });
          log.info("connection state changed", { id: updated.id, from: current.state, to: updated.state });
          return {
            content: [{ type: "text", text: `Connection ${updated.id} is now ${updated.state} (was ${current.state}).` }],
            structuredContent: { ...updated, changed: true },
          };
        },
        { path: "/experience/connections" },
      ),
  );

  server.registerTool(
    "alianza_delete_connection",
    {
      title: "Delete connection",
      description:
        "Delete an Experience Connection record. The Experience stops for the whole account. Prefer " +
        "alianza_set_connection_state INACTIVE to pause; delete only when the user explicitly wants the connection removed. " +
        "Ask the user to confirm.",
      inputSchema: { connection_id: uuid.describe("Connection id (UUID).") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ connection_id }) =>
      withErrorHandling(
        "alianza_delete_connection",
        async () => {
          await ctx.api.deleteConnection(connection_id);
          log.info("connection deleted", { id: connection_id });
          return { content: [{ type: "text", text: `Deleted connection ${connection_id}.` }] };
        },
        { path: "/experience/connections" },
      ),
  );
}
