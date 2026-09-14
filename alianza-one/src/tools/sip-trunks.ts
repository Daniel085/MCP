/**
 * SIP trunks (the siptrunk_2 API): registration-based trunks that carry
 * calls for a customer PBX.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { ApiError, type ApiClient } from "../api-client.js";
import type { SipTrunk, SipTrunkForwardReference, SipTrunkForwardRules } from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  jsonText,
  normalizePhoneNumber,
  pageArray,
  partitionIdInput,
  summarizeCallingPlans,
} from "./common.js";
import { ToolInputError, withErrorHandling } from "./errors.js";

const trunkIdInput = z.string().min(1).describe("SIP trunk id (from alianza_list_sip_trunks).");

const forwardShape = z
  .object({
    always: z.string().optional(),
    onFailure: z.array(z.string()).optional(),
    onCapacityExceeded: z.array(z.string()).optional(),
  })
  .optional();

const trunkShape = {
  id: z.string(),
  trunkName: z.string().optional(),
  sipUsername: z.string().optional(),
  sipProxyServer: z.string().optional(),
  concurrentCalls: z.number().optional(),
  maxBurstCalls: z.number().optional(),
  primaryTn: z.string().optional(),
  callbackNumber: z.string().optional(),
  telephoneNumbers: z.array(z.string()).optional(),
  localServicesEnabled: z.boolean().optional(),
  extensionPatterns: z.array(z.string()).optional(),
  ipBasedAuthEnabled: z.boolean().optional(),
  ipAddress: z.string().optional(),
  lockedOut: z.boolean().optional(),
  provisioningStatus: z.string().optional(),
  sipTrunkGroupId: z.string().optional(),
  callingPlans: z
    .array(
      z.object({
        callingPlanProductId: z.string().optional(),
        planMinutes: z.number().optional(),
        minutesRemaining: z.number().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .optional(),
  registered: z.boolean().optional(),
  forwarding: forwardShape,
};

function describeRef(r: SipTrunkForwardReference | undefined): string | undefined {
  if (!r) return undefined;
  if (r.enabled === false) return "disabled";
  return r.referenceId ? `${r.referenceType} ${r.referenceId}` : r.referenceType;
}

/** Never includes sipPassword. */
export function toTrunkView(
  t: SipTrunk,
  extra: { registered?: boolean; forward?: SipTrunkForwardRules } = {},
) {
  return compact({
    id: t.id,
    trunkName: t.trunkName,
    sipUsername: t.sipUsername,
    sipProxyServer: t.sipProxyServer,
    concurrentCalls: t.concurrentCalls,
    maxBurstCalls: t.maxBurstCalls,
    primaryTn: t.primaryTn,
    callbackNumber: t.callbackNumber,
    telephoneNumbers: t.telephoneNumbers,
    localServicesEnabled: t.localServicesEnabled,
    extensionPatterns: t.extensionPatterns,
    ipBasedAuthEnabled: t.ipBasedAuthEnabled,
    ipAddress: t.ipAddress,
    lockedOut: t.lockedOut,
    provisioningStatus: t.provisioningStatus,
    sipTrunkGroupId: t.sipTrunkGroupId,
    callingPlans: t.callingPlans ? summarizeCallingPlans(t.callingPlans) : undefined,
    registered: extra.registered,
    forwarding: extra.forward
      ? compact({
          always: describeRef(extra.forward.forwardAlways),
          onFailure: extra.forward.forwardOnFailure?.map(describeRef).filter((s): s is string => !!s),
          onCapacityExceeded: extra.forward.forwardOnCapacityExceeded?.map(describeRef).filter((s): s is string => !!s),
        })
      : undefined,
  });
}

const MAX_REGISTRATION_LOOKUPS = 25;

function generatePassword(): string {
  // 24 characters from an unambiguous alphabet; satisfies Alianza's 6+ minimum comfortably.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function registerSipTrunkTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_sip_trunks",
    {
      title: "List SIP trunks on an account",
      description:
        "List the SIP trunks on an account: trunk name, SIP username, concurrent call limit, primary number, E911 " +
        "callback number, numbers routed to the trunk, extension patterns, IP-auth settings, locked-out flag, and " +
        "calling plan minutes. Set includeRegistration=true to also report whether each trunk's PBX is currently " +
        "registered (first 25 trunks), the first check for 'the PBX cannot make calls'. Never returns the SIP " +
        "password. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        includeRegistration: z.boolean().default(false).describe("Also fetch SIP registration status per trunk."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum trunks to return."),
        offset: z.number().int().min(0).default(0).describe("Trunks to skip for paging."),
      },
      outputSchema: {
        sipTrunks: z.array(z.object(trunkShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, includeRegistration, limit, offset }) =>
      withErrorHandling("alianza_list_sip_trunks", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const raw = await api.listSipTrunks(pid, accountId);
        const { page: rawPage, text: hint } = pageArray(raw, limit, offset);
        let page = rawPage.map((t) => toTrunkView(t));
        if (includeRegistration) {
          const regs = await Promise.all(
            rawPage.slice(0, MAX_REGISTRATION_LOOKUPS).map(async (t) => {
              try {
                return (await api.getSipTrunkRegistration(pid, accountId, t.id)).registered;
              } catch (err) {
                log.warn("sip trunk registration lookup failed", { trunkId: t.id, error: String(err) });
                return undefined;
              }
            }),
          );
          page = rawPage.map((t, i) => toTrunkView(t, { registered: regs[i] }));
        }
        const lines = page.map(
          (t) =>
            `- ${t.id}: ${t.trunkName ?? "?"} (${t.sipUsername ?? "no username"}, ${t.concurrentCalls ?? "?"} calls` +
            (t.primaryTn ? `, primary ${t.primaryTn}` : "") +
            ")" +
            (t.lockedOut ? " LOCKED OUT" : "") +
            (t.registered === undefined ? "" : t.registered ? " REGISTERED" : " NOT REGISTERED"),
        );
        const text = raw.length === 0 ? "This account has no SIP trunks." : `${hint}\n${lines.join("\n")}`;
        return { content: [{ type: "text", text }], structuredContent: { sipTrunks: page, total: raw.length, offset, limit } };
      }),
  );

  server.registerTool(
    "alianza_get_sip_trunk",
    {
      title: "Get SIP trunk",
      description:
        "Fetch one SIP trunk with its settings, live registration status, and forwarding rules (forward always, on " +
        "failure/unreachable, on capacity exceeded). Use alianza_list_sip_trunks to find the id. Never returns the " +
        "SIP password. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        sipTrunkId: trunkIdInput,
      },
      outputSchema: trunkShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, sipTrunkId }) =>
      withErrorHandling("alianza_get_sip_trunk", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const trunk = await api.getSipTrunk(pid, accountId, sipTrunkId);
        const [reg, forward] = await Promise.all([
          api.getSipTrunkRegistration(pid, accountId, sipTrunkId).catch((err: unknown) => {
            if (!(err instanceof ApiError)) throw err;
            log.warn("sip trunk registration lookup failed", { trunkId: sipTrunkId, error: err.message });
            return undefined;
          }),
          api.getSipTrunkForwardRules(pid, accountId, sipTrunkId).catch((err: unknown) => {
            if (!(err instanceof ApiError)) throw err;
            log.warn("sip trunk forward lookup failed", { trunkId: sipTrunkId, error: err.message });
            return undefined;
          }),
        ]);
        const out = toTrunkView(trunk, { registered: reg?.registered, forward });
        return { content: [{ type: "text", text: jsonText(out) }], structuredContent: out };
      }),
  );

  server.registerTool(
    "alianza_create_sip_trunk",
    {
      title: "Create SIP trunk",
      description:
        "Create a registration-based SIP trunk on an existing account for a customer PBX. Needs a unique trunk name, " +
        "a SIP username (8-36 characters), and the number of concurrent call paths. If sipPassword is omitted a " +
        "strong random one is generated. The response includes the SIP password ONCE so it can be entered into " +
        "the PBX; it cannot be read back later, so hand it to the user immediately and do not store it elsewhere. " +
        "primaryTn (routes 7-digit dialing and local services, not caller id) and callbackNumber (E911) must be " +
        "numbers on the account. Route numbers to the trunk afterwards with alianza_set_phone_number_destination " +
        "referenceType=SIP_TRUNK. Confirm details with the user before calling; trunks may incur billing.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        trunkName: z.string().min(1).max(256).describe("Unique name for the trunk, e.g. 'HQ PBX'."),
        sipUsername: z
          .string()
          .min(8)
          .max(36)
          .regex(/^[A-Za-z0-9\-_.]+$/, "letters, digits, - _ . only")
          .describe("SIP registration username, 8-36 characters, globally unique."),
        sipPassword: z.string().min(6).max(64).optional().describe("SIP registration password. Omit to generate one."),
        concurrentCalls: z.number().int().min(1).max(10000).describe("Concurrent call paths, at least 1."),
        primaryTn: z.string().optional().describe("Primary number on the account for 7-digit dialing and local services."),
        callbackNumber: z.string().optional().describe("E911 callback number; must be on the account."),
        localServicesEnabled: z.boolean().default(false).describe("Allow dialing 211/311/811 style local services."),
        extensionPatterns: z
          .array(z.string().regex(/^\d+[xX]*$/, "digits optionally followed by x wildcards"))
          .optional()
          .describe("Account extension ranges routed to the trunk, e.g. [\"21XX\", \"3000\"]."),
      },
      outputSchema: {
        ...trunkShape,
        sipPassword: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, trunkName, sipUsername, sipPassword, concurrentCalls, primaryTn, callbackNumber, localServicesEnabled, extensionPatterns }) =>
      withErrorHandling("alianza_create_sip_trunk", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const password = sipPassword ?? generatePassword();
        const body: Partial<SipTrunk> = compact({
          trunkName,
          sipUsername,
          sipPassword: password,
          concurrentCalls,
          primaryTn: primaryTn ? normalizePhoneNumber(primaryTn) : undefined,
          callbackNumber: callbackNumber ? normalizePhoneNumber(callbackNumber) : undefined,
          localServicesEnabled,
          extensionPatterns: extensionPatterns?.map((p) => p.toUpperCase()),
        });
        if (extensionPatterns?.some((p) => p.replace(/x/gi, "").length === 0)) {
          throw new ToolInputError("extensionPatterns must start with at least one digit.");
        }
        const created = await api.createSipTrunk(pid, accountId, body);
        const out = { ...toTrunkView(created), sipPassword: password };
        log.info("sip trunk created", { partitionId: pid, accountId, trunkId: out.id });
        const { sipPassword: _pw, ...safe } = out;
        return {
          content: [
            {
              type: "text",
              text:
                `Created SIP trunk ${out.id} (${out.trunkName}). Register the PBX with username ${out.sipUsername}` +
                (out.sipProxyServer ? ` against ${out.sipProxyServer}` : "") +
                `. SIP password (shown once, give it to the user now): ${password}\n${jsonText(safe)}`,
            },
          ],
          structuredContent: out,
        };
      }),
  );
}
