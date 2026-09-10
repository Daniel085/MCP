/**
 * Example tools wrapping the fictional Items API.
 *
 * Replace this file with tools designed per docs/02-design-tools-from-an-api.md.
 * Keep the pattern: typed inputs, trimmed outputs, errors returned as isError
 * results (see ./errors.ts), honest annotations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, type Item } from "../api-client.js";
import { log } from "../log.js";
import { withErrorHandling } from "./errors.js";

const itemShape = {
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
};

/** Trim the upstream record to what the model needs. */
function toItemView(item: Item) {
  return { id: item.id, name: item.name, description: item.description, createdAt: item.createdAt };
}

export function registerItemTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "List or search items. Use this when the user does not give an exact item id; " +
        "use get_item when they do. Returns up to `limit` items (id, name, description, createdAt) " +
        "and the total count. Pass `offset` to page through more results.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Free-text filter on name and description."),
        limit: z.number().int().min(1).max(100).default(10).describe("Maximum items to return."),
        offset: z.number().int().min(0).default(0).describe("Number of items to skip for paging."),
      },
      outputSchema: {
        items: z.array(z.object(itemShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, offset }) =>
      withErrorHandling("list_items", async () => {
        const page = await api.listItems({ query, limit, offset });
        const items = page.items.map(toItemView);
        const shown = offset + items.length;
        const more = shown < page.total ? ` Pass offset=${shown} for the next page.` : "";
        const text =
          items.length === 0
            ? "No items matched."
            : `Showing ${offset + 1}-${shown} of ${page.total}.${more}\n` +
              items.map((i) => `- ${i.id}: ${i.name}${i.description ? ` (${i.description})` : ""}`).join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { items, total: page.total, offset, limit },
        };
      }),
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description:
        "Fetch one item by its id (for example itm_1). Use list_items first if you only have a name.",
      inputSchema: {
        id: z.string().min(1).describe("Item id, e.g. itm_1"),
      },
      outputSchema: itemShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) =>
      withErrorHandling("get_item", async () => {
        const item = toItemView(await api.getItem(id));
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
          structuredContent: item,
        };
      }),
  );

  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create a new item. Confirm the name with the user before calling. Returns the created item including its new id.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Display name for the item."),
        description: z.string().max(2000).optional().describe("Optional longer description."),
      },
      outputSchema: itemShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, description }) =>
      withErrorHandling("create_item", async () => {
        const item = toItemView(await api.createItem({ name, description }));
        log.info("item created", { id: item.id });
        return {
          content: [{ type: "text", text: `Created item ${item.id} (${item.name}).` }],
          structuredContent: item,
        };
      }),
  );
}
