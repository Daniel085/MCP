/**
 * Device lines: IP phones and ATAs attached to end users.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import type { Device } from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  jsonText,
  normalizeMacAddress,
  normalizePhoneNumber,
  pageArray,
  partitionIdInput,
  userIdInput,
} from "./common.js";
import { withErrorHandling } from "./errors.js";

const deviceShape = {
  id: z.string(),
  deviceName: z.string().optional(),
  deviceTypeId: z.string().optional(),
  macAddress: z.string().optional(),
  lineNumber: z.number().optional(),
  lineType: z.string().optional(),
  userId: z.string().optional(),
  referenceId: z.string().optional(),
  emergencyNumber: z.string().optional(),
  sipUsername: z.string().optional(),
  faxEnabled: z.boolean().optional(),
  registered: z.boolean().optional(),
};

function toDeviceView(d: Device, registered?: boolean) {
  return compact({
    id: d.id,
    deviceName: d.deviceName,
    deviceTypeId: d.deviceTypeId,
    macAddress: d.macAddress,
    lineNumber: d.lineNumber,
    lineType: d.lineType,
    userId: d.userId,
    referenceId: d.referenceId,
    emergencyNumber: d.emergencyNumber,
    sipUsername: d.sipUsername,
    faxEnabled: d.faxEnabled,
    registered,
  });
}

const MAX_REGISTRATION_LOOKUPS = 25;

export function registerDeviceTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_devices",
    {
      title: "List device lines on an account",
      description:
        "List the device lines (IP phone and ATA lines) on an account: device name, device type, MAC address, line " +
        "number, line type, owning user, and SIP username. Filter to one MAC address or one user. Set " +
        "includeRegistration=true to also report whether each line is currently registered with Alianza's SIP " +
        "registrar (one extra lookup per device, first 25 devices only), which is the first check for 'the phone is " +
        "dead' tickets. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        macAddress: z.string().optional().describe("Only lines on this device (12 hex characters, separators allowed)."),
        userId: z.string().optional().describe("Only lines owned by this end user id."),
        includeRegistration: z.boolean().default(false).describe("Also fetch SIP registration status per line."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum lines to return."),
        offset: z.number().int().min(0).default(0).describe("Lines to skip for paging."),
      },
      outputSchema: {
        devices: z.array(z.object(deviceShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, macAddress, userId, includeRegistration, limit, offset }) =>
      withErrorHandling("alianza_list_devices", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const query = macAddress
          ? { filterType: "MAC_ADDRESS", filter: normalizeMacAddress(macAddress) }
          : userId
            ? { filterType: "OWNING_USERID", filter: userId }
            : {};
        const raw = await api.listDeviceLines(pid, accountId, query);
        const { page: rawPage, text: hint } = pageArray(raw, limit, offset);
        let page = rawPage.map((d) => toDeviceView(d));
        if (includeRegistration) {
          const statuses = await Promise.all(
            rawPage.slice(0, MAX_REGISTRATION_LOOKUPS).map(async (d) => {
              try {
                return (await api.getDeviceRegistration(pid, accountId, d.id)).registered;
              } catch (err) {
                log.warn("registration lookup failed", { deviceId: d.id, error: String(err) });
                return undefined;
              }
            }),
          );
          page = rawPage.map((d, i) => toDeviceView(d, statuses[i]));
        }
        const lines = page.map(
          (d) =>
            `- ${d.id}: ${d.deviceName ?? "?"} (${d.deviceTypeId ?? "?"}` +
            (d.macAddress ? ` ${d.macAddress}` : "") +
            `, line ${d.lineNumber ?? "?"})` +
            (d.userId ? ` user ${d.userId}` : "") +
            (d.registered === undefined ? "" : d.registered ? " REGISTERED" : " NOT REGISTERED"),
        );
        const text = raw.length === 0 ? "No device lines matched." : `${hint}\n${lines.join("\n")}`;
        return { content: [{ type: "text", text }], structuredContent: { devices: page, total: raw.length, offset, limit } };
      }),
  );

  server.registerTool(
    "alianza_create_device_line",
    {
      title: "Create device line",
      description:
        "Attach a physical IP phone or ATA line to an end user (step 5 of provisioning). Not needed for users on " +
        "ADVANCED/PROFESSIONAL plans who only use the UC app, nor for SIP trunks. deviceTypeId must be a device type " +
        "the partition allows (alianza_get_partition lists allowedDeviceTypes when the partition restricts them; " +
        "examples: SPA122, VVX411, T46S). The device provisions on next boot/resync. Confirm the MAC address with the " +
        "user before calling. Returns the new device line including its SIP username.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        userId: userIdInput.describe("End user who owns the line."),
        deviceName: z.string().min(1).max(256).describe("Label shown in the portal, e.g. 'Front desk Polycom'."),
        deviceTypeId: z.string().min(1).describe("Alianza device type id, e.g. VVX411 or SPA122."),
        macAddress: z.string().optional().describe("Device MAC address, 12 hex characters. Required for physical devices."),
        lineNumber: z.number().int().min(1).default(1).describe("Which line key/port on the device (1 for single-line ATAs)."),
        emergencyNumber: z
          .string()
          .optional()
          .describe("911 callback number for this line, 11 digits. Defaults to the user's caller id."),
        faxEnabled: z.boolean().default(false).describe("True for a fax machine on an ATA port."),
      },
      outputSchema: deviceShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, userId, deviceName, deviceTypeId, macAddress, lineNumber, emergencyNumber, faxEnabled }) =>
      withErrorHandling("alianza_create_device_line", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const body: Partial<Device> = compact({
          userId,
          deviceName,
          deviceTypeId,
          macAddress: macAddress ? normalizeMacAddress(macAddress) : undefined,
          lineNumber,
          emergencyNumber: emergencyNumber ? normalizePhoneNumber(emergencyNumber) : undefined,
          faxEnabled,
        });
        const device = toDeviceView(await api.createDeviceLine(pid, accountId, body));
        log.info("device line created", { partitionId: pid, accountId, deviceId: device.id, userId });
        return {
          content: [
            {
              type: "text",
              text: `Created device line ${device.id} (${device.deviceName}, ${device.deviceTypeId}, line ${device.lineNumber}) for user ${userId}.\n${jsonText(device)}`,
            },
          ],
          structuredContent: device,
        };
      }),
  );
}
