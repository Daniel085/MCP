/**
 * Builds a fully registered McpServer. Called once for stdio and once per
 * request for stateless HTTP, so keep construction cheap.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./api-client.js";
import { registerItemTools } from "./tools/items.js";

export const SERVER_NAME = "mcp-server-template";
export const SERVER_VERSION = "0.1.0";

export function createServer(api: ApiClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tools for working with items in the Items API. Prefer list_items for discovery and get_item when an id is known.",
    },
  );
  registerItemTools(server, api);
  return server;
}
