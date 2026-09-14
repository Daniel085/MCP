/**
 * Business Line hunt groups: ring several Business Lines for one number.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type ApiClient } from "../api-client.js";
import type { HuntGroup, HuntGroupFailoverAction, HuntGroupFailoverReason, HuntingConfiguration } from "../alianza-types.js";
import { log } from "../log.js";
import { accountIdInput, compact, jsonText, normalizePhoneNumber, pageArray, partitionIdInput } from "./common.js";
import { ToolInputError, withErrorHandling } from "./errors.js";

const STRATEGIES = ["SIMULTANEOUS", "LINEAR", "SEQUENTIAL"] as const;
type Strategy = (typeof STRATEGIES)[number];

const groupIdInput = z.string().min(1).describe("Hunt group id (UUID from alianza_list_hunt_groups).");

const memberInput = z.object({
  businessLineId: z.string().min(1).describe("Business line id."),
  ringTimeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .describe("SEQUENTIAL only: seconds to ring this line before moving on (default 20)."),
});

const memberShape = z.object({
  businessLineId: z.string(),
  order: z.number().int().optional(),
  ringTimeoutSeconds: z.number().int().optional(),
});

const failoverShape = z
  .object({
    busy: z.string().optional(),
    noAnswer: z.string().optional(),
    unregistered: z.string().optional(),
  })
  .optional();

const groupShape = {
  id: z.string(),
  name: z.string(),
  strategy: z.enum(STRATEGIES).optional(),
  ringTimeoutSeconds: z.number().int().optional(),
  members: z.array(memberShape),
  activeForwardConfigurationId: z.string().optional(),
  failover: failoverShape,
};

function strategyOf(c: HuntingConfiguration): Strategy {
  switch (c["@type"]) {
    case "LinearHuntingConfiguration":
      return "LINEAR";
    case "SequentialHuntingConfiguration":
      return "SEQUENTIAL";
    case "SimultaneousHuntingConfiguration":
      return "SIMULTANEOUS";
  }
}

function membersOf(c: HuntingConfiguration): Array<{ businessLineId: string; order?: number; ringTimeoutSeconds?: number }> {
  switch (c["@type"]) {
    case "SimultaneousHuntingConfiguration":
      return (c.members ?? []).map((id, i) => ({ businessLineId: id, order: i }));
    case "LinearHuntingConfiguration":
      return [...(c.members ?? [])]
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((m) => ({ businessLineId: m.businessLineId, order: m.sequenceOrder }));
    case "SequentialHuntingConfiguration":
      return [...(c.members ?? [])]
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((m) => compact({ businessLineId: m.businessLineId, order: m.sequenceOrder, ringTimeoutSeconds: m.ringTimeoutSeconds }));
  }
}

function describeFailover(a: HuntGroupFailoverAction | undefined): string | undefined {
  if (!a) return undefined;
  switch (a["@type"]) {
    case "BusyFailoverAction":
      return "Busy";
    case "ForwardFailoverAction":
      return `Forward to ${a.forwardToPhoneNumber}`;
    case "VoicemailFailoverAction":
      return `Voicemail box ${a.voicemailBoxId}`;
  }
}

export function toGroupView(g: HuntGroup, failover?: Partial<Record<HuntGroupFailoverReason, HuntGroupFailoverAction>>) {
  const c = g.huntingConfiguration;
  return compact({
    id: g.id,
    name: g.name,
    strategy: c ? strategyOf(c) : undefined,
    ringTimeoutSeconds: c && "ringTimeoutSeconds" in c ? c.ringTimeoutSeconds : undefined,
    members: c ? membersOf(c) : [],
    activeForwardConfigurationId: g.activeForwardConfigurationId,
    failover: failover
      ? compact({
          busy: describeFailover(failover.BUSY),
          noAnswer: describeFailover(failover.NO_ANSWER),
          unregistered: describeFailover(failover.UNREGISTERED),
        })
      : undefined,
  });
}

function buildConfiguration(
  strategy: Strategy,
  members: Array<{ businessLineId: string; ringTimeoutSeconds?: number }>,
  ringTimeoutSeconds: number,
): HuntingConfiguration {
  if (members.length === 0) throw new ToolInputError("A hunt group needs at least one member business line.");
  switch (strategy) {
    case "SIMULTANEOUS":
      return { "@type": "SimultaneousHuntingConfiguration", ringTimeoutSeconds, members: members.map((m) => m.businessLineId) };
    case "LINEAR":
      return {
        "@type": "LinearHuntingConfiguration",
        ringTimeoutSeconds,
        members: members.map((m, i) => ({ businessLineId: m.businessLineId, sequenceOrder: i })),
      };
    case "SEQUENTIAL":
      return {
        "@type": "SequentialHuntingConfiguration",
        members: members.map((m, i) => ({
          businessLineId: m.businessLineId,
          sequenceOrder: i,
          ringTimeoutSeconds: m.ringTimeoutSeconds ?? ringTimeoutSeconds,
        })),
      };
  }
}

const REASONS: HuntGroupFailoverReason[] = ["BUSY", "NO_ANSWER", "UNREGISTERED"];

async function fetchFailover(api: ApiClient, pid: string, accountId: string, groupId: string) {
  const out: Partial<Record<HuntGroupFailoverReason, HuntGroupFailoverAction>> = {};
  await Promise.all(
    REASONS.map(async (reason) => {
      try {
        out[reason] = await api.getHuntGroupFailover(pid, accountId, groupId, reason);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        log.warn("hunt group failover lookup failed", { groupId, reason, error: err.message });
      }
    }),
  );
  return out;
}

export function registerHuntGroupTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_hunt_groups",
    {
      title: "List business line hunt groups",
      description:
        "List the Business Line hunt groups on an account: name, ring strategy (SIMULTANEOUS rings all members at " +
        "once, LINEAR rings them in order every call, SEQUENTIAL rings each in order for its own timeout), ring " +
        "timeout, and ordered member business line ids. Set includeFailover=true to also show what happens on " +
        "busy, no answer, and all-unregistered (one lookup each per group, first 25 groups). Route a number to a " +
        "group with alianza_set_phone_number_destination referenceType=BUSINESS_LINE_HUNT_GROUP. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        includeFailover: z.boolean().default(false).describe("Also fetch busy / no-answer / unregistered failover actions."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum groups to return."),
        offset: z.number().int().min(0).default(0).describe("Groups to skip for paging."),
      },
      outputSchema: {
        huntGroups: z.array(z.object(groupShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, includeFailover, limit, offset }) =>
      withErrorHandling("alianza_list_hunt_groups", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const raw = await api.listHuntGroups(pid, accountId);
        const { page: rawPage, text: hint } = pageArray(raw, limit, offset);
        const failovers = includeFailover
          ? await Promise.all(rawPage.slice(0, 25).map((g) => fetchFailover(api, pid, accountId, g.id)))
          : [];
        const page = rawPage.map((g, i) => toGroupView(g, failovers[i]));
        const lines = page.map(
          (g) =>
            `- ${g.id}: ${g.name} [${g.strategy ?? "?"}${g.ringTimeoutSeconds !== undefined ? ` ${g.ringTimeoutSeconds}s` : ""}] members: ${g.members.map((m) => m.businessLineId).join(", ") || "none"}` +
            (g.failover?.noAnswer ? ` no-answer: ${g.failover.noAnswer}` : ""),
        );
        const text = raw.length === 0 ? "This account has no hunt groups." : `${hint}\n${lines.join("\n")}`;
        return { content: [{ type: "text", text }], structuredContent: { huntGroups: page, total: raw.length, offset, limit } };
      }),
  );

  server.registerTool(
    "alianza_create_hunt_group",
    {
      title: "Create business line hunt group",
      description:
        "Create a hunt group that rings several Business Lines for one number. Members are business line ids in " +
        "ring order (order matters for LINEAR and SEQUENTIAL). SIMULTANEOUS rings every member for " +
        "ringTimeoutSeconds; LINEAR rings members one at a time in order for ringTimeoutSeconds each; SEQUENTIAL " +
        "rings each member for its own ringTimeoutSeconds. After creating, route a number to the group with " +
        "alianza_set_phone_number_destination and set failover with alianza_set_hunt_group_failover. Confirm " +
        "members and order with the user before calling.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        name: z.string().min(1).max(256).describe("Hunt group name, e.g. 'Sales ring group'."),
        strategy: z.enum(STRATEGIES).default("SIMULTANEOUS").describe("Ring strategy."),
        members: z.array(memberInput).min(1).describe("Member business lines in ring order."),
        ringTimeoutSeconds: z.number().int().min(1).max(600).default(20).describe("Ring time per step in seconds."),
      },
      outputSchema: groupShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, name, strategy, members, ringTimeoutSeconds }) =>
      withErrorHandling("alianza_create_hunt_group", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const created = await api.createHuntGroup(pid, accountId, {
          name,
          huntingConfiguration: buildConfiguration(strategy, members, ringTimeoutSeconds),
        });
        const out = toGroupView(created);
        log.info("hunt group created", { partitionId: pid, accountId, groupId: out.id, strategy });
        return {
          content: [
            {
              type: "text",
              text: `Created hunt group ${out.id} (${out.name}, ${out.strategy}, ${out.members.length} member(s)). Route a number to it with alianza_set_phone_number_destination referenceType=BUSINESS_LINE_HUNT_GROUP.\n${jsonText(out)}`,
            },
          ],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_update_hunt_group",
    {
      title: "Update business line hunt group",
      description:
        "Rename a hunt group, change its ring strategy or timeout, or replace its member list (pass the complete " +
        "new list in ring order; members not listed are removed). Fields you omit keep their current values. Use " +
        "alianza_list_hunt_groups to see the current members first. Reversible by calling again.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        huntGroupId: groupIdInput,
        name: z.string().min(1).max(256).optional().describe("New name."),
        strategy: z.enum(STRATEGIES).optional().describe("New ring strategy."),
        members: z.array(memberInput).min(1).optional().describe("Complete replacement member list in ring order."),
        ringTimeoutSeconds: z.number().int().min(1).max(600).optional().describe("New ring time per step in seconds."),
      },
      outputSchema: groupShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, huntGroupId, name, strategy, members, ringTimeoutSeconds }) =>
      withErrorHandling("alianza_update_hunt_group", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const current = await api.getHuntGroup(pid, accountId, huntGroupId);
        const currentView = toGroupView(current);
        const nextStrategy = strategy ?? currentView.strategy ?? "SIMULTANEOUS";
        const nextMembers =
          members ?? currentView.members.map((m) => compact({ businessLineId: m.businessLineId, ringTimeoutSeconds: m.ringTimeoutSeconds }));
        const nextTimeout = ringTimeoutSeconds ?? currentView.ringTimeoutSeconds ?? currentView.members[0]?.ringTimeoutSeconds ?? 20;
        const updated = await api.updateHuntGroup(pid, accountId, {
          ...current,
          name: name ?? current.name,
          huntingConfiguration: buildConfiguration(nextStrategy, nextMembers, nextTimeout),
        });
        const out = toGroupView(updated);
        log.info("hunt group updated", { partitionId: pid, accountId, groupId: huntGroupId });
        return {
          content: [{ type: "text", text: `Updated hunt group ${out.id} (${out.name}, ${out.strategy}, ${out.members.length} member(s)).\n${jsonText(out)}` }],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_set_hunt_group_failover",
    {
      title: "Set hunt group failover",
      description:
        "Set what a Business Line hunt group does when it cannot deliver a call: reason BUSY (all members busy), " +
        "NO_ANSWER (nobody picked up within the timeout), or UNREGISTERED (no member ATA online). Action BUSY " +
        "returns busy tone, FORWARD sends the call to forwardTo, VOICEMAIL drops it in voicemailBoxId (a business " +
        "line voicemail box on the account). Sets one reason per call; reversible.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        huntGroupId: groupIdInput,
        reason: z.enum(["BUSY", "NO_ANSWER", "UNREGISTERED"]).describe("Which failure to configure."),
        action: z.enum(["BUSY", "FORWARD", "VOICEMAIL"]).describe("What to do."),
        forwardTo: z.string().optional().describe("Number for action FORWARD."),
        voicemailBoxId: z.string().optional().describe("Voicemail box id for action VOICEMAIL."),
      },
      outputSchema: {
        huntGroupId: z.string(),
        reason: z.string(),
        action: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, huntGroupId, reason, action, forwardTo, voicemailBoxId }) =>
      withErrorHandling("alianza_set_hunt_group_failover", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        let body: HuntGroupFailoverAction;
        switch (action) {
          case "BUSY":
            body = { "@type": "BusyFailoverAction", failoverReason: reason };
            break;
          case "FORWARD":
            if (!forwardTo) throw new ToolInputError("action FORWARD needs forwardTo.");
            body = { "@type": "ForwardFailoverAction", failoverReason: reason, forwardToPhoneNumber: normalizePhoneNumber(forwardTo) };
            break;
          case "VOICEMAIL":
            if (!voicemailBoxId) throw new ToolInputError("action VOICEMAIL needs voicemailBoxId.");
            body = { "@type": "VoicemailFailoverAction", failoverReason: reason, voicemailBoxId };
            break;
        }
        const res = await api.setHuntGroupFailover(pid, accountId, huntGroupId, body);
        const out = { huntGroupId, reason, action: describeFailover(res) ?? action };
        log.info("hunt group failover updated", { partitionId: pid, accountId, groupId: huntGroupId, reason, action });
        return {
          content: [{ type: "text", text: `Hunt group ${huntGroupId} on ${reason}: ${out.action}.` }],
          structuredContent: out,
        };
      }),
  );
}
