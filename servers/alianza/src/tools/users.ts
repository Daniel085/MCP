import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UnifiedUser } from "../api-client.js";
import { withErrorHandling } from "./errors.js";
import type { ToolContext } from "./context.js";
import { pageShape, pagingHint, userShape, uuid } from "./schemas.js";

function describeUser(u: UnifiedUser): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || "(no name)";
  return `- ${u.id}: ${name}, account ${u.accountId}, created ${u.createdAt}`;
}

export function registerUserTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_list_users",
    {
      title: "List users",
      description:
        "List unified users, optionally within one account. Returns a page plus count, the total across all pages, " +
        "which is the number to use for seat counts. The list is eventually consistent (recent changes may lag); use " +
        "alianza_get_user for an exact read. Keep account_id, sort_by, and sort_order fixed while paging with a cursor.",
      inputSchema: {
        account_id: uuid.optional().describe("Account to list users for. Omit for every account visible to the token."),
        page_size: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
        sort_by: z.enum(["createdAt", "lastName", "firstName"]).default("createdAt"),
        sort_order: z.enum(["asc", "desc"]).default("asc"),
      },
      outputSchema: { entities: z.array(z.object(userShape)), count: z.number().int().optional(), ...pageShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account_id, page_size, cursor, sort_by, sort_order }) =>
      withErrorHandling(
        "alianza_list_users",
        async () => {
          const page = await ctx.api.listUsers({ accountId: account_id, pageSize: page_size, cursor, sortBy: sort_by, sortOrder: sort_order });
          const total = page.count !== undefined ? ` of ${page.count} total` : "";
          const text =
            page.entities.length === 0
              ? "No users matched."
              : `${page.entities.length} user(s)${total}:\n${page.entities.map(describeUser).join("\n")}${pagingHint(page.cursor, "cursor")}`;
          return {
            content: [{ type: "text", text }],
            structuredContent: { entities: page.entities, count: page.count, cursor: page.cursor, pageSize: page.pageSize },
          };
        },
        { path: "/users" },
      ),
  );

  server.registerTool(
    "alianza_get_user",
    {
      title: "Get user",
      description:
        "Fetch one user by id. Accepts the unified UUID or a native Alianza One user id. Always current, unlike the list. " +
        "A user the token may not see returns not-found.",
      inputSchema: { user_id: z.string().min(1).describe("Unified user UUID or native One id.") },
      outputSchema: userShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ user_id }) =>
      withErrorHandling(
        "alianza_get_user",
        async () => {
          const u = await ctx.api.getUser(user_id);
          return { content: [{ type: "text", text: describeUser(u) }], structuredContent: { ...u } };
        },
        { path: "/users" },
      ),
  );
}
