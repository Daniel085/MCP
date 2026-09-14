import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACME_ID, BETA_ID, connectTestClient, EXPERIENCE_ID, JANE_ID } from "./helpers.js";

type Ctx = Awaited<ReturnType<typeof connectTestClient>>;

describe("tool surface", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await connectTestClient();
  });
  afterEach(async () => {
    await t.close();
  });

  it("exposes the fourteen designed tools with descriptions and annotations", async () => {
    const { tools } = await t.client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(
      [
        "alianza_auth_status",
        "alianza_check_assignability",
        "alianza_create_assignment",
        "alianza_create_connection",
        "alianza_delete_assignment",
        "alianza_delete_connection",
        "alianza_enable_experience",
        "alianza_get_assignment",
        "alianza_get_connection",
        "alianza_get_user",
        "alianza_list_assignments",
        "alianza_list_connections",
        "alianza_list_users",
        "alianza_set_connection_state",
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toBeDefined();
    }
    const byName = Object.fromEntries(tools.map((x) => [x.name, x]));
    expect(byName.alianza_delete_connection.annotations?.destructiveHint).toBe(true);
    expect(byName.alianza_delete_assignment.annotations?.destructiveHint).toBe(true);
    expect(byName.alianza_enable_experience.annotations?.destructiveHint).toBe(false);
    expect(byName.alianza_list_users.annotations?.readOnlyHint).toBe(true);
  });

  it("auth status reports both credential kinds", async () => {
    const r = await t.call("alianza_auth_status");
    expect(r.isError).toBe(false);
    expect(r.data?.clientCredentials).toBe(true);
    expect(r.data?.userToken.source).toBe("token-file");
    expect(r.data?.ready).toEqual({ assignability: true, userOperations: true });
    expect(r.text).toContain("sandbox");
  });
});

describe("assignability", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await connectTestClient();
  });
  afterEach(async () => {
    await t.close();
  });

  it("uses client credentials and reports assignable numbers", async () => {
    const r = await t.call("alianza_check_assignability", { target_type: "PHONE_NUMBER", target_value: "+14155551234" });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ assignable: true, experienceId: EXPERIENCE_ID });
    expect(r.text).toContain("can be assigned");
  });

  it("reports unknown targets as not assignable", async () => {
    const r = await t.call("alianza_check_assignability", { target_type: "PHONE_NUMBER", target_value: "+14155550000" });
    expect(r.data?.assignable).toBe(false);
    expect(r.text).toContain("cannot be assigned");
  });

  it("rejects a malformed target before any API call", async () => {
    const r = await t.call("alianza_check_assignability", { target_type: "ACCOUNT", target_value: "+14155551234" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("must be a UUID");
  });
});

describe("connections and assignments", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await connectTestClient();
  });
  afterEach(async () => {
    await t.close();
  });

  it("creates a connection, reuses it on a second call, and lists it by number or account", async () => {
    const first = await t.call("alianza_create_connection", { telephone_number: "+14155551234" });
    expect(first.isError).toBe(false);
    expect(first.data).toMatchObject({ created: true, state: "INACTIVE", accountId: ACME_ID, accountName: "Acme Communications" });

    const second = await t.call("alianza_create_connection", { telephone_number: "+14155551235" });
    expect(second.isError).toBe(false);
    expect(second.data).toMatchObject({ created: false, id: first.data?.id });
    expect(second.text).toContain("already exists");

    const byNumber = await t.call("alianza_list_connections", { telephone_number: "+14155551234" });
    expect(byNumber.data?.entities).toHaveLength(1);
    const byAccount = await t.call("alianza_list_connections", { account_id: ACME_ID, experience_id: EXPERIENCE_ID });
    expect(byAccount.data?.entities[0].id).toBe(first.data?.id);

    const none = await t.call("alianza_list_connections", {});
    expect(none.isError).toBe(true);
    expect(none.text).toContain("account_id or telephone_number");
  });

  it("activates, reports no-op on repeat, and deactivates", async () => {
    const c = await t.call("alianza_create_connection", { telephone_number: "+14155551234" });
    const id = c.data?.id as string;

    const on = await t.call("alianza_set_connection_state", { connection_id: id, state: "ACTIVE" });
    expect(on.data).toMatchObject({ state: "ACTIVE", changed: true });

    const again = await t.call("alianza_set_connection_state", { connection_id: id, state: "ACTIVE" });
    expect(again.isError).toBe(false);
    expect(again.data?.changed).toBe(false);
    expect(again.text).toContain("already ACTIVE");

    const off = await t.call("alianza_set_connection_state", { connection_id: id, state: "INACTIVE" });
    expect(off.data).toMatchObject({ state: "INACTIVE", changed: true });

    const got = await t.call("alianza_get_connection", { connection_id: id });
    expect(got.data?.state).toBe("INACTIVE");
  });

  it("assignment lifecycle: create, list by account and by target, get, 409 on duplicate, delete, 404 after", async () => {
    await t.call("alianza_create_connection", { telephone_number: "+14155551234" });
    const created = await t.call("alianza_create_assignment", { target_type: "PHONE_NUMBER", target_value: "+14155551234" });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({ targetType: "PHONE_NUMBER", accountId: ACME_ID, experienceId: EXPERIENCE_ID });
    const id = created.data?.id as string;

    const dup = await t.call("alianza_create_assignment", { target_type: "PHONE_NUMBER", target_value: "+14155551234" });
    expect(dup.isError).toBe(true);
    expect(dup.text).toMatch(/^Conflict:/);
    expect(dup.text).toContain("traceId");

    const byAccount = await t.call("alianza_list_assignments", { account_id: ACME_ID });
    expect(byAccount.data?.entities.map((a: { id: string }) => a.id)).toEqual([id]);
    const byTarget = await t.call("alianza_list_assignments", { target_type: "PHONE_NUMBER", target_value: "+14155551234" });
    expect(byTarget.data?.entities).toHaveLength(1);

    const badFilter = await t.call("alianza_list_assignments", { experience_id: EXPERIENCE_ID });
    expect(badFilter.isError).toBe(true);
    expect(badFilter.text).toContain("requires account_id");

    const got = await t.call("alianza_get_assignment", { assignment_id: id });
    expect(got.data?.id).toBe(id);

    const del = await t.call("alianza_delete_assignment", { assignment_id: id });
    expect(del.isError).toBe(false);
    const gone = await t.call("alianza_get_assignment", { assignment_id: id });
    expect(gone.isError).toBe(true);
    expect(gone.text).toMatch(/not found/i);
  });

  it("delete connection", async () => {
    const c = await t.call("alianza_create_connection", { telephone_number: "+14155559999" });
    const del = await t.call("alianza_delete_connection", { connection_id: c.data?.id });
    expect(del.isError).toBe(false);
    const list = await t.call("alianza_list_connections", { account_id: BETA_ID });
    expect(list.data?.entities).toHaveLength(0);
  });
});

describe("users", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await connectTestClient();
  });
  afterEach(async () => {
    await t.close();
  });

  it("lists with count, sorting, and cursor paging", async () => {
    const first = await t.call("alianza_list_users", { account_id: ACME_ID, page_size: 2, sort_by: "lastName" });
    expect(first.isError).toBe(false);
    expect(first.data?.count).toBe(3);
    expect(first.data?.entities.map((u: { lastName: string }) => u.lastName)).toEqual(["Adams", "Doe"]);
    expect(first.data?.cursor).toBeTruthy();
    expect(first.text).toContain("of 3 total");

    const second = await t.call("alianza_list_users", { account_id: ACME_ID, page_size: 2, sort_by: "lastName", cursor: first.data?.cursor });
    expect(second.data?.entities.map((u: { lastName: string }) => u.lastName)).toEqual(["Smith"]);
    expect(second.data?.cursor).toBeNull();
  });

  it("gets a user and maps 404", async () => {
    const ok = await t.call("alianza_get_user", { user_id: JANE_ID });
    expect(ok.data).toMatchObject({ firstName: "Jane", accountId: ACME_ID });
    const missing = await t.call("alianza_get_user", { user_id: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not found/i);
  });
});

describe("enable experience (composite)", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await connectTestClient();
  });
  afterEach(async () => {
    await t.close();
  });

  it("runs all four steps for a Post-Call account target and converges on re-run", async () => {
    const r = await t.call("alianza_enable_experience", { telephone_number: "+14155551234" });
    expect(r.isError).toBe(false);
    expect(r.data?.connection).toMatchObject({ state: "ACTIVE", accountId: ACME_ID });
    expect(r.data?.assignment).toMatchObject({ targetType: "ACCOUNT", targetValue: ACME_ID });
    expect(r.data?.steps.map((s: { step: string }) => s.step)).toEqual(["check assignability", "connection", "assignment", "activate"]);
    expect(r.text).toContain("is enabled for ACCOUNT");

    const again = await t.call("alianza_enable_experience", { telephone_number: "+14155551235" });
    expect(again.isError).toBe(false);
    const outcomes = again.data?.steps.map((s: { outcome: string }) => s.outcome).join(" | ");
    expect(outcomes).toContain("reused existing");
    expect(outcomes).toContain("already ACTIVE");
    expect(again.data?.connection.id).toBe(r.data?.connection.id);
    expect(again.data?.assignment.id).toBe(r.data?.assignment.id);
  });

  it("handles a Virtual Agent phone-number target", async () => {
    const r = await t.call("alianza_enable_experience", { telephone_number: "+14155559999", target_type: "PHONE_NUMBER" });
    expect(r.isError).toBe(false);
    expect(r.data?.assignment).toMatchObject({ targetType: "PHONE_NUMBER", targetValue: "+14155559999", accountId: BETA_ID });
  });

  it("stops before changing anything when the target is not assignable", async () => {
    const r = await t.call("alianza_enable_experience", { telephone_number: "+14155550000" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Nothing was changed");
    const list = await t.call("alianza_list_connections", { telephone_number: "+14155550000" });
    expect(list.data?.entities).toHaveLength(0);
  });
});

describe("credentials", () => {
  it("refreshes an expired user token transparently", async () => {
    const t = await connectTestClient({ userToken: "expired" });
    try {
      const r = await t.call("alianza_list_users", { account_id: ACME_ID });
      expect(r.isError).toBe(false);
      expect(r.data?.count).toBe(3);
      const status = await t.call("alianza_auth_status");
      expect(status.data?.userToken.canRefresh).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("works from a refresh token in the environment", async () => {
    const t = await connectTestClient({ userToken: "none", envRefreshToken: "rt-good" });
    try {
      const r = await t.call("alianza_get_user", { user_id: JANE_ID });
      expect(r.isError).toBe(false);
    } finally {
      await t.close();
    }
  });

  it("tells the model to log in when no user credentials exist, but assignability still works", async () => {
    const t = await connectTestClient({ userToken: "none" });
    try {
      const users = await t.call("alianza_list_users", {});
      expect(users.isError).toBe(true);
      expect(users.text).toContain("alianza-mcp login");
      const check = await t.call("alianza_check_assignability", { target_type: "ACCOUNT", target_value: ACME_ID });
      expect(check.isError).toBe(false);
      const status = await t.call("alianza_auth_status");
      expect(status.data?.ready).toEqual({ assignability: true, userOperations: false });
    } finally {
      await t.close();
    }
  });

  it("maps a missing scope to actionable text", async () => {
    const t = await connectTestClient({ userToken: "none", staticAccessToken: "read-only-token" });
    try {
      const r = await t.call("alianza_list_users", {});
      expect(r.isError).toBe(true);
      expect(r.text).toContain("users:manage");
    } finally {
      await t.close();
    }
  });

  it("requires an experience id from the argument or the environment", async () => {
    const t = await connectTestClient({ experienceId: "" });
    try {
      const r = await t.call("alianza_check_assignability", { target_type: "ACCOUNT", target_value: ACME_ID });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("ALIANZA_EXPERIENCE_ID");
    } finally {
      await t.close();
    }
  });
});
