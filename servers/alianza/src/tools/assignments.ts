import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type Assignment } from "../api-client.js";
import { log } from "../log.js";
import { withErrorHandling } from "./errors.js";
import { errorResult, resolveExperienceId, type ToolContext } from "./context.js";
import {
  assignmentShape,
  cursorInput,
  deletedShape,
  EXAMPLE_UUID,
  experienceIdInput,
  idInput,
  pageShape,
  pageSizeInput,
  pagingHint,
  targetType,
  targetValueDescription,
  validateTarget,
} from "./schemas.js";

export function describeAssignment(a: Assignment): string {
  return `- ${a.id}: ${a.targetType} ${a.targetValue} (account ${a.accountId}, experience ${a.experienceId}, updated ${a.updatedAt})`;
}

/** Create an assignment, or return the existing one when Alianza answers 409. */
export async function createOrFindAssignment(
  ctx: ToolContext,
  experienceId: string,
  targetType: Assignment["targetType"],
  targetValue: string,
): Promise<{ assignment: Assignment; created: boolean }> {
  try {
    const assignment = await ctx.api.createAssignment({ experienceId, targetType, targetValue });
    log.info("assignment created", { id: assignment.id, targetType: assignment.targetType });
    return { assignment, created: true };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
    const page = await ctx.api.listAssignments({ targetType, targetValue, pageSize: 50 });
    const existing = page.entities.find((a) => a.experienceId === experienceId);
    if (!existing) throw err;
    return { assignment: existing, created: false };
  }
}

export function registerAssignmentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "alianza_list_assignments",
    {
      title: "List assignments",
      description:
        "List Experience Assignments (which accounts, phone numbers, or users an Experience is enabled for). " +
        "At least one filter is required: account_id (optionally with experience_id and/or target_type), or " +
        "target_type with target_value. Use this to answer \"is +1415... assigned?\" or \"what is enabled on account X?\". " +
        "Returns a page of assignments and a cursor when more exist.",
      inputSchema: {
        account_id: idInput("Account").optional().describe(`Account that owns the targets (UUID), e.g. ${EXAMPLE_UUID}.`),
        experience_id: idInput("Experience").optional().describe(`Restrict to one Experience id (UUID), e.g. ${EXAMPLE_UUID}. Requires account_id. Omit to list every Experience's assignments.`),
        target_type: targetType.optional().describe("Restrict to one target type. Required when target_value is given."),
        target_value: z.string().optional().describe(targetValueDescription),
        page_size: pageSizeInput(100),
        cursor: cursorInput,
      },
      outputSchema: { entities: z.array(z.object(assignmentShape)), ...pageShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account_id, experience_id, target_type, target_value, page_size, cursor }) =>
      withErrorHandling(
        "alianza_list_assignments",
        async () => {
          if (experience_id && !account_id) return errorResult("experience_id requires account_id.");
          if (target_value && !target_type) return errorResult("target_type is required when target_value is given.");
          if (!account_id && !target_value) return errorResult("Provide account_id, or target_type with target_value.");
          if (target_type && target_value) {
            const bad = validateTarget(target_type, target_value);
            if (bad) return errorResult(bad);
          }
          const page = await ctx.api.listAssignments({
            accountId: account_id,
            experienceId: experience_id,
            targetType: target_type,
            targetValue: target_value,
            pageSize: page_size,
            cursor,
          });
          const text =
            page.entities.length === 0
              ? "No assignments matched."
              : `${page.entities.length} assignment(s):\n${page.entities.map(describeAssignment).join("\n")}${pagingHint(page.cursor, "cursor")}`;
          return { content: [{ type: "text", text }], structuredContent: { entities: page.entities, cursor: page.cursor, pageSize: page.pageSize } };
        },
        { path: "/experience/assignments" },
      ),
  );

  server.registerTool(
    "alianza_get_assignment",
    {
      title: "Get assignment",
      description: "Fetch one Experience Assignment by its id. Use alianza_list_assignments when you only know the target.",
      inputSchema: { assignment_id: idInput("Assignment") },
      outputSchema: assignmentShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ assignment_id }) =>
      withErrorHandling(
        "alianza_get_assignment",
        async () => {
          const a = await ctx.api.getAssignment(assignment_id);
          return { content: [{ type: "text", text: describeAssignment(a) }], structuredContent: { ...a } };
        },
        { path: "/experience/assignments" },
      ),
  );

  server.registerTool(
    "alianza_create_assignment",
    {
      title: "Create assignment",
      description:
        "Assign an Experience to a target so it applies to that target's calls once the account's connection is ACTIVE. " +
        "Post-Call uses ACCOUNT (all current and future users); Virtual Agent uses PHONE_NUMBER; USER narrows to one user. " +
        "The account must already have a connection for this Experience (see alianza_create_connection), or use " +
        "alianza_enable_experience to do the whole flow. If the assignment already exists, returns it instead of failing. " +
        "Confirm the target with the user first.",
      inputSchema: {
        target_type: targetType.describe("ACCOUNT for Post-Call (all users), PHONE_NUMBER for Virtual Agent, USER to scope to one user."),
        target_value: z.string().min(1).describe(targetValueDescription),
        experience_id: experienceIdInput,
      },
      outputSchema: { ...assignmentShape, created: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ target_type, target_value, experience_id }) =>
      withErrorHandling(
        "alianza_create_assignment",
        async () => {
          const bad = validateTarget(target_type, target_value);
          if (bad) return errorResult(bad);
          const experienceId = resolveExperienceId(ctx, experience_id);
          const { assignment: a, created } = await createOrFindAssignment(ctx, experienceId, target_type, target_value);
          const text = created
            ? `Created assignment ${a.id}: ${a.targetType} ${a.targetValue} on account ${a.accountId}.`
            : `That assignment already exists:\n${describeAssignment(a)}`;
          return { content: [{ type: "text", text }], structuredContent: { ...a, created } };
        },
        { path: "/experience/assignments" },
      ),
  );

  server.registerTool(
    "alianza_delete_assignment",
    {
      title: "Delete assignment",
      description:
        "Remove an Experience Assignment. Calls to that target stop flowing to the Experience immediately. " +
        "Ask the user to confirm, and prefer deactivating the connection (alianza_set_connection_state INACTIVE) when the " +
        "intent is to pause the whole account rather than remove one target.",
      inputSchema: { assignment_id: idInput("Assignment") },
      outputSchema: deletedShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ assignment_id }) =>
      withErrorHandling(
        "alianza_delete_assignment",
        async () => {
          await ctx.api.deleteAssignment(assignment_id);
          log.info("assignment deleted", { id: assignment_id });
          return { content: [{ type: "text", text: `Deleted assignment ${assignment_id}.` }], structuredContent: { id: assignment_id, deleted: true } };
        },
        { path: "/experience/assignments", verb: "delete" },
      ),
  );
}
