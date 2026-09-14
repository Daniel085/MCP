import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectTestClient, textOf } from "./helpers.js";

describe("business lines", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_business_lines summarises call handling, port, and optional registration", async () => {
    const result = await ctx.call("alianza_list_business_lines", { accountId: "acc_3" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { businessLines: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(2);
    expect(sc.businessLines[0]).toMatchObject({
      id: "bl_1",
      name: "Counter",
      callerIdPhoneNumber: "18015553001",
      sipUsername: "sip_bl_1",
      callHandling: { mode: "RING_LINE", busy: "Voicemail", unregistered: "Forward to 18015559999", noAnswer: "Voicemail after 25s", voicemailBoxId: "blvm_1" },
      device: { deviceTypeId: "SPA122", macAddress: "c4e90a778899", portNumber: 1 },
    });
    expect(sc.businessLines[0]).not.toHaveProperty("registered");
    expect(sc.businessLines[1]).toMatchObject({ callHandling: { mode: "FORWARD", forwardTo: "18015558888", noAnswer: "Ring forever" } });
    expect(sc.businessLines[1]).not.toHaveProperty("device");
    expect(textOf(result)).toContain("(no port assigned)");

    const withReg = await ctx.call("alianza_list_business_lines", { accountId: "acc_3", includeRegistration: true });
    const lines = (withReg.structuredContent as { businessLines: Array<{ id: string; registered: boolean }> }).businessLines;
    expect(lines.map((l) => [l.id, l.registered])).toEqual([
      ["bl_1", true],
      ["bl_2", false],
    ]);
    expect(textOf(withReg)).toContain("NOT REGISTERED");

    const none = await ctx.call("alianza_list_business_lines", { accountId: "acc_1" });
    expect(textOf(none)).toMatch(/no business lines/i);
  });

  it("alianza_get_business_line returns detail with registration and 404s on unknown ids", async () => {
    const result = await ctx.call("alianza_get_business_line", { accountId: "acc_3", businessLineId: "bl_1" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "bl_1", registered: true, lockedOut: false, callerIdName: "LINDON BAKERY" });
    const missing = await ctx.call("alianza_get_business_line", { accountId: "acc_3", businessLineId: "bl_9" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/not found/i);
  });

  it("alianza_create_business_line creates a line and optionally assigns its port", async () => {
    const bare = await ctx.call("alianza_create_business_line", {
      accountId: "acc_3",
      name: "Office",
      callerIdPhoneNumber: "(801) 555-3001",
    });
    expect(bare.isError).toBeFalsy();
    expect(bare.structuredContent).toMatchObject({
      id: "bl_3",
      name: "Office",
      callerIdPhoneNumber: "18015553001",
      emergencyCallbackPhoneNumber: "18015553001",
      callHandling: { mode: "RING_LINE", noAnswer: "Voicemail after 20s" },
    });
    expect(textOf(bare)).toContain("no port assigned yet");

    const withPort = await ctx.call("alianza_create_business_line", {
      accountId: "acc_3",
      name: "Fax",
      callerIdPhoneNumber: "18015553001",
      deviceTypeId: "SPA122",
      macAddress: "C4:E9:0A:77:88:99",
      portNumber: 2,
      faxEnabled: true,
    });
    expect(withPort.isError).toBeFalsy();
    expect(withPort.structuredContent).toMatchObject({ id: "bl_4", device: { deviceTypeId: "SPA122", macAddress: "c4e90a778899", portNumber: 2, faxEnabled: true } });
    expect(textOf(withPort)).toContain("port 2");

    const badNumber = await ctx.call("alianza_create_business_line", { accountId: "acc_3", name: "Nope", callerIdPhoneNumber: "18015551001" });
    expect(badNumber.isError).toBe(true);
    expect(textOf(badNumber)).toMatch(/not on this account/);

    const halfPort = await ctx.call("alianza_create_business_line", { accountId: "acc_3", name: "Nope", callerIdPhoneNumber: "18015553001", macAddress: "c4e90a778899" });
    expect(halfPort.isError).toBe(true);
    expect(textOf(halfPort)).toMatch(/deviceTypeId is required/);
  });

  it("alianza_set_business_line_port creates, then replaces, and rejects port clashes", async () => {
    const assign = await ctx.call("alianza_set_business_line_port", {
      accountId: "acc_3",
      businessLineId: "bl_2",
      deviceTypeId: "SPA122",
      macAddress: "c4e90a778899",
      portNumber: 2,
    });
    expect(assign.isError).toBeFalsy();
    expect(textOf(assign)).toMatch(/^Assigned/);
    expect(ctx.fake.state.linePorts.bl_2).toMatchObject({ macAddress: "c4e90a778899", portNumber: 2 });

    const move = await ctx.call("alianza_set_business_line_port", {
      accountId: "acc_3",
      businessLineId: "bl_2",
      deviceTypeId: "HT812",
      macAddress: "00-0b-82-11-22-33",
      portNumber: 1,
    });
    expect(move.isError).toBeFalsy();
    expect(textOf(move)).toMatch(/^Moved/);
    expect(move.structuredContent).toMatchObject({ businessLineId: "bl_2", deviceTypeId: "HT812", macAddress: "000b82112233", portNumber: 1 });

    const clash = await ctx.call("alianza_set_business_line_port", {
      accountId: "acc_3",
      businessLineId: "bl_2",
      deviceTypeId: "SPA122",
      macAddress: "c4e90a778899",
      portNumber: 1,
    });
    expect(clash.isError).toBe(true);
    expect(textOf(clash)).toMatch(/already used by business line bl_1/);
  });

  it("alianza_set_business_line_call_handling merges partial changes over the current settings", async () => {
    const busy = await ctx.call("alianza_set_business_line_call_handling", {
      accountId: "acc_3",
      businessLineId: "bl_1",
      busyAction: "FORWARD",
      busyForwardTo: "801-555-1234",
      ringTimeoutSeconds: 40,
    });
    expect(busy.isError).toBeFalsy();
    expect(busy.structuredContent).toMatchObject({
      businessLineId: "bl_1",
      callHandling: { mode: "RING_LINE", busy: "Forward to 18015551234", unregistered: "Forward to 18015559999", noAnswer: "Voicemail after 40s", callWaiting: true, voicemailBoxId: "blvm_1" },
    });

    const forever = await ctx.call("alianza_set_business_line_call_handling", { accountId: "acc_3", businessLineId: "bl_1", ringTimeoutSeconds: 0 });
    expect((forever.structuredContent as { callHandling: { noAnswer: string } }).callHandling.noAnswer).toBe("Ring forever");

    const noAnswerOnly = await ctx.call("alianza_set_business_line_call_handling", { accountId: "acc_3", businessLineId: "bl_1", noAnswerAction: "BUSY" });
    expect((noAnswerOnly.structuredContent as { callHandling: { noAnswer: string } }).callHandling.noAnswer).toBe("Busy after 20s");

    const forward = await ctx.call("alianza_set_business_line_call_handling", { accountId: "acc_3", businessLineId: "bl_1", mode: "FORWARD", forwardTo: "18015550000", callWaiting: false });
    expect(forward.structuredContent).toMatchObject({ callHandling: { mode: "FORWARD", forwardTo: "18015550000", callWaiting: false } });

    const missingForward = await ctx.call("alianza_set_business_line_call_handling", { accountId: "acc_3", businessLineId: "bl_2", busyAction: "FORWARD" });
    expect(missingForward.isError).toBe(true);
    expect(textOf(missingForward)).toMatch(/forward-to number is required/);
  });
});

describe("hunt groups", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_hunt_groups shows strategy, members, and optional failover", async () => {
    const result = await ctx.call("alianza_list_hunt_groups", { accountId: "acc_3" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { huntGroups: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(1);
    expect(sc.huntGroups[0]).toMatchObject({
      id: "hg_1",
      name: "Bakery ring group",
      strategy: "SIMULTANEOUS",
      ringTimeoutSeconds: 30,
      members: [{ businessLineId: "bl_1", order: 0 }, { businessLineId: "bl_2", order: 1 }],
    });
    expect(sc.huntGroups[0]).not.toHaveProperty("failover");

    const withFailover = await ctx.call("alianza_list_hunt_groups", { accountId: "acc_3", includeFailover: true });
    expect((withFailover.structuredContent as { huntGroups: Array<{ failover: unknown }> }).huntGroups[0].failover).toEqual({
      busy: "Busy",
      noAnswer: "Voicemail box blvm_1",
      unregistered: "Forward to 18015559999",
    });
    expect(textOf(withFailover)).toContain("no-answer: Voicemail box blvm_1");

    const none = await ctx.call("alianza_list_hunt_groups", { accountId: "acc_1" });
    expect(textOf(none)).toMatch(/no hunt groups/i);
  });

  it("alianza_create_hunt_group builds each strategy's configuration", async () => {
    const seq = await ctx.call("alianza_create_hunt_group", {
      accountId: "acc_3",
      name: "Sequential",
      strategy: "SEQUENTIAL",
      members: [{ businessLineId: "bl_2", ringTimeoutSeconds: 10 }, { businessLineId: "bl_1" }],
      ringTimeoutSeconds: 15,
    });
    expect(seq.isError).toBeFalsy();
    expect(seq.structuredContent).toMatchObject({
      id: "hg_2",
      strategy: "SEQUENTIAL",
      members: [{ businessLineId: "bl_2", order: 0, ringTimeoutSeconds: 10 }, { businessLineId: "bl_1", order: 1, ringTimeoutSeconds: 15 }],
    });
    expect(ctx.fake.state.huntGroups[1].huntingConfiguration).toMatchObject({ "@type": "SequentialHuntingConfiguration" });

    const linear = await ctx.call("alianza_create_hunt_group", {
      accountId: "acc_3",
      name: "Linear",
      strategy: "LINEAR",
      members: [{ businessLineId: "bl_1" }],
    });
    expect(linear.structuredContent).toMatchObject({ strategy: "LINEAR", ringTimeoutSeconds: 20, members: [{ businessLineId: "bl_1", order: 0 }] });

    const badMember = await ctx.call("alianza_create_hunt_group", { accountId: "acc_3", name: "Bad", members: [{ businessLineId: "bl_9" }] });
    expect(badMember.isError).toBe(true);
    expect(textOf(badMember)).toMatch(/bl_9 is not on this account/);
  });

  it("alianza_update_hunt_group keeps unspecified fields and replaces members", async () => {
    const renamed = await ctx.call("alianza_update_hunt_group", { accountId: "acc_3", huntGroupId: "hg_1", name: "Front of house" });
    expect(renamed.isError).toBeFalsy();
    expect(renamed.structuredContent).toMatchObject({ name: "Front of house", strategy: "SIMULTANEOUS", ringTimeoutSeconds: 30, members: [{ businessLineId: "bl_1" }, { businessLineId: "bl_2" }] });

    const reshaped = await ctx.call("alianza_update_hunt_group", {
      accountId: "acc_3",
      huntGroupId: "hg_1",
      strategy: "LINEAR",
      members: [{ businessLineId: "bl_2" }],
      ringTimeoutSeconds: 12,
    });
    expect(reshaped.structuredContent).toMatchObject({ name: "Front of house", strategy: "LINEAR", ringTimeoutSeconds: 12, members: [{ businessLineId: "bl_2", order: 0 }] });

    const missing = await ctx.call("alianza_update_hunt_group", { accountId: "acc_3", huntGroupId: "hg_9", name: "x" });
    expect(missing.isError).toBe(true);
  });

  it("alianza_set_hunt_group_failover sets one reason at a time and validates inputs", async () => {
    const fwd = await ctx.call("alianza_set_hunt_group_failover", {
      accountId: "acc_3",
      huntGroupId: "hg_1",
      reason: "NO_ANSWER",
      action: "FORWARD",
      forwardTo: "801 555 4321",
    });
    expect(fwd.isError).toBeFalsy();
    expect(fwd.structuredContent).toEqual({ huntGroupId: "hg_1", reason: "NO_ANSWER", action: "Forward to 18015554321" });
    expect(ctx.fake.state.huntGroupFailover.hg_1.NO_ANSWER).toMatchObject({ "@type": "ForwardFailoverAction", forwardToPhoneNumber: "18015554321" });
    expect(ctx.fake.state.huntGroupFailover.hg_1.BUSY).toMatchObject({ "@type": "BusyFailoverAction" });

    const vm = await ctx.call("alianza_set_hunt_group_failover", { accountId: "acc_3", huntGroupId: "hg_1", reason: "BUSY", action: "VOICEMAIL", voicemailBoxId: "blvm_1" });
    expect(vm.structuredContent).toMatchObject({ action: "Voicemail box blvm_1" });

    const noBox = await ctx.call("alianza_set_hunt_group_failover", { accountId: "acc_3", huntGroupId: "hg_1", reason: "BUSY", action: "VOICEMAIL" });
    expect(noBox.isError).toBe(true);
    expect(textOf(noBox)).toMatch(/voicemailBoxId/);
  });
});

describe("sip trunks", () => {
  let ctx: Awaited<ReturnType<typeof connectTestClient>>;
  beforeEach(async () => {
    ctx = await connectTestClient();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("alianza_list_sip_trunks never exposes the password and reports registration on request", async () => {
    const result = await ctx.call("alianza_list_sip_trunks", { accountId: "acc_3" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { sipTrunks: Array<Record<string, unknown>>; total: number };
    expect(sc.total).toBe(1);
    expect(sc.sipTrunks[0]).toMatchObject({
      id: "trk_1",
      trunkName: "Bakery PBX",
      sipUsername: "lindon-bakery-pbx",
      concurrentCalls: 10,
      primaryTn: "18015553002",
      extensionPatterns: ["21XX"],
      callingPlans: [{ minutesRemaining: 10000 }],
    });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(sc.sipTrunks[0]).not.toHaveProperty("registered");

    const withReg = await ctx.call("alianza_list_sip_trunks", { accountId: "acc_3", includeRegistration: true });
    expect((withReg.structuredContent as { sipTrunks: Array<{ registered: boolean }> }).sipTrunks[0].registered).toBe(true);
    expect(textOf(withReg)).toContain("REGISTERED");

    const none = await ctx.call("alianza_list_sip_trunks", { accountId: "acc_2" });
    expect(textOf(none)).toMatch(/no sip trunks/i);
  });

  it("alianza_get_sip_trunk adds registration and forwarding rules", async () => {
    const result = await ctx.call("alianza_get_sip_trunk", { accountId: "acc_3", sipTrunkId: "trk_1" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "trk_1",
      registered: true,
      forwarding: { always: "disabled", onFailure: ["TELEPHONE 18015557777"], onCapacityExceeded: ["BUSY"] },
    });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    const missing = await ctx.call("alianza_get_sip_trunk", { accountId: "acc_3", sipTrunkId: "trk_9" });
    expect(missing.isError).toBe(true);
  });

  it("alianza_create_sip_trunk generates a password, returns it once, and validates upstream", async () => {
    const result = await ctx.call("alianza_create_sip_trunk", {
      accountId: "acc_3",
      trunkName: "Warehouse PBX",
      sipUsername: "lindon-warehouse",
      concurrentCalls: 4,
      primaryTn: "801-555-3002",
      extensionPatterns: ["30xx"],
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { id: string; sipPassword: string; extensionPatterns: string[]; sipProxyServer: string };
    expect(sc.id).toBe("trk_2");
    expect(sc.sipPassword).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(sc.extensionPatterns).toEqual(["30XX"]);
    expect(textOf(result)).toContain(sc.sipPassword);
    expect(textOf(result)).toContain("sip.alianza.example");
    expect(ctx.fake.state.sipTrunks[1].sipPassword).toBe(sc.sipPassword);

    const explicit = await ctx.call("alianza_create_sip_trunk", {
      accountId: "acc_3",
      trunkName: "Second PBX",
      sipUsername: "lindon-second-pbx",
      sipPassword: "hunter22",
      concurrentCalls: 2,
    });
    expect((explicit.structuredContent as { sipPassword: string }).sipPassword).toBe("hunter22");

    const dupUser = await ctx.call("alianza_create_sip_trunk", { accountId: "acc_3", trunkName: "Dup", sipUsername: "lindon-bakery-pbx", concurrentCalls: 1 });
    expect(dupUser.isError).toBe(true);
    expect(textOf(dupUser)).toMatch(/already in use/);

    const badTn = await ctx.call("alianza_create_sip_trunk", { accountId: "acc_3", trunkName: "Bad TN", sipUsername: "lindon-bad-tn", concurrentCalls: 1, callbackNumber: "18015551001" });
    expect(badTn.isError).toBe(true);
    expect(textOf(badTn)).toMatch(/not on this account/);

    const shortUser = await ctx.call("alianza_create_sip_trunk", { accountId: "acc_3", trunkName: "Short", sipUsername: "abc", concurrentCalls: 1 });
    expect(shortUser.isError).toBe(true);
  });
});
