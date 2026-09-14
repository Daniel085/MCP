/**
 * Account lookup, search, creation, and history.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import { ACCOUNT_HISTORY_TYPES, DIALING_BEHAVIORS, TIME_ZONES, type Account } from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  dateInput,
  jsonText,
  pageArray,
  pageHint,
  partitionIdInput,
  summarizeCallingPlans,
} from "./common.js";
import { withErrorHandling } from "./errors.js";

const accountShape = {
  id: z.string(),
  partitionId: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  status: z.string().optional(),
  accountType: z.string().optional(),
  platformType: z.string().optional(),
  timeZone: z.string().optional(),
  extensionLength: z.number().optional(),
  dialingBehaviorType: z.string().optional(),
  billingCycleDay: z.number().optional(),
  regulatoryType: z.string().optional(),
  customField: z.string().optional(),
  endUserCount: z.number().optional(),
  sendWelcomeEmail: z.boolean().optional(),
  routePlanId: z.string().optional(),
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
};

export function toAccountView(a: Account) {
  return compact({
    id: a.id,
    partitionId: a.partitionId,
    accountNumber: a.accountNumber,
    accountName: a.accountName,
    status: a.status,
    accountType: a.accountType,
    platformType: a.platformType,
    timeZone: a.timeZone,
    extensionLength: a.extensionLength,
    dialingBehaviorType: a.dialingBehaviorType,
    billingCycleDay: a.billingCycleDay,
    regulatoryType: a.regulatoryType,
    customField: a.customField,
    endUserCount: a.endUserCount,
    sendWelcomeEmail: a.sendWelcomeEmail,
    routePlanId: a.routePlanId,
    callingPlans: a.callingPlans ? summarizeCallingPlans(a.callingPlans) : undefined,
  });
}

export function registerAccountTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_search_accounts",
    {
      title: "Search accounts",
      description:
        "Find Alianza accounts in a partition by free text. The term is matched against account number, account name, " +
        "email addresses, phone numbers, and device MAC addresses, so 'acme', 'ACME-1001', 'jane@example.com', " +
        "'18015551212', or '0004f2aabbcc' all work. Use this when the user does not give an exact account id; " +
        "use alianza_get_account when they do (or when they give an account number, phone number, or MAC address). " +
        "Returns up to `limit` matches with id, accountNumber, accountName, status, type, and which field matched. " +
        "Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        query: z.string().min(1).max(200).describe("Search term. Case-insensitive substring."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum matches to return."),
        offset: z.number().int().min(0).default(0).describe("Matches to skip for paging."),
      },
      outputSchema: {
        accounts: z.array(
          z.object({
            id: z.string(),
            accountNumber: z.string().optional(),
            accountName: z.string().optional(),
            status: z.string().optional(),
            accountType: z.string().optional(),
            platformType: z.string().optional(),
            partitionId: z.string().optional(),
            matches: z.record(z.string(), z.string()).optional(),
          }),
        ),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, query, limit, offset }) =>
      withErrorHandling("alianza_search_accounts", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const hits = (await api.searchAccounts(pid, query)).map((h) =>
          compact({
            id: h.id,
            accountNumber: h.accountNumber,
            accountName: h.accountName,
            status: h.accountStatus,
            accountType: h.type,
            platformType: h.platformType,
            partitionId: h.partitionId,
            matches: h.matches,
          }),
        );
        const { page, text: hint } = pageArray(hits, limit, offset);
        const lines = page.map(
          (a) =>
            `- ${a.id}: ${a.accountNumber ?? "?"} ${a.accountName ?? ""} [${a.status ?? "?"}, ${a.accountType ?? "?"}]` +
            (a.matches ? ` matched ${Object.keys(a.matches).join(", ")}` : ""),
        );
        const text = hits.length === 0 ? `No accounts matched "${query}".` : `${hint}\n${lines.join("\n")}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { accounts: page, total: hits.length, offset, limit },
        };
      }),
  );

  server.registerTool(
    "alianza_get_account",
    {
      title: "Get account",
      description:
        "Fetch one Alianza account by its id, account number, a phone number on the account, or a device MAC address. " +
        "Set `lookupBy` to say which kind of value `id` holds (default Id). Use alianza_search_accounts when you only " +
        "have a name or partial value. Returns the account's id (needed by every other account tool), number, name, " +
        "status, type (SIMPLE = Home Phone, ADVANCED = Business), platform, time zone, extension length, dialing " +
        "behavior, billing day, user count, and calling plans. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        id: z
          .string()
          .min(1)
          .describe("The value to look up: account id, account number, 11-digit phone number, or 12-hex MAC address."),
        lookupBy: z
          .enum(["Id", "AccountNumber", "PhoneNumber", "MacAddress"])
          .default("Id")
          .describe("What kind of value `id` is."),
      },
      outputSchema: accountShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, id, lookupBy }) =>
      withErrorHandling("alianza_get_account", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const account = toAccountView(await api.getAccount(pid, id, lookupBy));
        return { content: [{ type: "text", text: jsonText(account) }], structuredContent: account };
      }),
  );

  server.registerTool(
    "alianza_create_account",
    {
      title: "Create account",
      description:
        "Create a new customer account in a partition. This is step 1 of provisioning a customer; follow with " +
        "alianza_create_user, alianza_add_phone_number, alianza_set_phone_number_destination, and " +
        "alianza_create_device_line. Use accountType ADVANCED for Business (BCC, Business Lines, SIP trunks) and " +
        "SIMPLE for Home Phone (one user, one number, one device). New accounts may incur billing: confirm the " +
        "account number, name, type, and time zone with the user before calling. Returns the created account " +
        "including its new id.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountNumber: z
          .string()
          .min(3)
          .max(25)
          .describe("Your identifier for the account, typically the billing system id. Unique within the partition."),
        accountName: z.string().min(3).max(256).describe("Human-readable name: business name or the residential customer's name."),
        accountType: z
          .enum(["ADVANCED", "SIMPLE"])
          .default("ADVANCED")
          .describe("ADVANCED = Business account. SIMPLE = Home Phone account."),
        timeZone: z.enum(TIME_ZONES).describe("Account time zone, e.g. US/Mountain."),
        extensionLength: z
          .number()
          .int()
          .min(3)
          .max(6)
          .optional()
          .describe("Digits per extension (3-6). Required for ADVANCED accounts; cannot be changed later. Ignored for SIMPLE."),
        billingCycleDay: z.number().int().min(1).max(28).default(1).describe("Day of month the billing cycle starts (1-28)."),
        dialingBehaviorType: z
          .enum(DIALING_BEHAVIORS)
          .optional()
          .describe(
            "How users dial. OPEN_DIAL_PLAN_TEN_DIGIT allows extensions, 10 and 11 digits. Omit to use the partition default.",
          ),
        platformType: z
          .enum(["CPE2", "CPE1"])
          .default("CPE2")
          .describe("CPE2 for business cloud communications features (default). CPE1 for basic telephone features."),
        regulatoryType: z
          .enum(["RESIDENTIAL", "COMMERCIAL", "GOVERNMENT"])
          .optional()
          .describe("Reporting-only classification. Omit to use the partition default."),
        customField: z.string().min(3).max(256).optional().describe("Free-form note stored on the account."),
      },
      outputSchema: accountShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, ...input }) =>
      withErrorHandling("alianza_create_account", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const body: Partial<Account> = compact({
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          accountType: input.accountType,
          timeZone: input.timeZone,
          extensionLength: input.accountType === "ADVANCED" ? input.extensionLength : undefined,
          billingCycleDay: input.billingCycleDay,
          dialingBehaviorType: input.dialingBehaviorType,
          platformType: input.platformType,
          regulatoryType: input.regulatoryType,
          customField: input.customField,
        });
        const account = toAccountView(await api.createAccount(pid, body));
        log.info("account created", { partitionId: pid, accountId: account.id, accountNumber: account.accountNumber });
        return {
          content: [
            {
              type: "text",
              text: `Created account ${account.id} (${account.accountNumber} ${account.accountName}, ${account.accountType}). Next: add a user with alianza_create_user.\n${jsonText(account)}`,
            },
          ],
          structuredContent: account,
        };
      }),
  );

  server.registerTool(
    "alianza_get_account_history",
    {
      title: "Get account change history",
      description:
        "List what changed on an account, when, and by whom: status changes, users, phone numbers, devices, call " +
        "forwarding, addresses, calling plans, and more. Use this for 'who changed X' or 'what happened to this account " +
        "on date Y' questions. Filter by date range and/or change types. Newest first. Returns total count, account " +
        "created/updated dates, and up to `limit` records with date, action, type, reference name, old and new value, " +
        "and the user who made the change. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        startDate: dateInput.optional().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: dateInput.optional().describe("Inclusive end date, YYYY-MM-DD."),
        historyTypes: z
          .array(z.enum(ACCOUNT_HISTORY_TYPES))
          .optional()
          .describe("Restrict to these change types, e.g. [\"ACCOUNT_STATUS\", \"PHONE_NUMBER\"]. Omit for all."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum records to return."),
        offset: z.number().int().min(0).default(0).describe("Records to skip for paging."),
      },
      outputSchema: {
        total: z.number().int().optional(),
        accountCreatedDate: z.string().optional(),
        accountLastUpdatedDate: z.string().optional(),
        records: z.array(
          z.object({
            loggedDate: z.string().optional(),
            action: z.string().optional(),
            historyType: z.string().optional(),
            referenceType: z.string().optional(),
            referenceName: z.string().optional(),
            referenceId: z.string().optional(),
            oldValue: z.string().optional(),
            newValue: z.string().optional(),
            changedBy: z.string().optional(),
            changedByType: z.string().optional(),
          }),
        ),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, startDate, endDate, historyTypes, limit, offset }) =>
      withErrorHandling("alianza_get_account_history", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const res = await api.searchAccountHistory(pid, accountId, {
          startDate,
          endDate,
          accountHistoryType: historyTypes,
          firstResultIndex: offset,
          maxResult: limit,
        });
        const records = (res.results ?? []).map((r) =>
          compact({
            loggedDate: r.loggedDate,
            action: r.action,
            historyType: r.accountHistoryType,
            referenceType: r.referenceType,
            referenceName: r.referenceName,
            referenceId: r.referenceId,
            oldValue: r.oldValue,
            newValue: r.newValue,
            changedBy: r.userName,
            changedByType: r.userType,
          }),
        );
        const out = compact({
          total: res.totalRecords,
          accountCreatedDate: res.accountCreatedDate,
          accountLastUpdatedDate: res.accountLastUpdatedDate,
          records,
          offset,
          limit,
        });
        const lines = records.map(
          (r) =>
            `- ${r.loggedDate ?? "?"} ${r.action ?? ""} ${r.historyType ?? ""} ${r.referenceName ?? ""}` +
            (r.oldValue !== undefined || r.newValue !== undefined ? `: ${r.oldValue ?? "∅"} -> ${r.newValue ?? "∅"}` : "") +
            (r.changedBy ? ` (by ${r.changedBy})` : ""),
        );
        const text = `${pageHint(records.length, res.totalRecords, offset)}\n${lines.join("\n")}`.trim();
        return { content: [{ type: "text", text }], structuredContent: out };
      }),
  );
}
