import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";

export function registerAuthTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_auth_status",
    {
      title: "Alianza auth status",
      description:
        "Report which Alianza environment this server targets and which credentials it holds: client credentials " +
        "(for eligibility checks) and a user-context token (for connections, assignments, and users). Call this first " +
        "when another tool reports an authentication problem, or when the user asks which account or environment is in use. " +
        "Makes no API call.",
      inputSchema: {},
      outputSchema: {
        env: z.string(),
        apiBaseUrl: z.string(),
        authBaseUrl: z.string(),
        clientCredentials: z.boolean(),
        userToken: z.object({
          source: z.enum(["env-access-token", "token-file", "env-refresh-token", "none"]),
          expiresAt: z.string().optional(),
          scope: z.string().optional(),
          canRefresh: z.boolean(),
        }),
        tokenFile: z.string(),
        experienceId: z.string().nullable(),
        ready: z.object({ assignability: z.boolean(), userOperations: z.boolean() }),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const s = ctx.auth.status({ env: ctx.config.env, apiBaseUrl: ctx.config.apiBaseUrl, experienceId: ctx.config.experienceId });
      const userReady = s.userToken.source !== "none";
      const ready = { assignability: s.clientCredentials || userReady, userOperations: userReady };
      const lines = [
        `Environment: ${s.env} (${s.apiBaseUrl})`,
        `Default experience: ${s.experienceId ?? "not set (pass experience_id to each tool)"}`,
        `Client credentials: ${s.clientCredentials ? "configured" : "missing (set ALIANZA_CLIENT_ID and ALIANZA_CLIENT_SECRET)"}`,
        `User-context token: ${
          userReady
            ? `${s.userToken.source}${s.userToken.expiresAt ? `, expires ${s.userToken.expiresAt}` : ""}${s.userToken.canRefresh ? ", refreshable" : ", not refreshable"}`
            : "none. Run `alianza-mcp login` to authorise connections, assignments, and users."
        }`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: { ...s, ready } };
    },
  );
}
