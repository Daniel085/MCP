import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTestClient } from "./helpers.js";

describe("items tools", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;

  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("lists exactly the designed tools with descriptions and annotations", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_item", "get_item", "list_items"]);
    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.annotations, `${tool.name} needs annotations`).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
    const get = tools.find((t) => t.name === "get_item")!;
    expect(get.annotations?.readOnlyHint).toBe(true);
    const create = tools.find((t) => t.name === "create_item")!;
    expect(create.annotations?.readOnlyHint).toBe(false);
    expect(create.annotations?.destructiveHint).toBe(false);
  });

  it("list_items returns a trimmed page with paging hint", async () => {
    const result = await ctx.client.callTool({ name: "list_items", arguments: { limit: 2 } });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { items: unknown[]; total: number };
    expect(structured.items).toHaveLength(2);
    expect(structured.total).toBe(3);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Showing 1-2 of 3");
    expect(text).toContain("offset=2");
  });

  it("list_items filters by query", async () => {
    const result = await ctx.client.callTool({ name: "list_items", arguments: { query: "gizmo" } });
    const structured = result.structuredContent as { items: Array<{ id: string }> };
    expect(structured.items.map((i) => i.id)).toEqual(["itm_3"]);
  });

  it("get_item returns the item", async () => {
    const result = await ctx.client.callTool({ name: "get_item", arguments: { id: "itm_1" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "itm_1", name: "Widget" });
  });

  it("get_item maps 404 to an isError result", async () => {
    const result = await ctx.client.callTool({ name: "get_item", arguments: { id: "itm_404" } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/not found/i);
    expect(text).toContain("itm_404");
  });

  it("create_item creates and returns the new item", async () => {
    const result = await ctx.client.callTool({
      name: "create_item",
      arguments: { name: "Thing", description: "made in test" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "itm_4", name: "Thing", description: "made in test" });
    const fetched = await ctx.client.callTool({ name: "get_item", arguments: { id: "itm_4" } });
    expect(fetched.structuredContent).toMatchObject({ name: "Thing" });
  });

  it("rejects invalid arguments before the tool runs", async () => {
    const result = await ctx.client.callTool({ name: "list_items", arguments: { limit: 0 } });
    expect(result.isError).toBe(true);
  });
});

describe("authentication failures", () => {
  it("maps 401 from the upstream API to an isError result", async () => {
    const ctx = await connectTestClient({ apiKey: "bad-key" });
    try {
      const result = await ctx.client.callTool({ name: "list_items", arguments: {} });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/authentication/i);
      expect(text).not.toContain("bad-key");
    } finally {
      await ctx.close();
    }
  });
});
