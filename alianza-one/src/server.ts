/**
 * Builds a fully registered McpServer. Called once for stdio and once per
 * request for stateless HTTP, so keep construction cheap.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./api-client.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerBusinessLineTools } from "./tools/business-lines.js";
import { registerDeviceTools } from "./tools/devices.js";
import { registerHuntGroupTools } from "./tools/hunt-groups.js";
import { registerNumberTools } from "./tools/numbers.js";
import { registerPartitionTools } from "./tools/partition.js";
import { registerSipTrunkTools } from "./tools/sip-trunks.js";
import { registerUserTools } from "./tools/users.js";

export const SERVER_NAME = "alianza-one-mcp";
export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = [
  "Tools for the Alianza One cloud voice platform (Alianza Public API v2), used by service providers to manage",
  "customer accounts, end users, telephone numbers, devices, call records, voicemail, Business Lines and their",
  "hunt groups, and SIP trunks.",
  "",
  "Model: a partition (the service provider) contains accounts (customers). An account contains end users,",
  "telephone numbers, and device lines (Business Cloud Communications / Home Phone), or Business Lines on ATA",
  "ports grouped into hunt groups (Business Lines product), or SIP trunks for a customer PBX. Inbound calls to a",
  "number route to whatever the number references (END_USER, BUSINESS_LINE, BUSINESS_LINE_HUNT_GROUP, SIP_TRUNK,",
  "...); a user's devices ring together. Every tool works in the server's default partition unless partitionId",
  "is given.",
  "",
  "Start with alianza_search_accounts or alianza_get_account to resolve the account id; every other account tool",
  "needs the opaque id, not the account number. Use alianza_get_partition if you need the partition id or",
  "sub-partitions. Phone numbers are 11 digits with the leading 1 (18015551212).",
  "",
  "Provisioning a new customer, in order: alianza_create_account, alianza_create_user, alianza_validate_address,",
  "alianza_search_available_numbers, alianza_add_phone_number (or alianza_set_phone_number_destination),",
  "alianza_create_device_line. For Business Lines: alianza_create_business_line (with the ATA port), then",
  "route a number to the line or to a hunt group from alianza_create_hunt_group. For SIP trunks:",
  "alianza_create_sip_trunk, then route numbers to it. Confirm details with the user before any create/activate",
  "tool; those steps create carrier orders and can incur billing. Nothing here deletes, suspends, or ports numbers.",
].join("\n");

export function createServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerPartitionTools(server, api);
  registerAccountTools(server, api);
  registerUserTools(server, api);
  registerNumberTools(server, api);
  registerDeviceTools(server, api);
  registerActivityTools(server, api);
  registerBusinessLineTools(server, api);
  registerHuntGroupTools(server, api);
  registerSipTrunkTools(server, api);
  return server;
}
