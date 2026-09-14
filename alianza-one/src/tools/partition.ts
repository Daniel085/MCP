/**
 * Partition and login context. The first tool a model should reach for when
 * it does not know which partition it is working in.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import { compact, jsonText, partitionIdInput } from "./common.js";
import { withErrorHandling } from "./errors.js";

export function registerPartitionTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_get_partition",
    {
      title: "Get partition and login context",
      description:
        "Describe the Alianza partition this server works in and the API user it is logged in as. " +
        "Call this first when you need the partition id, its sub-partitions, default time zone, or to check which " +
        "permissions the configured login has. Returns the partition (id, name, status, country, default time zone, " +
        "sub-partition ids, device inventory rules) and the login (username, user type, home partition, permissions summary). " +
        "Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
      },
      outputSchema: {
        partition: z.object({
          id: z.string(),
          name: z.string().optional(),
          status: z.string().optional(),
          parentId: z.string().optional(),
          country: z.string().optional(),
          customerServiceNumber: z.string().optional(),
          defaultTimeZone: z.string().optional(),
          defaultExtensionLength: z.number().optional(),
          subPartitionIds: z.array(z.string()).optional(),
          tnDeleteCooldownDays: z.number().optional(),
          requiresDeviceInventory: z.boolean().optional(),
          allowedDeviceTypes: z.array(z.string()).optional(),
        }),
        login: z.object({
          username: z.string().optional(),
          userType: z.string().optional(),
          partitionId: z.string().optional(),
          partitionName: z.string().optional(),
          subPartitionIds: z.array(z.string()).optional(),
          permissions: z.record(z.string(), z.string()).optional(),
        }),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId }) =>
      withErrorHandling("alianza_get_partition", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const [partition, info] = await Promise.all([api.getPartition(pid), api.getLoginInfo()]);
        const out = {
          partition: compact({
            id: partition.id ?? pid,
            name: partition.name,
            status: partition.status,
            parentId: partition.parentId,
            country: partition.country,
            customerServiceNumber: partition.customerServiceNumber,
            defaultTimeZone: partition.defaultTimeZone,
            defaultExtensionLength: partition.defaultExtensionLength,
            subPartitionIds: partition.subPartitionIds,
            tnDeleteCooldownDays: partition.tnDeleteCooldownDays,
            requiresDeviceInventory: partition.requiresDeviceInventory,
            allowedDeviceTypes: partition.allowedDeviceTypes,
          }),
          login: compact({
            username: info.username,
            userType: info.userType,
            partitionId: info.partitionId,
            partitionName: info.partitionName,
            subPartitionIds: info.subPartitionIds,
            permissions: info.permissions,
          }),
        };
        const subs = out.partition.subPartitionIds?.length
          ? ` Sub-partitions: ${out.partition.subPartitionIds.join(", ")}.`
          : "";
        const text =
          `Partition ${out.partition.id} (${out.partition.name ?? "unnamed"}, ${out.partition.status ?? "status unknown"}).` +
          ` Logged in as ${out.login.username ?? "unknown"} (${out.login.userType ?? "unknown type"}).${subs}\n` +
          jsonText(out);
        return { content: [{ type: "text", text }], structuredContent: out };
      }),
  );
}
