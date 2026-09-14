/**
 * End users: the call-routing object for Business Cloud Communications and
 * Home Phone accounts.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import { TIME_ZONES, type EndUser } from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  jsonText,
  pageArray,
  partitionIdInput,
  summarizeCallingPlans,
  userIdInput,
} from "./common.js";
import { ToolInputError, withErrorHandling } from "./errors.js";

const userSummaryShape = {
  id: z.string(),
  accountId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional(),
  emailAddress: z.string().optional(),
  extension: z.string().optional(),
  endUserType: z.string().optional(),
  userProductPlan: z.string().optional(),
  timeZone: z.string().optional(),
  callerIdNumber: z.string().optional(),
  voicemailBoxId: z.string().optional(),
  allowPortalAccess: z.boolean().optional(),
  pinLockedOut: z.boolean().optional(),
  deviceCount: z.number().int().optional(),
};

const callHandlingShape = z
  .object({
    mode: z.string().optional(),
    doNotDisturb: z.boolean().optional(),
    callWaiting: z.boolean().optional(),
    forwardAlwaysTo: z.string().optional(),
    busy: z.string().optional(),
    noAnswer: z.string().optional(),
    unregistered: z.string().optional(),
  })
  .optional();

const userDetailShape = {
  ...userSummaryShape,
  mustChangePassword: z.boolean().optional(),
  welcomeEmailSent: z.string().optional(),
  callHandling: callHandlingShape,
  devices: z
    .array(
      z.object({
        id: z.string(),
        deviceName: z.string().optional(),
        deviceTypeId: z.string().optional(),
        macAddress: z.string().optional(),
        lineNumber: z.number().optional(),
        lineType: z.string().optional(),
      }),
    )
    .optional(),
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

export function toUserSummary(u: EndUser) {
  return compact({
    id: u.id,
    accountId: u.accountId,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    emailAddress: u.emailAddress,
    extension: u.extension,
    endUserType: u.endUserType,
    userProductPlan: u.userProductPlan,
    timeZone: u.timeZone,
    callerIdNumber: u.callerIdConfig?.callerIdNumber,
    voicemailBoxId: u.voicemailBoxId,
    allowPortalAccess: u.allowPortalAccess,
    pinLockedOut: u.pinLockedOut,
    deviceCount: u.devices?.length,
  });
}

function describeHandling(h: { type?: string; timeout?: number; forwardToNumber?: string } | undefined) {
  if (!h?.type) return undefined;
  const parts = [h.type];
  if (h.forwardToNumber) parts.push(`to ${h.forwardToNumber}`);
  if (h.timeout !== undefined) parts.push(`after ${h.timeout}s`);
  return parts.join(" ");
}

export function toUserDetail(u: EndUser) {
  const s = u.callHandlingSettings;
  const ring = s?.ringPhoneCallHandling;
  return compact({
    ...toUserSummary(u),
    mustChangePassword: u.mustChangePassword,
    welcomeEmailSent: u.welcomeEmailSent,
    callHandling: s
      ? compact({
          mode: s.callHandlingOptionType,
          doNotDisturb: s.doNotDisturbEnabled,
          callWaiting: s.callWaitingEnabled,
          forwardAlwaysTo: s.forwardAlwaysToNumber,
          busy: describeHandling(ring?.busyCallHandling),
          noAnswer: describeHandling(ring?.noAnswerCallHandling),
          unregistered: describeHandling(ring?.unregisteredCallHandling),
        })
      : undefined,
    devices: u.devices?.map((d) =>
      compact({
        id: d.id,
        deviceName: d.deviceName,
        deviceTypeId: d.deviceTypeId,
        macAddress: d.macAddress,
        lineNumber: d.lineNumber,
        lineType: d.lineType,
      }),
    ),
    callingPlans: u.callingPlans ? summarizeCallingPlans(u.callingPlans) : undefined,
  });
}

export function registerUserTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_users",
    {
      title: "List end users on an account",
      description:
        "List the end users (people/lines) on an account with id, name, username, email, extension, admin type, " +
        "product plan, caller id number, and device count. Use this to find a user's id before calling " +
        "alianza_get_user, alianza_list_voicemails, alianza_set_phone_number_destination, or " +
        "alianza_create_device_line. Home Phone (SIMPLE) accounts have one user. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum users to return."),
        offset: z.number().int().min(0).default(0).describe("Users to skip for paging."),
      },
      outputSchema: {
        users: z.array(z.object(userSummaryShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, limit, offset }) =>
      withErrorHandling("alianza_list_users", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const users = (await api.listUsers(pid, accountId)).map(toUserSummary);
        const { page, text: hint } = pageArray(users, limit, offset);
        const lines = page.map(
          (u) =>
            `- ${u.id}: ${[u.firstName, u.lastName].filter(Boolean).join(" ")}` +
            (u.extension ? ` ext ${u.extension}` : "") +
            (u.username ? ` (${u.username})` : "") +
            ` [${u.userProductPlan ?? "no plan"}, ${u.endUserType ?? "?"}]`,
        );
        const text = users.length === 0 ? "This account has no end users." : `${hint}\n${lines.join("\n")}`;
        return { content: [{ type: "text", text }], structuredContent: { users: page, total: users.length, offset, limit } };
      }),
  );

  server.registerTool(
    "alianza_get_user",
    {
      title: "Get end user",
      description:
        "Fetch one end user with their call handling (ring/forward/simultaneous ring, busy and no-answer actions, " +
        "do not disturb), caller id number, devices, voicemail box id, and calling plan minutes. Look up by user id " +
        "(default) or by username with lookupBy=UserName. Use alianza_list_users when you only have a name or " +
        "extension. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        userId: z.string().min(1).describe("User id, or the username when lookupBy is UserName."),
        lookupBy: z.enum(["ID", "UserName"]).default("ID").describe("What kind of value `userId` is."),
      },
      outputSchema: userDetailShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, userId, lookupBy }) =>
      withErrorHandling("alianza_get_user", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const user = toUserDetail(await api.getUser(pid, accountId, userId, lookupBy));
        return { content: [{ type: "text", text: jsonText(user) }], structuredContent: user };
      }),
  );

  server.registerTool(
    "alianza_create_user",
    {
      title: "Create end user",
      description:
        "Add an end user to an account (step 2 of provisioning; not needed for Business Lines or SIP trunk accounts). " +
        "For Business (ADVANCED) accounts give a userProductPlan and an extension of the account's extension length; " +
        "ADVANCED and PROFESSIONAL plans include the UC app and need an email address and portal access. Home Phone " +
        "(SIMPLE) users need only names. Unless blockEmail is true, users with portal access receive a welcome email " +
        "immediately, so confirm details with the user first. Returns the created user including its id and " +
        "voicemail box id. Next: route a number to the user with alianza_set_phone_number_destination.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        firstName: z.string().min(1).max(256).describe("First name."),
        lastName: z.string().min(1).max(256).describe("Last name."),
        extension: z
          .string()
          .regex(/^\d{3,6}$/, "3 to 6 digits")
          .optional()
          .describe("Extension, digits only, matching the account's extensionLength (e.g. 4000). Business accounts only."),
        userProductPlan: z
          .enum(["STANDARD", "ADVANCED", "PROFESSIONAL"])
          .optional()
          .describe("Feature plan. Required for Business accounts; omit for Home Phone."),
        endUserType: z
          .enum(["STANDARD", "BASIC_ADMIN", "STANDARD_ADMIN", "ADVANCED_ADMIN", "SUPER_ADMIN"])
          .default("STANDARD")
          .describe("STANDARD for a normal user. *_ADMIN types can manage other users in the portal."),
        username: z
          .string()
          .min(3)
          .max(256)
          .optional()
          .describe(
            "Portal / UC app login. Must be globally unique across Alianza. Required if allowPortalAccess is true. " +
              "Do not use an email address for ADVANCED or PROFESSIONAL plans.",
          ),
        emailAddress: z.string().email().optional().describe("Email for welcome and password-reset mail. Required if allowPortalAccess is true."),
        timeZone: z.enum(TIME_ZONES).optional().describe("User time zone. Omit to copy the account's time zone."),
        allowPortalAccess: z.boolean().default(false).describe("Allow Voice Portal / UC app login."),
        blockEmail: z.boolean().default(false).describe("True to suppress the welcome email for now."),
      },
      outputSchema: userDetailShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, ...input }) =>
      withErrorHandling("alianza_create_user", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        if (input.allowPortalAccess && (!input.username || !input.emailAddress)) {
          throw new ToolInputError("allowPortalAccess requires both username and emailAddress.");
        }
        let timeZone = input.timeZone;
        if (!timeZone) {
          const account = await api.getAccount(pid, accountId);
          timeZone = account.timeZone;
          if (!timeZone) throw new ToolInputError("The account has no time zone; pass timeZone explicitly.");
        }
        const body: Partial<EndUser> = compact({
          firstName: input.firstName,
          lastName: input.lastName,
          extension: input.extension,
          userProductPlan: input.userProductPlan,
          endUserType: input.endUserType,
          username: input.username,
          emailAddress: input.emailAddress,
          timeZone,
          allowPortalAccess: input.allowPortalAccess,
          blockEmail: input.blockEmail,
        });
        const user = toUserDetail(await api.createUser(pid, accountId, body));
        log.info("user created", { partitionId: pid, accountId, userId: user.id });
        return {
          content: [
            {
              type: "text",
              text: `Created user ${user.id} (${user.firstName} ${user.lastName}${user.extension ? `, ext ${user.extension}` : ""}) on account ${accountId}.\n${jsonText(user)}`,
            },
          ],
          structuredContent: user,
        };
      }),
  );
}
