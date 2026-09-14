/**
 * Call activity: call detail records and voicemail.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import type { CallDetailRecord, VoicemailMessage } from "../alianza-types.js";
import {
  accountIdInput,
  compact,
  dateInput,
  normalizePhoneNumber,
  pageArray,
  pageHint,
  partitionIdInput,
  userIdInput,
} from "./common.js";
import { withErrorHandling } from "./errors.js";

const cdrShape = {
  id: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  callType: z.string().optional(),
  result: z.string().optional(),
  from: z.string().optional(),
  dialed: z.string().optional(),
  to: z.string().optional(),
  forwardedTo: z.string().optional(),
  durationSeconds: z.number().optional(),
  billedSeconds: z.number().optional(),
  cost: z.number().optional(),
  inPlan: z.boolean().optional(),
  disconnectType: z.string().optional(),
  category: z.string().optional(),
  fromLocation: z.string().optional(),
  toLocation: z.string().optional(),
};

function toCdrView(c: CallDetailRecord) {
  return compact({
    id: c.id,
    startTime: c.startTime,
    endTime: c.endTime,
    callType: c.callType,
    result: c.callFlagType,
    from: c.origNumber,
    dialed: c.dialedNumber,
    to: c.termNumber,
    forwardedTo: c.forwardingNumber,
    durationSeconds: c.actualCallLengthSeconds,
    billedSeconds: c.billCallLengthSeconds,
    cost: c.cost,
    inPlan: c.inPlan,
    disconnectType: c.disconnectType,
    category: c.callType === "OUTBOUND" ? c.termCallCategory : c.origCallCategory,
    fromLocation: [c.origCityName, c.origState].filter(Boolean).join(", ") || undefined,
    toLocation: [c.termCityName, c.termState].filter(Boolean).join(", ") || undefined,
  });
}

const voicemailShape = {
  id: z.string(),
  createdDate: z.string().optional(),
  fromNumber: z.string().optional(),
  fromName: z.string().optional(),
  toPhoneNumber: z.string().optional(),
  lengthInSeconds: z.number().optional(),
  read: z.boolean().optional(),
  messageType: z.string().optional(),
  voicemailBoxId: z.string().optional(),
  transcription: z.string().optional(),
};

const TRANSCRIPTION_LIMIT = 500;

function toVoicemailView(m: VoicemailMessage) {
  const t = m.transcriptionText;
  return compact({
    id: m.id,
    createdDate: m.createdDate,
    fromNumber: m.fromNumber,
    fromName: m.fromName,
    toPhoneNumber: m.toPhoneNumber,
    lengthInSeconds: m.lengthInSeconds,
    read: m.read,
    messageType: m.messageType,
    voicemailBoxId: m.voicemailBoxId,
    transcription: t && t.length > TRANSCRIPTION_LIMIT ? `${t.slice(0, TRANSCRIPTION_LIMIT)}…` : t,
  });
}

export function registerActivityTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_search_call_records",
    {
      title: "Search call detail records",
      description:
        "Search an account's call history (CDRs) over a date range: inbound/outbound, answered/missed/voicemail/" +
        "forwarded, numbers involved, duration, cost, and whether the call was in plan. Use this for 'did they call " +
        "X', 'missed calls yesterday', or usage questions. Both dates are required and are inclusive; keep ranges " +
        "short (a day to a month) for fast answers. Filter by call type, result, or a number. Newest first by " +
        "default. Returns total matches and up to `limit` records. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        startDate: dateInput.describe("First day to include, YYYY-MM-DD."),
        endDate: dateInput.describe("Last day to include, YYYY-MM-DD."),
        callType: z.enum(["INBOUND", "OUTBOUND"]).optional().describe("Only this direction."),
        result: z
          .enum(["ANSWERED", "MISSED", "VOICEMAIL", "FORWARDED", "BUSY", "PICKED_UP", "OTHER"])
          .optional()
          .describe("Only calls with this outcome."),
        fromNumber: z.string().optional().describe("Only calls originating from this number."),
        dialedNumber: z.string().optional().describe("Only calls where this number was dialed."),
        toNumber: z.string().optional().describe("Only calls terminating at this number."),
        sort: z.enum(["DATE", "CALL_LENGTH", "COST"]).default("DATE").describe("Sort field."),
        sortOrder: z.enum(["DESC", "ASC"]).default("DESC").describe("DESC = newest/largest first."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum records to return."),
        offset: z.number().int().min(0).default(0).describe("Records to skip for paging."),
      },
      outputSchema: {
        calls: z.array(z.object(cdrShape)),
        total: z.number().int().optional(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, startDate, endDate, callType, result, fromNumber, dialedNumber, toNumber, sort, sortOrder, limit, offset }) =>
      withErrorHandling("alianza_search_call_records", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        if (startDate > endDate) {
          return { content: [{ type: "text", text: "startDate must be on or before endDate." }], isError: true };
        }
        const res = await api.searchCdrs(pid, accountId, {
          startDate,
          endDate,
          callType: callType ? [callType] : undefined,
          callFlagType: result ? [result] : undefined,
          origNumber: fromNumber ? normalizePhoneNumber(fromNumber) : undefined,
          dialedNumber: dialedNumber ? normalizePhoneNumber(dialedNumber) : undefined,
          termNumber: toNumber ? normalizePhoneNumber(toNumber) : undefined,
          sort,
          sortOrder,
          firstResultIndex: offset,
          maxResult: limit,
        });
        const calls = (res.results ?? []).map(toCdrView);
        const lines = calls.map(
          (c) =>
            `- ${c.startTime ?? "?"} ${c.callType ?? "?"} ${c.from ?? "?"} -> ${c.dialed ?? c.to ?? "?"} ${c.result ?? ""}` +
            (c.durationSeconds !== undefined ? ` ${c.durationSeconds}s` : "") +
            (c.cost ? ` $${c.cost}` : ""),
        );
        const text = `${pageHint(calls.length, res.totalRecords, offset)}\n${lines.join("\n")}`.trim();
        return {
          content: [{ type: "text", text }],
          structuredContent: compact({ calls, total: res.totalRecords, offset, limit }),
        };
      }),
  );

  server.registerTool(
    "alianza_list_voicemails",
    {
      title: "List a user's voicemails",
      description:
        "List voicemail messages in an end user's voicemail box, newest first, with caller number/name, length, " +
        "read flag, and transcription text when Alianza transcribed it. Use unreadOnly=true for 'any new " +
        "voicemails'. Does not return audio and does not change read status. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        userId: userIdInput,
        unreadOnly: z.boolean().default(false).describe("Only messages not yet listened to."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum messages to return."),
        offset: z.number().int().min(0).default(0).describe("Messages to skip for paging."),
      },
      outputSchema: {
        messages: z.array(z.object(voicemailShape)),
        total: z.number().int(),
        unread: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, userId, unreadOnly, limit, offset }) =>
      withErrorHandling("alianza_list_voicemails", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const all = (await api.listUserVoicemail(pid, accountId, userId))
          .map(toVoicemailView)
          .sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? ""));
        const unread = all.filter((m) => m.read === false).length;
        const filtered = unreadOnly ? all.filter((m) => m.read === false) : all;
        const { page, text: hint } = pageArray(filtered, limit, offset);
        const lines = page.map(
          (m) =>
            `- ${m.createdDate ?? "?"} from ${m.fromNumber ?? "unknown"}${m.fromName ? ` (${m.fromName})` : ""}` +
            (m.lengthInSeconds !== undefined ? ` ${m.lengthInSeconds}s` : "") +
            (m.read ? "" : " UNREAD") +
            (m.transcription ? `: "${m.transcription}"` : ""),
        );
        const text =
          filtered.length === 0
            ? unreadOnly
              ? `No unread voicemails (${all.length} total).`
              : "No voicemails."
            : `${hint} ${unread} unread.\n${lines.join("\n")}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { messages: page, total: filtered.length, unread, offset, limit },
        };
      }),
  );
}
