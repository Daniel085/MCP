/**
 * Business Lines: line-centric analog service on ATA ports. A telephone
 * number references a line directly, or a hunt group that rings several.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type ApiClient } from "../api-client.js";
import type {
  BusinessLineCallHandling,
  BusinessLineExpanded,
  BusinessLinePortAssignment,
  RingFailoverAction,
  RingTimeoutConfiguration,
} from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  jsonText,
  normalizeMacAddress,
  normalizePhoneNumber,
  pageArray,
  partitionIdInput,
  phoneNumberInput,
} from "./common.js";
import { ToolInputError, withErrorHandling } from "./errors.js";

const lineIdInput = z.string().min(1).describe("Business line id (UUID from alianza_list_business_lines).");

const callHandlingShape = z
  .object({
    mode: z.string().optional(),
    forwardTo: z.string().optional(),
    callWaiting: z.boolean().optional(),
    busy: z.string().optional(),
    unregistered: z.string().optional(),
    noAnswer: z.string().optional(),
    voicemailBoxId: z.string().optional(),
  })
  .optional();

const deviceShape = z
  .object({
    deviceTypeId: z.string().optional(),
    macAddress: z.string().optional(),
    portNumber: z.number().optional(),
    faxEnabled: z.boolean().optional(),
  })
  .optional();

const lineShape = {
  id: z.string(),
  name: z.string().optional(),
  callerIdPhoneNumber: z.string().optional(),
  callerIdName: z.string().optional(),
  callerIdVisible: z.boolean().optional(),
  emergencyCallbackPhoneNumber: z.string().optional(),
  sipUsername: z.string().optional(),
  callHandling: callHandlingShape,
  device: deviceShape,
  registered: z.boolean().optional(),
  lockedOut: z.boolean().optional(),
};

function describeFailover(a: RingFailoverAction | undefined): string | undefined {
  if (!a) return undefined;
  switch (a["@type"]) {
    case "BusyRingFailoverAction":
      return "Busy";
    case "VoicemailRingFailoverAction":
      return "Voicemail";
    case "ForwardRingFailoverAction":
      return `Forward to ${a.forwardToPhoneNumber}`;
  }
}

function describeTimeout(t: RingTimeoutConfiguration | undefined): string | undefined {
  if (!t) return undefined;
  if (t["@type"] === "UnlimitedRingTimeoutConfiguration") return "Ring forever";
  return `${describeFailover(t.noAnswerAction)} after ${t.timeoutSeconds ?? "?"}s`;
}

export function toLineView(l: BusinessLineExpanded, reg?: { registered?: boolean; lockedOut?: boolean }) {
  const ch = l.callHandling;
  return compact({
    id: l.id,
    name: l.name,
    callerIdPhoneNumber: l.callerIdPhoneNumber,
    callerIdName: l.callerIdName ?? l.cname,
    callerIdVisible: l.callerIdVisible,
    emergencyCallbackPhoneNumber: l.emergencyCallbackPhoneNumber,
    sipUsername: l.sipCredentials?.sipUsername,
    callHandling: ch
      ? compact({
          mode: ch.activeCallHandling,
          forwardTo: ch.forwardToPhoneNumber,
          callWaiting: ch.callWaitingEnabled,
          busy: describeFailover(ch.busyFailoverAction),
          unregistered: describeFailover(ch.unregisteredFailoverAction),
          noAnswer: describeTimeout(ch.ringTimeoutConfiguration),
          voicemailBoxId: ch.voicemailBoxId,
        })
      : undefined,
    device: l.device
      ? compact({
          deviceTypeId: l.device.deviceTypeId,
          macAddress: l.device.macAddress,
          portNumber: l.device.portNumber,
          faxEnabled: l.device.faxEnabled,
        })
      : undefined,
    registered: reg?.registered,
    lockedOut: reg?.lockedOut,
  });
}

const MAX_REGISTRATION_LOOKUPS = 25;

const failoverActionInput = z.enum(["BUSY", "VOICEMAIL", "FORWARD"]);

function buildFailover(action: "BUSY" | "VOICEMAIL" | "FORWARD", forwardTo: string | undefined, label: string): RingFailoverAction {
  switch (action) {
    case "BUSY":
      return { "@type": "BusyRingFailoverAction" };
    case "VOICEMAIL":
      return { "@type": "VoicemailRingFailoverAction" };
    case "FORWARD":
      if (!forwardTo) throw new ToolInputError(`${label} is FORWARD, so a forward-to number is required.`);
      return { "@type": "ForwardRingFailoverAction", forwardToPhoneNumber: normalizePhoneNumber(forwardTo) };
  }
}

export function registerBusinessLineTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_business_lines",
    {
      title: "List business lines on an account",
      description:
        "List the Business Lines (analog lines on ATA ports, used by the line-centric Business Lines product) on an " +
        "account with caller id number, E911 callback number, call handling summary (ring/forward, busy, no-answer, " +
        "out-of-service actions), the ATA device and port each line sits on, and its SIP username. Set " +
        "includeRegistration=true to also check whether each line's ATA is registered (first 25 lines). Business " +
        "Lines are separate from end users and device lines; for BCC/Home Phone accounts use alianza_list_users " +
        "and alianza_list_devices instead. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        includeRegistration: z.boolean().default(false).describe("Also fetch SIP registration status per line."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum lines to return."),
        offset: z.number().int().min(0).default(0).describe("Lines to skip for paging."),
      },
      outputSchema: {
        businessLines: z.array(z.object(lineShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, includeRegistration, limit, offset }) =>
      withErrorHandling("alianza_list_business_lines", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const raw = await api.listBusinessLinesExpanded(pid, accountId);
        const { page: rawPage, text: hint } = pageArray(raw, limit, offset);
        let page = rawPage.map((l) => toLineView(l));
        if (includeRegistration) {
          const regs = await Promise.all(
            rawPage.slice(0, MAX_REGISTRATION_LOOKUPS).map(async (l) => {
              try {
                return await api.getBusinessLineRegistration(pid, accountId, l.id);
              } catch (err) {
                log.warn("business line registration lookup failed", { lineId: l.id, error: String(err) });
                return undefined;
              }
            }),
          );
          page = rawPage.map((l, i) => toLineView(l, regs[i]));
        }
        const lines = page.map(
          (l) =>
            `- ${l.id}: ${l.name ?? "?"} cid ${l.callerIdPhoneNumber ?? "none"}` +
            (l.device ? ` on ${l.device.deviceTypeId ?? "?"} ${l.device.macAddress ?? ""} port ${l.device.portNumber ?? "?"}` : " (no port assigned)") +
            (l.callHandling?.mode ? ` [${l.callHandling.mode}${l.callHandling.forwardTo ? ` -> ${l.callHandling.forwardTo}` : ""}]` : "") +
            (l.registered === undefined ? "" : l.registered ? " REGISTERED" : " NOT REGISTERED"),
        );
        const text = raw.length === 0 ? "This account has no business lines." : `${hint}\n${lines.join("\n")}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { businessLines: page, total: raw.length, offset, limit },
        };
      }),
  );

  server.registerTool(
    "alianza_get_business_line",
    {
      title: "Get business line",
      description:
        "Fetch one Business Line with its caller id, E911 callback number, full call handling, the ATA device and " +
        "port it is assigned to, SIP username, and live registration status (registered / locked out). Use " +
        "alianza_list_business_lines to find the line id. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        businessLineId: lineIdInput,
      },
      outputSchema: lineShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, businessLineId }) =>
      withErrorHandling("alianza_get_business_line", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const line = await api.getBusinessLineExpanded(pid, accountId, businessLineId);
        let reg: { registered?: boolean; lockedOut?: boolean } | undefined;
        try {
          reg = await api.getBusinessLineRegistration(pid, accountId, businessLineId);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          log.warn("business line registration lookup failed", { lineId: businessLineId, error: err.message });
        }
        const out = toLineView(line, reg);
        return { content: [{ type: "text", text: jsonText(out) }], structuredContent: out };
      }),
  );

  server.registerTool(
    "alianza_create_business_line",
    {
      title: "Create business line",
      description:
        "Add a Business Line to an account, optionally placing it on an ATA port in the same call. A line needs a " +
        "caller id number and an E911 callback number, both already on the account (see alianza_list_phone_numbers). " +
        "Give deviceTypeId, macAddress, and portNumber to assign the ATA port now, or do it later with " +
        "alianza_set_business_line_port. Route a number to the line afterwards with " +
        "alianza_set_phone_number_destination (referenceType BUSINESS_LINE) or add it to a hunt group. Call " +
        "handling defaults to ring the line with voicemail on busy/no answer; change it with " +
        "alianza_set_business_line_call_handling. Confirm details with the user before calling.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        name: z.string().min(1).max(256).describe("Label for the line, e.g. 'Front desk' or 'Line 2'."),
        callerIdPhoneNumber: phoneNumberInput.describe("Outbound caller id number; must be on the account."),
        emergencyCallbackPhoneNumber: phoneNumberInput
          .optional()
          .describe("911 callback number; must be on the account. Defaults to the caller id number."),
        callerIdVisible: z.boolean().default(true).describe("False to send calls as anonymous."),
        deviceTypeId: z.string().optional().describe("ATA device type id, e.g. SPA122. Required to assign a port now."),
        macAddress: z.string().optional().describe("ATA MAC address, 12 hex characters."),
        portNumber: z.number().int().min(1).max(100).optional().describe("FXS port on the ATA, starting at 1."),
        faxEnabled: z.boolean().default(false).describe("True if a fax machine is on this port."),
      },
      outputSchema: lineShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, name, callerIdPhoneNumber, emergencyCallbackPhoneNumber, callerIdVisible, deviceTypeId, macAddress, portNumber, faxEnabled }) =>
      withErrorHandling("alianza_create_business_line", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const cid = normalizePhoneNumber(callerIdPhoneNumber);
        const wantsPort = deviceTypeId || macAddress || portNumber !== undefined;
        if (wantsPort && !deviceTypeId) {
          throw new ToolInputError("deviceTypeId is required to assign a port (with macAddress and portNumber).");
        }
        const created = await api.createBusinessLine(pid, accountId, {
          name,
          callerIdPhoneNumber: cid,
          emergencyCallbackPhoneNumber: emergencyCallbackPhoneNumber ? normalizePhoneNumber(emergencyCallbackPhoneNumber) : cid,
          callerIdVisible,
        });
        log.info("business line created", { partitionId: pid, accountId, lineId: created.id });
        if (wantsPort && deviceTypeId) {
          await api.setBusinessLinePort(
            pid,
            accountId,
            created.id,
            compact({
              deviceTypeId,
              macAddress: macAddress ? normalizeMacAddress(macAddress) : undefined,
              portNumber,
              faxEnabled,
            }),
            false,
          );
        }
        const out = toLineView(await api.getBusinessLineExpanded(pid, accountId, created.id));
        const portText = out.device ? ` on ${out.device.deviceTypeId} ${out.device.macAddress ?? ""} port ${out.device.portNumber}` : " (no port assigned yet)";
        return {
          content: [
            {
              type: "text",
              text: `Created business line ${out.id} (${out.name})${portText}. Route a number to it with alianza_set_phone_number_destination referenceType=BUSINESS_LINE.\n${jsonText(out)}`,
            },
          ],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_set_business_line_port",
    {
      title: "Assign business line to an ATA port",
      description:
        "Put a Business Line on a physical ATA port (device type, MAC address, FXS port number), or move it to a " +
        "different device or port. Creates the assignment if the line has none, otherwise replaces it. The ATA " +
        "re-provisions on next resync. Confirm the MAC and port with the user before calling.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        businessLineId: lineIdInput,
        deviceTypeId: z.string().min(1).describe("ATA device type id, e.g. SPA122 or HT812."),
        macAddress: z.string().optional().describe("ATA MAC address, 12 hex characters."),
        portNumber: z.number().int().min(1).max(100).default(1).describe("FXS port on the ATA, starting at 1."),
        faxEnabled: z.boolean().default(false).describe("True if a fax machine is on this port."),
      },
      outputSchema: {
        businessLineId: z.string(),
        deviceTypeId: z.string().optional(),
        macAddress: z.string().optional(),
        portNumber: z.number().optional(),
        faxEnabled: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, businessLineId, deviceTypeId, macAddress, portNumber, faxEnabled }) =>
      withErrorHandling("alianza_set_business_line_port", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        let exists = false;
        try {
          exists = !!(await api.getBusinessLinePort(pid, accountId, businessLineId))?.deviceTypeId;
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        const body: BusinessLinePortAssignment = compact({
          deviceTypeId,
          macAddress: macAddress ? normalizeMacAddress(macAddress) : undefined,
          portNumber,
          faxEnabled,
        });
        const res = await api.setBusinessLinePort(pid, accountId, businessLineId, body, exists);
        const out = compact({
          businessLineId,
          deviceTypeId: res.deviceTypeId ?? deviceTypeId,
          macAddress: res.macAddress ?? body.macAddress,
          portNumber: res.portNumber ?? portNumber,
          faxEnabled: res.faxEnabled ?? faxEnabled,
        });
        log.info("business line port assigned", { partitionId: pid, accountId, lineId: businessLineId, replaced: exists });
        return {
          content: [
            {
              type: "text",
              text: `${exists ? "Moved" : "Assigned"} business line ${businessLineId} to ${out.deviceTypeId} ${out.macAddress ?? ""} port ${out.portNumber}.`,
            },
          ],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_set_business_line_call_handling",
    {
      title: "Set business line call handling",
      description:
        "Change how a Business Line handles direct calls (calls to a number that references the line; hunt group " +
        "ringing is configured on the hunt group). mode RING_LINE rings the port, FORWARD sends every call to " +
        "forwardTo. For RING_LINE you can set what happens on busy, no answer (after ringTimeoutSeconds), and when " +
        "the ATA is unregistered: BUSY tone, VOICEMAIL, or FORWARD to a number. Only the fields you pass change; " +
        "everything else keeps its current value. Reversible by calling again.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        businessLineId: lineIdInput,
        mode: z.enum(["RING_LINE", "FORWARD"]).optional().describe("RING_LINE rings the port; FORWARD sends all calls to forwardTo."),
        forwardTo: z.string().optional().describe("Number for mode FORWARD."),
        callWaiting: z.boolean().optional().describe("Allow a second call while the line is in use."),
        busyAction: failoverActionInput.optional().describe("What happens when the line is busy."),
        busyForwardTo: z.string().optional().describe("Number for busyAction FORWARD."),
        unregisteredAction: failoverActionInput.optional().describe("What happens when the ATA is offline."),
        unregisteredForwardTo: z.string().optional().describe("Number for unregisteredAction FORWARD."),
        ringTimeoutSeconds: z
          .number()
          .int()
          .min(0)
          .max(600)
          .optional()
          .describe("Seconds to ring before noAnswerAction. 0 = ring forever (no no-answer action)."),
        noAnswerAction: failoverActionInput.optional().describe("What happens after ringTimeoutSeconds."),
        noAnswerForwardTo: z.string().optional().describe("Number for noAnswerAction FORWARD."),
        voicemailBoxId: z.string().optional().describe("Voicemail box for VOICEMAIL actions (see business line voicemail boxes)."),
      },
      outputSchema: {
        businessLineId: z.string(),
        callHandling: callHandlingShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, businessLineId, ...input }) =>
      withErrorHandling("alianza_set_business_line_call_handling", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const current = await api.getBusinessLineCallHandling(pid, accountId, businessLineId);
        const mode = input.mode ?? current.activeCallHandling ?? "RING_LINE";
        const forwardTo = input.forwardTo ? normalizePhoneNumber(input.forwardTo) : current.forwardToPhoneNumber;
        if (mode === "FORWARD" && !forwardTo) throw new ToolInputError("mode FORWARD needs forwardTo.");

        const busy = input.busyAction
          ? buildFailover(input.busyAction, input.busyForwardTo, "busyAction")
          : (current.busyFailoverAction ?? { "@type": "VoicemailRingFailoverAction" });
        const unregistered = input.unregisteredAction
          ? buildFailover(input.unregisteredAction, input.unregisteredForwardTo, "unregisteredAction")
          : (current.unregisteredFailoverAction ?? { "@type": "VoicemailRingFailoverAction" });

        let ringTimeout: RingTimeoutConfiguration = current.ringTimeoutConfiguration ?? {
          "@type": "UnlimitedRingTimeoutConfiguration",
        };
        if (input.ringTimeoutSeconds === 0) {
          ringTimeout = { "@type": "UnlimitedRingTimeoutConfiguration" };
        } else if (input.ringTimeoutSeconds !== undefined || input.noAnswerAction) {
          const prev = ringTimeout["@type"] === "LimitedRingTimeoutConfiguration" ? ringTimeout : undefined;
          const timeoutSeconds = input.ringTimeoutSeconds ?? prev?.timeoutSeconds ?? 20;
          const noAnswerAction = input.noAnswerAction
            ? buildFailover(input.noAnswerAction, input.noAnswerForwardTo, "noAnswerAction")
            : (prev?.noAnswerAction ?? { "@type": "VoicemailRingFailoverAction" });
          ringTimeout = { "@type": "LimitedRingTimeoutConfiguration", timeoutSeconds, noAnswerAction };
        }

        const body: BusinessLineCallHandling = compact({
          activeCallHandling: mode,
          callWaitingEnabled: input.callWaiting ?? current.callWaitingEnabled,
          busyFailoverAction: busy,
          unregisteredFailoverAction: unregistered,
          ringTimeoutConfiguration: ringTimeout,
          forwardToPhoneNumber: forwardTo,
          voicemailBoxId: input.voicemailBoxId ?? current.voicemailBoxId,
        });
        const res = await api.setBusinessLineCallHandling(pid, accountId, businessLineId, body);
        const view = toLineView({ id: businessLineId, name: "", callHandling: res });
        const out = { businessLineId, callHandling: view.callHandling };
        log.info("business line call handling updated", { partitionId: pid, accountId, lineId: businessLineId, mode });
        return {
          content: [{ type: "text", text: `Updated call handling on business line ${businessLineId}.\n${jsonText(out)}` }],
          structuredContent: out,
        };
      }),
  );
}
