import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTestClient, textOf } from "./helpers.js";

const EXPECTED_TOOLS = [
  "alianza_add_phone_number",
  "alianza_create_account",
  "alianza_create_device_line",
  "alianza_create_user",
  "alianza_get_account",
  "alianza_get_account_history",
  "alianza_get_partition",
  "alianza_get_phone_number",
  "alianza_get_user",
  "alianza_list_devices",
  "alianza_list_phone_numbers",
  "alianza_list_users",
  "alianza_list_voicemails",
  "alianza_reserve_phone_number",
  "alianza_search_accounts",
  "alianza_search_available_numbers",
  "alianza_search_call_records",
  "alianza_search_number_orders",
  "alianza_set_phone_number_destination",
  "alianza_validate_address",
];

describe("tool registry", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("lists exactly the designed tools, each with a description, annotations, and an object schema", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} description is too short`).toBeGreaterThan(80);
      expect(tool.annotations, `${tool.name} needs annotations`).toBeDefined();
      expect(tool.annotations?.openWorldHint, `${tool.name} hits a remote API`).toBe(true);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema, `${tool.name} needs an output schema`).toBeDefined();
    }
  });

  it("marks reads read-only and writes non-destructive", async () => {
    const { tools } = await ctx.client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const writes = [
      "alianza_create_account",
      "alianza_create_user",
      "alianza_add_phone_number",
      "alianza_set_phone_number_destination",
      "alianza_create_device_line",
      "alianza_reserve_phone_number",
    ];
    for (const name of EXPECTED_TOOLS) {
      const a = byName[name].annotations!;
      if (writes.includes(name)) {
        expect(a.readOnlyHint, name).toBe(false);
        expect(a.destructiveHint, name).toBe(false);
      } else {
        expect(a.readOnlyHint, name).toBe(true);
      }
    }
  });

  it("describes every input property", async () => {
    const { tools } = await ctx.client.listTools();
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [key, schema] of Object.entries(props)) {
        expect(schema.description, `${tool.name}.${key} needs a description`).toBeTruthy();
      }
    }
  });

  it("rejects invalid arguments before the tool runs", async () => {
    const result = await ctx.call("alianza_search_accounts", { query: "acme", limit: 0 });
    expect(result.isError).toBe(true);
    const bad = await ctx.call("alianza_search_call_records", {
      accountId: "acc_1",
      startDate: "09/10/2026",
      endDate: "2026-09-11",
    });
    expect(bad.isError).toBe(true);
  });
});

describe("authentication", () => {
  it("logs in lazily with username/password and sends X-AUTH-TOKEN", async () => {
    const ctx = await connectTestClient();
    try {
      expect(ctx.fake.loginCount).toBe(0);
      const result = await ctx.call("alianza_get_partition");
      expect(result.isError).toBeFalsy();
      expect(ctx.fake.loginCount).toBe(1);
      await ctx.call("alianza_search_accounts", { query: "acme" });
      expect(ctx.fake.loginCount).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it("re-logs in once when the token expires", async () => {
    const ctx = await connectTestClient();
    try {
      await ctx.call("alianza_get_partition");
      ctx.fake.expireTokens();
      const result = await ctx.call("alianza_search_accounts", { query: "acme" });
      expect(result.isError).toBeFalsy();
      expect(ctx.fake.loginCount).toBe(2);
    } finally {
      await ctx.close();
    }
  });

  it("maps bad credentials to an isError result without leaking them", async () => {
    const ctx = await connectTestClient({ password: "wrong-password" });
    try {
      const result = await ctx.call("alianza_search_accounts", { query: "acme" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/authentication with alianza failed/i);
      expect(textOf(result)).not.toContain("wrong-password");
    } finally {
      await ctx.close();
    }
  });

  it("works with a pre-issued token and does not retry when it is rejected", async () => {
    const bootstrap = await connectTestClient();
    let token: string;
    try {
      await bootstrap.call("alianza_get_partition");
      token = (bootstrap.api as unknown as { token: string }).token;
    } finally {
      await bootstrap.close();
    }
    const ctx = await connectTestClient({ authToken: "tok_not_issued", partitionId: "prt_1" });
    try {
      const result = await ctx.call("alianza_search_accounts", { query: "acme" });
      expect(result.isError).toBe(true);
      expect(ctx.fake.loginCount).toBe(0);
      expect(token).toMatch(/^tok_/);
    } finally {
      await ctx.close();
    }
  });
});

describe("partition and accounts", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_get_partition returns partition and login context", async () => {
    const result = await ctx.call("alianza_get_partition");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      partition: { id: "prt_1", name: "Acme Telecom", subPartitionIds: ["prt_1_sub"] },
      login: { username: "api@example.com", partitionId: "prt_1" },
    });
    expect(textOf(result)).toContain("prt_1_sub");
  });

  it("alianza_get_partition honours an explicit sub-partition id and 404s on unknown ones", async () => {
    const sub = await ctx.call("alianza_get_partition", { partitionId: "prt_1_sub" });
    expect(sub.structuredContent).toMatchObject({ partition: { id: "prt_1_sub", parentId: "prt_1" } });
    const missing = await ctx.call("alianza_get_partition", { partitionId: "prt_nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/not found/i);
  });

  it("alianza_search_accounts matches names, numbers, emails, phone numbers, and MACs", async () => {
    for (const [query, id] of [
      ["acme", "acc_1"],
      ["HOME-2002", "acc_2"],
      ["jane@acmedental.example", "acc_1"],
      ["18015551002", "acc_1"],
      ["c4e90a445566", "acc_2"],
    ]) {
      const result = await ctx.call("alianza_search_accounts", { query });
      expect(result.isError, query).toBeFalsy();
      const hits = (result.structuredContent as { accounts: Array<{ id: string }> }).accounts;
      expect(hits.map((h) => h.id), query).toEqual([id]);
    }
    const none = await ctx.call("alianza_search_accounts", { query: "zzz" });
    expect(textOf(none)).toMatch(/no accounts matched/i);
  });

  it("alianza_search_accounts pages client-side", async () => {
    const result = await ctx.call("alianza_search_accounts", { query: "1", limit: 1 });
    const sc = result.structuredContent as { accounts: unknown[]; total: number };
    expect(sc.accounts).toHaveLength(1);
    expect(sc.total).toBe(2);
    expect(textOf(result)).toContain("offset=1");
  });

  it("alianza_get_account resolves by id, account number, phone number, and MAC address", async () => {
    const byId = await ctx.call("alianza_get_account", { id: "acc_1" });
    expect(byId.structuredContent).toMatchObject({ id: "acc_1", accountNumber: "ACME-1001", accountType: "ADVANCED" });
    const byNumber = await ctx.call("alianza_get_account", { id: "HOME-2002", lookupBy: "AccountNumber" });
    expect(byNumber.structuredContent).toMatchObject({ id: "acc_2", status: "SUSPENDED" });
    const byTn = await ctx.call("alianza_get_account", { id: "18015551001", lookupBy: "PhoneNumber" });
    expect(byTn.structuredContent).toMatchObject({ id: "acc_1" });
    const byMac = await ctx.call("alianza_get_account", { id: "c4e90a445566", lookupBy: "MacAddress" });
    expect(byMac.structuredContent).toMatchObject({ id: "acc_2" });
    const plans = (byId.structuredContent as { callingPlans: Array<{ minutesRemaining: number }> }).callingPlans;
    expect(plans[0].minutesRemaining).toBe(19000);
  });

  it("alianza_get_account maps 404 to an isError result", async () => {
    const result = await ctx.call("alianza_get_account", { id: "acc_404" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not found/i);
    expect(textOf(result)).toContain("acc_404");
  });

  it("alianza_create_account creates a business account and reports the id", async () => {
    const result = await ctx.call("alianza_create_account", {
      accountNumber: "SP-123",
      accountName: "Customer Name",
      accountType: "ADVANCED",
      timeZone: "US/Mountain",
      extensionLength: 4,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "acc_3",
      accountNumber: "SP-123",
      status: "ACTIVE",
      platformType: "CPE2",
      billingCycleDay: 1,
      extensionLength: 4,
    });
    expect(textOf(result)).toContain("alianza_create_user");
    const fetched = await ctx.call("alianza_get_account", { id: "SP-123", lookupBy: "AccountNumber" });
    expect(fetched.structuredContent).toMatchObject({ id: "acc_3" });
  });

  it("alianza_create_account surfaces upstream validation errors", async () => {
    const dup = await ctx.call("alianza_create_account", {
      accountNumber: "ACME-1001",
      accountName: "Duplicate",
      timeZone: "US/Mountain",
      extensionLength: 4,
    });
    expect(dup.isError).toBe(true);
    expect(textOf(dup)).toMatch(/already exists/i);
  });

  it("alianza_get_account_history filters by type and date", async () => {
    const all = await ctx.call("alianza_get_account_history", { accountId: "acc_1" });
    expect(all.isError).toBeFalsy();
    expect((all.structuredContent as { total: number }).total).toBe(3);
    expect(textOf(all)).toContain("RingPhone -> ForwardAlways");

    const filtered = await ctx.call("alianza_get_account_history", {
      accountId: "acc_1",
      historyTypes: ["PHONE_NUMBER"],
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const sc = filtered.structuredContent as { total: number; records: Array<{ historyType: string; changedBy: string }> };
    expect(sc.total).toBe(1);
    expect(sc.records[0]).toMatchObject({ historyType: "PHONE_NUMBER", changedBy: "api@example.com" });
  });
});

describe("users", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_users summarises users with device counts", async () => {
    const result = await ctx.call("alianza_list_users", { accountId: "acc_1" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { users: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(2);
    expect(sc.users[0]).toMatchObject({ id: "usr_1", extension: "1001", deviceCount: 1, userProductPlan: "PROFESSIONAL" });
    expect(sc.users[0]).not.toHaveProperty("callHandlingSettings");
    expect(textOf(result)).toContain("ext 1001");
  });

  it("alianza_get_user returns call handling, devices, and looks up by username", async () => {
    const result = await ctx.call("alianza_get_user", { accountId: "acc_1", userId: "usr_1" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "usr_1",
      callHandling: { mode: "RingPhone", noAnswer: "Voicemail after 20s", unregistered: "Forward to 18015559999" },
      devices: [{ id: "dev_1", macAddress: "0004f2aabbcc" }],
      callerIdNumber: "18015551001",
    });
    const byName = await ctx.call("alianza_get_user", { accountId: "acc_1", userId: "john.smith", lookupBy: "UserName" });
    expect(byName.structuredContent).toMatchObject({ id: "usr_2", callHandling: { mode: "ForwardAlways", forwardAlwaysTo: "18015557777" } });
    const missing = await ctx.call("alianza_get_user", { accountId: "acc_1", userId: "usr_9" });
    expect(missing.isError).toBe(true);
  });

  it("alianza_create_user copies the account time zone and returns the new user", async () => {
    const result = await ctx.call("alianza_create_user", {
      accountId: "acc_1",
      firstName: "Sam",
      lastName: "Lee",
      extension: "1003",
      userProductPlan: "STANDARD",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "usr_4",
      firstName: "Sam",
      extension: "1003",
      timeZone: "US/Mountain",
      endUserType: "STANDARD",
      voicemailBoxId: "vmb_4",
    });
    const list = await ctx.call("alianza_list_users", { accountId: "acc_1" });
    expect((list.structuredContent as { total: number }).total).toBe(3);
  });

  it("alianza_create_user rejects portal access without login details, and upstream errors", async () => {
    const local = await ctx.call("alianza_create_user", {
      accountId: "acc_1",
      firstName: "Sam",
      lastName: "Lee",
      allowPortalAccess: true,
    });
    expect(local.isError).toBe(true);
    expect(textOf(local)).toMatch(/username and emailAddress/);
    const upstream = await ctx.call("alianza_create_user", {
      accountId: "acc_1",
      firstName: "Sam",
      lastName: "Lee",
      extension: "12345",
    });
    expect(upstream.isError).toBe(true);
    expect(textOf(upstream)).toMatch(/4 digits/);
  });
});

describe("phone numbers", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_phone_numbers shows routing, carrier status, and E911 address", async () => {
    const result = await ctx.call("alianza_list_phone_numbers", { accountId: "acc_1" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { phoneNumbers: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(2);
    expect(sc.phoneNumbers[0]).toMatchObject({
      phoneNumber: "18015551001",
      referenceType: "END_USER",
      referenceId: "usr_1",
      carrierStatus: "ACTIVE",
      callerIdName: "ACME DENTAL",
      e911Address: "333 S 520 W, Lindon UT 84042, USA",
    });
    expect(sc.phoneNumbers[1]).toMatchObject({ carrierStatus: "PORT_PENDING", portId: "port_77" });
    expect(textOf(result)).toContain("port port_77");
    const empty = await ctx.call("alianza_list_phone_numbers", { accountId: "acc_404" });
    expect(empty.isError).toBe(true);
  });

  it("alianza_get_phone_number combines inventory and account views and normalises input", async () => {
    const assigned = await ctx.call("alianza_get_phone_number", { phoneNumber: "(801) 555-1001" });
    expect(assigned.isError).toBeFalsy();
    expect(assigned.structuredContent).toMatchObject({
      inventory: { phoneNumber: "18015551001", accountId: "acc_1", isInInventory: false },
      onAccount: { referenceType: "END_USER", referenceId: "usr_1" },
    });
    expect(textOf(assigned)).toContain("on account acc_1");

    const free = await ctx.call("alianza_get_phone_number", { phoneNumber: "18015550100" });
    expect(free.structuredContent).toMatchObject({ inventory: { isInInventory: true } });
    expect((free.structuredContent as { onAccount?: unknown }).onAccount).toBeUndefined();
    expect(textOf(free)).toContain("in partition inventory");

    const bad = await ctx.call("alianza_get_phone_number", { phoneNumber: "+44 20 7946 0958" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/not a valid North American phone number/);

    const missing = await ctx.call("alianza_get_phone_number", { phoneNumber: "19995550000" });
    expect(missing.isError).toBe(true);
  });

  it("alianza_search_available_numbers searches by postal code, lat/long, rate center, and prefix", async () => {
    const zip = await ctx.call("alianza_search_available_numbers", { query: "84042", maxResults: 2 });
    expect(zip.isError).toBeFalsy();
    expect((zip.structuredContent as { total: number }).total).toBe(2);
    expect(textOf(zip)).toContain("18015550100 (LINDON, UT, 1.2 mi)");

    const latlong = await ctx.call("alianza_search_available_numbers", {
      searchType: "LAT_LONG",
      latitude: 40.33,
      longitude: -111.72,
    });
    expect((latlong.structuredContent as { total: number }).total).toBe(3);

    const rc = await ctx.call("alianza_search_available_numbers", { searchType: "RATECENTER", query: "PLEASANT GROVE.UT" });
    expect((rc.structuredContent as { phoneNumbers: Array<{ phoneNumber: string }> }).phoneNumbers.map((n) => n.phoneNumber)).toEqual(["18017690817"]);

    const prefix = await ctx.call("alianza_search_available_numbers", { searchType: "TN", query: "1801769" });
    expect((prefix.structuredContent as { total: number }).total).toBe(1);

    const tollFree = await ctx.call("alianza_search_available_numbers", { query: "84042", functionType: "TollFree" });
    expect((tollFree.structuredContent as { phoneNumbers: Array<{ phoneNumber: string }> }).phoneNumbers[0].phoneNumber).toBe("18885550199");

    const none = await ctx.call("alianza_search_available_numbers", { query: "10001" });
    expect(textOf(none)).toMatch(/no available numbers/i);
  });

  it("alianza_search_available_numbers validates argument combinations locally", async () => {
    const noCoords = await ctx.call("alianza_search_available_numbers", { searchType: "LAT_LONG" });
    expect(noCoords.isError).toBe(true);
    const noQuery = await ctx.call("alianza_search_available_numbers", { searchType: "POSTALCODE" });
    expect(noQuery.isError).toBe(true);
  });

  it("alianza_reserve_phone_number reserves, hides from search, and releases", async () => {
    const reserve = await ctx.call("alianza_reserve_phone_number", { phoneNumber: "18015550100" });
    expect(reserve.isError).toBeFalsy();
    expect(reserve.structuredContent).toMatchObject({ phoneNumber: "18015550100", reserved: true });
    const search = await ctx.call("alianza_search_available_numbers", { query: "84042" });
    expect(textOf(search)).not.toContain("18015550100");
    const release = await ctx.call("alianza_reserve_phone_number", { phoneNumber: "18015550100", action: "release" });
    expect(release.isError).toBeFalsy();
    expect(release.structuredContent).toMatchObject({ reserved: false });
    const again = await ctx.call("alianza_reserve_phone_number", { phoneNumber: "18015550100", action: "release" });
    expect(again.isError).toBe(true);
    const taken = await ctx.call("alianza_reserve_phone_number", { phoneNumber: "18015551001" });
    expect(taken.isError).toBe(true);
  });

  it("alianza_validate_address returns parsed fields, coordinates, and required fields", async () => {
    const ok = await ctx.call("alianza_validate_address", { address: "333 S 520 W, Lindon, UT", postalCode: "84042" });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({
      valid: true,
      latitude: "40.332486",
      address: { streetNumber: "333", preDirectional: "S", streetName: "520", postDirectional: "W", city: "Lindon", state: "UT" },
      formatted: "333 S 520 W, Lindon UT 84042, USA",
    });
    const unit = await ctx.call("alianza_validate_address", { address: "500 Tower Plaza, Lindon, UT" });
    expect(textOf(unit)).toContain("Still required: unit, secondaryLocationDescription");
    const bad = await ctx.call("alianza_validate_address", { address: "1 Nowhere Lane, Nowhere, ZZ" });
    expect(bad.structuredContent).toMatchObject({ valid: false });
    expect(textOf(bad)).toMatch(/not validated/i);
  });

  it("alianza_search_number_orders filters by number, status, type, and account", async () => {
    const all = await ctx.call("alianza_search_number_orders", {});
    expect(all.isError).toBeFalsy();
    expect((all.structuredContent as { total: number }).total).toBe(3);

    const port = await ctx.call("alianza_search_number_orders", { phoneNumber: "18015551002" });
    const sc = port.structuredContent as { orders: Array<Record<string, unknown>> };
    expect(sc.orders).toHaveLength(1);
    expect(sc.orders[0]).toMatchObject({
      id: "sae_2",
      serviceType: "PORT_REQUEST",
      status: "FOC_RECEIVED",
      focDate: "2026-09-20T07:00:00Z",
      losingCarrier: "Lumen",
      editableFields: ["crdDate"],
      lastLog: { status: "FOC_RECEIVED", message: "FOC 2026-09-20" },
    });
    expect(textOf(port)).toContain("FOC 2026-09-20");

    const rejected = await ctx.call("alianza_search_number_orders", { statuses: ["REJECTED"], orderTypes: ["PORT_REQUEST"] });
    const rej = rejected.structuredContent as { orders: Array<{ id: string; lastLog: { message: string } }> };
    expect(rej.orders.map((o) => o.id)).toEqual(["sae_3"]);
    expect(rej.orders[0].lastLog.message).toMatch(/address mismatch/i);

    const byAccount = await ctx.call("alianza_search_number_orders", { accountId: "acc_2" });
    expect((byAccount.structuredContent as { total: number }).total).toBe(1);
  });

  it("alianza_add_phone_number activates an inventory number and creates an order", async () => {
    const result = await ctx.call("alianza_add_phone_number", {
      accountId: "acc_1",
      phoneNumber: "18015550100",
      customerType: "BUSINESS",
      businessName: "Acme Dental",
      streetNumber: "333",
      preDirectional: "S",
      streetName: "520",
      postDirectional: "W",
      city: "Lindon",
      state: "ut",
      postalCode: "84042",
      latitude: "40.332486",
      longitude: "-111.728156",
      referenceType: "END_USER",
      referenceId: "usr_2",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      accountId: "acc_1",
      holdActivation: false,
      phoneNumbers: [{ phoneNumber: "18015550100", referenceType: "END_USER", referenceId: "usr_2" }],
    });
    expect(textOf(result)).toContain("Routed to END_USER usr_2");

    const onAccount = await ctx.call("alianza_get_phone_number", { phoneNumber: "18015550100" });
    expect(onAccount.structuredContent).toMatchObject({
      onAccount: { accountId: "acc_1", carrierStatus: "ACTIVATION_PENDING", callerIdName: "Acme Dental", e911Address: "333 S 520 W, Lindon UT 84042, USA" },
    });
    const raw = ctx.fake.state.numbers.find((n) => n.phoneNumber === "18015550100")!;
    expect(raw.customerServiceRecord?.state).toBe("UT");
    expect(raw.e911Address?.latitude).toBe("40.332486");
    expect(raw.directoryListing).toMatchObject({ listed: false, type: "NOT_LIST_NOT_PUBLISH" });

    const orders = await ctx.call("alianza_search_number_orders", { phoneNumber: "18015550100" });
    expect((orders.structuredContent as { orders: Array<{ status: string }> }).orders[0].status).toBe("PENDING");
  });

  it("alianza_add_phone_number supports activation hold and residential records", async () => {
    const result = await ctx.call("alianza_add_phone_number", {
      accountId: "acc_2",
      phoneNumber: "18015550101",
      customerType: "RESIDENTIAL",
      firstName: "Bob",
      lastName: "Jones",
      streetNumber: "100",
      streetName: "Main",
      streetSuffix: "St",
      city: "Los Angeles",
      state: "CA",
      postalCode: "90001",
      unit: "2",
      secondaryLocationDescription: "APARTMENT",
      directoryListingType: "LIST_PUBLISH",
      holdActivation: true,
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("on hold");
    const raw = ctx.fake.state.numbers.find((n) => n.phoneNumber === "18015550101")!;
    expect(raw.customerServiceRecord?.customerName).toBe("Jones Bob");
    expect(raw.directoryListing).toMatchObject({ listed: true, type: "LIST_PUBLISH", address: { unit: "2" } });
    expect(raw.carrierStatus).toBe("ACTIVATION_ON_HOLD");
  });

  it("alianza_add_phone_number rejects incomplete input locally and unavailable numbers upstream", async () => {
    const base = {
      accountId: "acc_1",
      streetNumber: "333",
      streetName: "520",
      city: "Lindon",
      state: "UT",
      postalCode: "84042",
    };
    const noName = await ctx.call("alianza_add_phone_number", { ...base, phoneNumber: "18015550100", customerType: "RESIDENTIAL" });
    expect(noName.isError).toBe(true);
    expect(textOf(noName)).toMatch(/firstName and lastName/);
    const noBiz = await ctx.call("alianza_add_phone_number", { ...base, phoneNumber: "18015550100", customerType: "BUSINESS" });
    expect(noBiz.isError).toBe(true);
    const halfRef = await ctx.call("alianza_add_phone_number", { ...base, phoneNumber: "18015550100", customerType: "BUSINESS", businessName: "X", referenceType: "END_USER" });
    expect(halfRef.isError).toBe(true);
    const taken = await ctx.call("alianza_add_phone_number", { ...base, phoneNumber: "18015551001", customerType: "BUSINESS", businessName: "Acme Dental" });
    expect(taken.isError).toBe(true);
    expect(textOf(taken)).toMatch(/not available in inventory/);
  });

  it("alianza_set_phone_number_destination reroutes a number and can set caller id", async () => {
    const result = await ctx.call("alianza_set_phone_number_destination", {
      accountId: "acc_1",
      phoneNumber: "18015551002",
      referenceType: "END_USER",
      referenceId: "usr_1",
      assignAsCallerId: true,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ phoneNumber: "18015551002", referenceType: "END_USER", referenceId: "usr_1", assignAsCallerId: true });
    expect(textOf(result)).toContain("caller id");
    const user = await ctx.call("alianza_get_user", { accountId: "acc_1", userId: "usr_1" });
    expect(user.structuredContent).toMatchObject({ callerIdNumber: "18015551002" });

    const wrongUser = await ctx.call("alianza_set_phone_number_destination", {
      accountId: "acc_1",
      phoneNumber: "18015551002",
      referenceType: "END_USER",
      referenceId: "usr_3",
    });
    expect(wrongUser.isError).toBe(true);
    expect(textOf(wrongUser)).toMatch(/not on this account/);
  });
});

describe("devices", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_devices lists, filters by MAC and user, and reports registration on request", async () => {
    const all = await ctx.call("alianza_list_devices", { accountId: "acc_1" });
    expect(all.isError).toBeFalsy();
    const sc = all.structuredContent as { devices: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(2);
    expect(sc.devices[0]).not.toHaveProperty("registered");

    const withReg = await ctx.call("alianza_list_devices", { accountId: "acc_1", includeRegistration: true });
    const devices = (withReg.structuredContent as { devices: Array<{ id: string; registered: boolean }> }).devices;
    expect(devices.map((d) => [d.id, d.registered])).toEqual([
      ["dev_1", true],
      ["dev_2", false],
    ]);
    expect(textOf(withReg)).toContain("NOT REGISTERED");

    const byMac = await ctx.call("alianza_list_devices", { accountId: "acc_1", macAddress: "80:5E:C0:11:22:33" });
    expect((byMac.structuredContent as { devices: Array<{ id: string }> }).devices.map((d) => d.id)).toEqual(["dev_2"]);
    const byUser = await ctx.call("alianza_list_devices", { accountId: "acc_1", userId: "usr_1" });
    expect((byUser.structuredContent as { devices: Array<{ id: string }> }).devices.map((d) => d.id)).toEqual(["dev_1"]);
    const badMac = await ctx.call("alianza_list_devices", { accountId: "acc_1", macAddress: "nope" });
    expect(badMac.isError).toBe(true);
  });

  it("alianza_create_device_line creates a line and validates device type upstream", async () => {
    const result = await ctx.call("alianza_create_device_line", {
      accountId: "acc_1",
      userId: "usr_2",
      deviceName: "Break room",
      deviceTypeId: "SPA122",
      macAddress: "AA-BB-CC-DD-EE-FF",
      emergencyNumber: "801-555-1002",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "dev_4",
      deviceName: "Break room",
      macAddress: "aabbccddeeff",
      lineNumber: 1,
      emergencyNumber: "18015551002",
      sipUsername: "dev_4",
    });
    const bad = await ctx.call("alianza_create_device_line", {
      accountId: "acc_1",
      userId: "usr_2",
      deviceName: "Odd phone",
      deviceTypeId: "NOPE9000",
    });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/not allowed on this partition/);
  });
});

describe("call activity", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_search_call_records returns trimmed records, newest first, with filters", async () => {
    const all = await ctx.call("alianza_search_call_records", { accountId: "acc_1", startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(all.isError).toBeFalsy();
    const sc = all.structuredContent as { calls: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(3);
    expect(sc.calls[0]).toMatchObject({ id: "cdr_3", callType: "OUTBOUND", to: "14155550100", durationSeconds: 720, cost: 0.12, toLocation: "San Francisco, CA" });
    expect(textOf(all)).toContain("Showing 1-3 of 3");

    const missed = await ctx.call("alianza_search_call_records", {
      accountId: "acc_1",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      result: "MISSED",
    });
    expect((missed.structuredContent as { calls: Array<{ id: string }> }).calls.map((c) => c.id)).toEqual(["cdr_2"]);

    const from = await ctx.call("alianza_search_call_records", {
      accountId: "acc_1",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      fromNumber: "(801) 555-9876",
    });
    expect((from.structuredContent as { total: number }).total).toBe(1);

    const paged = await ctx.call("alianza_search_call_records", { accountId: "acc_1", startDate: "2026-09-01", endDate: "2026-09-30", limit: 2 });
    expect(textOf(paged)).toContain("offset=2");

    const backwards = await ctx.call("alianza_search_call_records", { accountId: "acc_1", startDate: "2026-09-30", endDate: "2026-09-01" });
    expect(backwards.isError).toBe(true);
  });

  it("alianza_list_voicemails lists newest first with transcription and unread filter", async () => {
    const all = await ctx.call("alianza_list_voicemails", { accountId: "acc_1", userId: "usr_1" });
    expect(all.isError).toBeFalsy();
    expect(all.structuredContent).toMatchObject({ total: 2, unread: 1 });
    const msgs = (all.structuredContent as { messages: Array<{ id: string; transcription?: string }> }).messages;
    expect(msgs[0].id).toBe("vm_1");
    expect(msgs[0].transcription).toContain("Dr. Lee");
    expect(textOf(all)).toContain("UNREAD");

    const unread = await ctx.call("alianza_list_voicemails", { accountId: "acc_1", userId: "usr_1", unreadOnly: true });
    expect((unread.structuredContent as { total: number }).total).toBe(1);

    const none = await ctx.call("alianza_list_voicemails", { accountId: "acc_1", userId: "usr_2", unreadOnly: true });
    expect(textOf(none)).toMatch(/no unread voicemails/i);

    const missing = await ctx.call("alianza_list_voicemails", { accountId: "acc_1", userId: "usr_9" });
    expect(missing.isError).toBe(true);
  });
});
