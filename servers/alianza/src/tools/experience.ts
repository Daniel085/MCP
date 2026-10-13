import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withErrorHandling } from "./errors.js";
import { errorResult, resolveExperienceId, type ToolContext } from "./context.js";
import { experienceIdInput, targetType, targetValueDescription, validateTarget } from "./schemas.js";

export function registerExperienceTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_check_assignability",
    {
      title: "Check assignability",
      description:
        "Check whether an Experience can be assigned to a target: a phone number (Virtual Agent), an account " +
        "(Post-Call), or a single user. Use this before creating a connection or assignment, or when the user asks " +
        "\"can we enable this for +1415...?\". Returns assignable=false when the target does not exist or is not eligible; " +
        "it does not explain why. Uses the partner's client credentials when configured.",
      inputSchema: {
        target_type: targetType.describe("ACCOUNT for Post-Call (all users), PHONE_NUMBER for Virtual Agent, USER to scope to one user."),
        target_value: z.string().min(1).describe(targetValueDescription),
        experience_id: experienceIdInput,
      },
      outputSchema: {
        experienceId: z.string(),
        targetType,
        targetValue: z.string(),
        assignable: z.boolean(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ target_type, target_value, experience_id }) =>
      withErrorHandling(
        "alianza_check_assignability",
        async () => {
          const bad = validateTarget(target_type, target_value);
          if (bad) return errorResult(bad);
          const experienceId = resolveExperienceId(ctx, experience_id);
          const result = await ctx.api.checkAssignability(experienceId, target_type, target_value);
          const text = result.assignable
            ? `${target_type} ${target_value} can be assigned to experience ${experienceId}.`
            : `${target_type} ${target_value} cannot be assigned to experience ${experienceId} (target missing or not eligible).`;
          return { content: [{ type: "text", text }], structuredContent: { ...result } };
        },
        { path: "/experience/experiences/assignability" },
      ),
  );
}
