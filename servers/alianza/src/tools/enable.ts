/**
 * The composite onboarding tool: the four-step flow from the Post-Call and
 * Virtual Agent guides, with the 409 handling a model would otherwise get wrong.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log } from "../log.js";
import { createOrFindAssignment } from "./assignments.js";
import { createOrFindConnection } from "./connections.js";
import { errorResult, resolveExperienceId, type ToolContext } from "./context.js";
import { withErrorHandling } from "./errors.js";
import { assignmentShape, connectionShape, experienceIdInput, phoneInput, targetType, targetValueDescription, validateTarget } from "./schemas.js";

export function registerEnableTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_enable_experience",
    {
      title: "Enable experience for a customer",
      description:
        "Run the full onboarding flow to turn the Experience on for a customer: (1) check assignability, (2) create the " +
        "account's connection INACTIVE or reuse the existing one, (3) create the assignment or reuse the existing one, " +
        "(4) activate the connection. Use this when the user says \"enable/turn on/onboard our experience for " +
        "<number or account>\". Post-Call: target_type ACCOUNT (default; target_value is resolved from the phone number's " +
        "account, so it can be omitted). Virtual Agent: target_type PHONE_NUMBER. USER: target_value (the user id) is required. " +
        "Safe to re-run; it reports what already existed, and it will re-activate a connection that was paused. " +
        "Confirm the customer and target with the user before calling, because activation starts media flow.",
      inputSchema: {
        telephone_number: phoneInput("A phone number on the customer's account").describe("A phone number on the customer's account, E.164, e.g. +14155551234. Resolves the account and, for PHONE_NUMBER targets, is the target itself unless target_value is given."),
        target_type: targetType.default("ACCOUNT").describe("ACCOUNT for Post-Call, PHONE_NUMBER for Virtual Agent, USER for a single user."),
        target_value: z.string().optional().describe(`Optional. ${targetValueDescription} Defaults: ACCOUNT uses the resolved account id; PHONE_NUMBER uses telephone_number.`),
        experience_id: experienceIdInput,
      },
      outputSchema: {
        connection: z.object(connectionShape),
        assignment: z.object(assignmentShape),
        steps: z.array(z.object({ step: z.string(), outcome: z.string() })),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ telephone_number, target_type, target_value, experience_id }) =>
      withErrorHandling("alianza_enable_experience", async () => {
        const experienceId = resolveExperienceId(ctx, experience_id);
        const steps: Array<{ step: string; outcome: string }> = [];

        if (target_type === "USER" && !target_value) {
          return errorResult("target_value (the user id) is required when target_type is USER.");
        }
        // Step 1: assignability. For ACCOUNT we do not know the id yet, so check the number.
        const checkType = target_type === "ACCOUNT" && !target_value ? "PHONE_NUMBER" : target_type;
        const checkValue = target_value ?? telephone_number;
        const bad = validateTarget(checkType, checkValue);
        if (bad) return errorResult(bad);
        const check = await ctx.api.checkAssignability(experienceId, checkType, checkValue);
        if (!check.assignable) {
          return errorResult(`Stopped: ${checkType} ${checkValue} is not assignable to experience ${experienceId} (target missing or not eligible). Nothing was changed.`);
        }
        steps.push({ step: "check assignability", outcome: `${checkType} ${checkValue} is assignable` });

        // Step 2: connection (create INACTIVE or reuse).
        const found = await createOrFindConnection(ctx, telephone_number, experienceId, "INACTIVE");
        let connection = found.connection;
        steps.push({
          step: "connection",
          outcome: found.created
            ? `created ${connection.id} (INACTIVE) for account ${connection.accountName ?? connection.accountId}`
            : `reused existing ${connection.id} (${connection.state})`,
        });

        // Step 3: assignment (create or reuse).
        const finalTarget = target_value ?? (target_type === "ACCOUNT" ? connection.accountId : telephone_number);
        const targetProblem = validateTarget(target_type, finalTarget);
        if (targetProblem) return errorResult(targetProblem);
        const { assignment, created } = await createOrFindAssignment(ctx, experienceId, target_type, finalTarget);
        steps.push({
          step: "assignment",
          outcome: created ? `created ${assignment.id} for ${target_type} ${finalTarget}` : `reused existing ${assignment.id}`,
        });

        // Step 4: activate.
        if (connection.state === "ACTIVE") {
          steps.push({ step: "activate", outcome: "connection was already ACTIVE" });
        } else {
          connection = await ctx.api.updateConnection(connection.id, { ...connection, state: "ACTIVE" });
          steps.push({ step: "activate", outcome: `connection ${connection.id} is now ACTIVE` });
        }
        log.info("experience enabled", { connectionId: connection.id, assignmentId: assignment.id, targetType: target_type });

        const text =
          `Experience ${experienceId} is enabled for ${target_type} ${finalTarget} on account ${connection.accountName ?? connection.accountId} (${connection.accountId}).\n` +
          steps.map((s, i) => `${i + 1}. ${s.step}: ${s.outcome}`).join("\n");
        return { content: [{ type: "text", text }], structuredContent: { connection, assignment, steps } };
      }),
  );
}
