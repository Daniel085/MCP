/**
 * Derives every expected answer in evals/alianza-qa.xml through the tool
 * surface, so the evaluation key is proven reachable with read-only tools
 * before a model is ever asked. Each block mirrors the call chain a model
 * would make.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/fake-api.js";
import { connectTestClient, EXPERIENCE_ID } from "./helpers.js";

const xml = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../evals/alianza-qa.xml"), "utf8");
const pairs = [...xml.matchAll(/<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>/g)].map((m) => ({
  question: m[1].trim(),
  answer: m[2].trim(),
}));

type Ctx = Awaited<ReturnType<typeof connectTestClient>>;
type Conn = { id: string; accountId: string; accountName?: string; experienceId: string; state: string };
type Asg = { id: string; accountId: string; experienceId: string; targetType: string; targetValue: string };
type User = { id: string; accountId: string; firstName?: string; lastName?: string; createdAt: string };

async function allUsers(t: Ctx, accountId?: string, sort?: { by: string; order: string }): Promise<User[]> {
  const out: User[] = [];
  let cursor: string | undefined;
  do {
    const r = await t.call("alianza_list_users", { account_id: accountId, page_size: 200, cursor, sort_by: sort?.by, sort_order: sort?.order });
    expect(r.isError, r.text).toBe(false);
    out.push(...(r.data!.entities as User[]));
    cursor = r.data!.cursor ?? undefined;
  } while (cursor);
  return out;
}
async function connectionsOf(t: Ctx, accountId: string): Promise<Conn[]> {
  const r = await t.call("alianza_list_connections", { account_id: accountId, page_size: 100 });
  expect(r.isError, r.text).toBe(false);
  return r.data!.entities as Conn[];
}
async function assignmentsOf(t: Ctx, accountId: string, extra: Record<string, unknown> = {}): Promise<Asg[]> {
  const r = await t.call("alianza_list_assignments", { account_id: accountId, page_size: 100, ...extra });
  expect(r.isError, r.text).toBe(false);
  return r.data!.entities as Asg[];
}
async function accountIdByNumber(t: Ctx, tn: string): Promise<{ id: string; name?: string; connections: Conn[] }> {
  const r = await t.call("alianza_list_connections", { telephone_number: tn, page_size: 100 });
  expect(r.isError, r.text).toBe(false);
  const conns = r.data!.entities as Conn[];
  if (conns.length) return { id: conns[0].accountId, name: conns[0].accountName, connections: conns };
  // No connection: fall back to the users list to find the account the number resolves to.
  const check = await t.call("alianza_check_assignability", { target_type: "PHONE_NUMBER", target_value: tn });
  expect(check.data?.assignable).toBe(true);
  throw new Error(`${tn} has no connection; question must not rely on it`);
}
async function distinctAccounts(t: Ctx): Promise<string[]> {
  return [...new Set((await allUsers(t)).map((u) => u.accountId))];
}

describe("Q&A evaluation key is derivable with read-only tools", () => {
  let t: Ctx;
  beforeAll(async () => {
    t = await connectTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("has ten independent questions", () => {
    expect(pairs).toHaveLength(10);
    expect(new Set(pairs.map((p) => p.question)).size).toBe(10);
  });

  it("q1: most users among accounts with an ACTIVE connection for our experience", async () => {
    let best: { name: string; users: number } | null = null;
    for (const id of await distinctAccounts(t)) {
      const active = (await connectionsOf(t, id)).find((c) => c.experienceId === EXPERIENCE_ID && c.state === "ACTIVE");
      if (!active) continue;
      const n = (await allUsers(t, id)).length;
      if (!best || n > best.users) best = { name: active.accountName!, users: n };
    }
    expect(best?.name).toBe(pairs[0].answer);
  });

  it("q2: users on the account owning +14155554002", async () => {
    const acc = await accountIdByNumber(t, "+14155554002");
    expect(String((await allUsers(t, acc.id)).length)).toBe(pairs[1].answer);
  });

  it("q3: most recently created user on the account owning +14155553001", async () => {
    const acc = await accountIdByNumber(t, "+14155553001");
    const users = await allUsers(t, acc.id, { by: "createdAt", order: "desc" });
    expect(users[0].lastName).toBe(pairs[2].answer);
  });

  it("q4: phone numbers on Delta Clinics with an assignment for our experience", async () => {
    // The API has no account search, so find Delta by the accountName on its connections.
    let id: string | undefined;
    for (const a of await distinctAccounts(t)) {
      if ((await connectionsOf(t, a)).some((c) => c.accountName === "Delta Clinics")) id = a;
    }
    expect(id).toBe(SEED.DELTA);
    const phones = (await assignmentsOf(t, id!, { experience_id: EXPERIENCE_ID, target_type: "PHONE_NUMBER" })).length;
    expect(String(phones)).toBe(pairs[3].answer);
  });

  it("q5: effective state of our connection for the account owning +14155555001", async () => {
    const acc = await accountIdByNumber(t, "+14155555001");
    const c = acc.connections.find((x) => x.experienceId === EXPERIENCE_ID)!;
    const effective = c.state === "ACTIVE" ? "ACTIVE" : "INACTIVE";
    expect(c.state).toBe("CONNECTED");
    expect(effective).toBe(pairs[4].answer);
  });

  it("q6: user with a USER-scoped assignment on Gamma Logistics", async () => {
    const asgs = await assignmentsOf(t, SEED.GAMMA, { experience_id: EXPERIENCE_ID, target_type: "USER" });
    expect(asgs).toHaveLength(1);
    const u = await t.call("alianza_get_user", { user_id: asgs[0].targetValue });
    expect(`${u.data?.firstName} ${u.data?.lastName}`).toBe(pairs[5].answer);
  });

  it("q7: accounts with no connection for any experience", async () => {
    let none = 0;
    for (const id of await distinctAccounts(t)) if ((await connectionsOf(t, id)).length === 0) none++;
    expect(String(none)).toBe(pairs[6].answer);
  });

  it("q8: account with connections for two experiences", async () => {
    const names: string[] = [];
    for (const id of await distinctAccounts(t)) {
      const conns = await connectionsOf(t, id);
      if (new Set(conns.map((c) => c.experienceId)).size === 2) names.push(conns[0].accountName!);
    }
    expect(names).toEqual([pairs[7].answer]);
  });

  it("q9: PHONE_NUMBER assignments for our experience across all accounts", async () => {
    let n = 0;
    for (const id of await distinctAccounts(t)) {
      n += (await assignmentsOf(t, id, { experience_id: EXPERIENCE_ID, target_type: "PHONE_NUMBER" })).length;
    }
    expect(String(n)).toBe(pairs[8].answer);
  });

  it("q10: first name of the alphabetically last surname on the account owning +14155553002", async () => {
    const acc = await accountIdByNumber(t, "+14155553002");
    const users = await allUsers(t, acc.id, { by: "lastName", order: "desc" });
    expect(users[0].firstName).toBe(pairs[9].answer);
  });

  it("the fake API resets to the seed", async () => {
    const created = await t.call("alianza_create_connection", { telephone_number: "+14155556001" });
    expect(created.data?.created).toBe(true);
    const res = await fetch(`${t.baseUrl}/__reset`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(await connectionsOf(t, SEED.ZETA)).toHaveLength(0);
    expect(await connectionsOf(t, SEED.GAMMA)).toHaveLength(1);
  });
});
