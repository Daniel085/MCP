#!/usr/bin/env node
/**
 * In-memory stand-in for the Alianza Crux API plus its OAuth token endpoint.
 * Speaks the real API's dialect: bearer scopes, problem+json errors, cursor
 * paging, 409 on duplicate connection/assignment and on no-op state changes.
 *
 * Fixed credentials:
 *   client_id "test-client" / client_secret "test-secret"
 *   client_credentials  -> token "cc-token"   (scope experience-assignability:check)
 *   refresh_token "rt-good" -> "user-token-N" (all manage scopes); "rt-bad" -> 400
 *   authorization_code "good-code" with any code_verifier -> user token + refresh
 *   Bearer "expired-token" -> 401 (to exercise the refresh path)
 */
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import type { Assignment, Connection, UnifiedUser } from "./api-client.js";

const MANAGE_SCOPES = "experience-connections:manage experience-assignments:manage users:manage offline_access";

/** The partner's own experience (matches tests and evals) and another partner's. */
export const SEED = {
  E1: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
  E2: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
  ACME: "11111111-1111-4111-8111-111111111111",
  BETA: "22222222-2222-4222-8222-222222222222",
  GAMMA: "33333333-3333-4333-8333-333333333333",
  DELTA: "44444444-4444-4444-8444-444444444444",
  EPSILON: "55555555-5555-4555-8555-555555555555",
  ZETA: "66666666-6666-4666-8666-666666666666",
} as const;

const uid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (n: number, accountId: string, first: string, last: string, created: string, updated: string | null = null): UnifiedUser => ({
  id: uid(n),
  accountId,
  firstName: first,
  lastName: last,
  createdAt: created,
  updatedAt: updated,
});

/**
 * Six accounts. Acme and Beta start with no connections or assignments so
 * the write tests can create them; Gamma, Delta, Epsilon, and Zeta carry
 * pre-existing state that the read-only Q&A evaluation asks about.
 */
function seed(): { accounts: FakeAccount[]; users: UnifiedUser[]; connections: Connection[]; assignments: Assignment[] } {
  const { E1, E2, ACME, BETA, GAMMA, DELTA, EPSILON, ZETA } = SEED;
  const accounts: FakeAccount[] = [
    { id: ACME, name: "Acme Communications", numbers: ["+14155551234", "+14155551235"] },
    { id: BETA, name: "Beta Dental", numbers: ["+14155559999"] },
    { id: GAMMA, name: "Gamma Logistics", numbers: ["+14155553001", "+14155553002", "+14155553003"] },
    { id: DELTA, name: "Delta Clinics", numbers: ["+14155554001", "+14155554002"] },
    { id: EPSILON, name: "Epsilon Retail", numbers: ["+14155555001"] },
    { id: ZETA, name: "Zeta Studios", numbers: ["+14155556001"] },
  ];
  const users: UnifiedUser[] = [
    user(1, ACME, "Jane", "Doe", "2026-03-15T14:22:00Z", "2026-03-18T09:15:30Z"),
    user(2, ACME, "John", "Smith", "2026-03-16T08:00:00Z"),
    user(3, ACME, "Ann", "Adams", "2026-03-17T08:00:00Z"),
    user(4, BETA, "Bo", "Baker", "2026-04-01T08:00:00Z"),
    user(5, GAMMA, "Carla", "Reyes", "2026-02-01T09:00:00Z"),
    user(6, GAMMA, "Dev", "Patel", "2026-02-10T09:00:00Z"),
    user(7, GAMMA, "Erin", "Chen", "2026-02-20T09:00:00Z"),
    user(8, GAMMA, "Finn", "O'Neil", "2026-03-01T09:00:00Z"),
    user(9, GAMMA, "Grace", "Kim", "2026-03-10T09:00:00Z"),
    user(10, DELTA, "Hugo", "Lind", "2026-05-02T09:00:00Z"),
    user(11, DELTA, "Ivy", "Park", "2026-05-03T09:00:00Z"),
    user(12, EPSILON, "Jun", "Sato", "2026-06-01T09:00:00Z"),
    user(13, EPSILON, "Kai", "Novak", "2026-06-02T09:00:00Z"),
    user(14, EPSILON, "Lena", "Weiss", "2026-06-03T09:00:00Z"),
    user(15, EPSILON, "Mo", "Adeyemi", "2026-06-04T09:00:00Z"),
    user(16, ZETA, "Nia", "Brooks", "2026-07-01T09:00:00Z"),
  ];
  const at = "2026-08-01T12:00:00Z";
  const conn = (id: string, accountId: string, experienceId: string, state: Connection["state"]): Connection => ({
    id,
    accountId,
    accountName: accounts.find((a) => a.id === accountId)!.name,
    experienceId,
    state,
    updatedAt: at,
  });
  const connections: Connection[] = [
    conn("c3333333-0000-4000-8000-0000000000e1", GAMMA, E1, "ACTIVE"),
    conn("c4444444-0000-4000-8000-0000000000e1", DELTA, E1, "INACTIVE"),
    conn("c5555555-0000-4000-8000-0000000000e1", EPSILON, E1, "CONNECTED"),
    conn("c5555555-0000-4000-8000-0000000000e2", EPSILON, E2, "ACTIVE"),
  ];
  const asg = (id: string, accountId: string, experienceId: string, targetType: Assignment["targetType"], targetValue: string): Assignment => ({
    id,
    experienceId,
    accountId,
    targetType,
    targetValue,
    updatedAt: at,
  });
  const assignments: Assignment[] = [
    asg("a3333333-0000-4000-8000-000000000001", GAMMA, E1, "ACCOUNT", GAMMA),
    asg("a3333333-0000-4000-8000-000000000002", GAMMA, E1, "USER", uid(6)),
    asg("a4444444-0000-4000-8000-000000000001", DELTA, E1, "PHONE_NUMBER", "+14155554001"),
    asg("a4444444-0000-4000-8000-000000000002", DELTA, E1, "PHONE_NUMBER", "+14155554002"),
    asg("a5555555-0000-4000-8000-000000000001", EPSILON, E1, "PHONE_NUMBER", "+14155555001"),
    asg("a5555555-0000-4000-8000-000000000002", EPSILON, E2, "ACCOUNT", EPSILON),
  ];
  return { accounts, users, connections, assignments };
}

interface FakeAccount {
  id: string;
  name: string;
  numbers: string[];
}

export function createFakeApi() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const state = seed();
  const accounts = state.accounts;
  const users = state.users;
  const connections = state.connections;
  const assignments = state.assignments;
  let tokenCounter = 0;
  const issuedUserTokens = new Set<string>();

  // Restore the seed. Lets evaluation runs keep cases independent.
  app.post("/__reset", (_req, res) => {
    const fresh = seed();
    accounts.splice(0, accounts.length, ...fresh.accounts);
    users.splice(0, users.length, ...fresh.users);
    connections.splice(0, connections.length, ...fresh.connections);
    assignments.splice(0, assignments.length, ...fresh.assignments);
    res.status(204).end();
  });

  const problem = (res: Response, status: number, title: string, detail?: string, errors?: unknown[]) =>
    res.status(status).type("application/problem+json").json({ title, status, detail, traceId: randomUUID(), ...(errors ? { errors } : {}) });

  const now = () => new Date().toISOString();
  const accountForNumber = (tn: string) => accounts.find((a) => a.numbers.includes(tn));
  const accountForTarget = (type: string, value: string): FakeAccount | undefined => {
    if (type === "PHONE_NUMBER") return accountForNumber(value);
    if (type === "ACCOUNT") return accounts.find((a) => a.id === value);
    if (type === "USER") {
      const u = users.find((x) => x.id === value);
      return u ? accounts.find((a) => a.id === u.accountId) : undefined;
    }
    return undefined;
  };

  // ---- OAuth token endpoint ---------------------------------------------------
  app.post("/oauth/token", (req, res) => {
    const b = req.body as Record<string, string>;
    if (b.client_id !== "test-client") return res.status(401).json({ error: "invalid_client", error_description: "unknown client" });
    switch (b.grant_type) {
      case "client_credentials":
        if (b.client_secret !== "test-secret") return res.status(401).json({ error: "invalid_client", error_description: "bad secret" });
        return res.json({ access_token: "cc-token", token_type: "Bearer", expires_in: 3600, scope: "experience-assignability:check" });
      case "refresh_token": {
        if (b.refresh_token !== "rt-good") return res.status(400).json({ error: "invalid_grant", error_description: "refresh token is invalid or expired" });
        const token = `user-token-${++tokenCounter}`;
        issuedUserTokens.add(token);
        return res.json({ access_token: token, token_type: "Bearer", expires_in: 3600, refresh_token: "rt-good", scope: MANAGE_SCOPES });
      }
      case "authorization_code": {
        if (b.code !== "good-code" || !b.code_verifier || !b.redirect_uri) {
          return res.status(400).json({ error: "invalid_grant", error_description: "bad code or missing PKCE verifier" });
        }
        const token = `user-token-${++tokenCounter}`;
        issuedUserTokens.add(token);
        return res.json({ access_token: token, token_type: "Bearer", expires_in: 3600, refresh_token: "rt-good", scope: MANAGE_SCOPES });
      }
      default:
        return res.status(400).json({ error: "unsupported_grant_type" });
    }
  });

  // ---- Bearer + scope enforcement ----------------------------------------------
  const scopesFor = (token: string): string[] => {
    if (token === "cc-token") return ["experience-assignability:check"];
    if (token === "static-user-token" || issuedUserTokens.has(token)) return MANAGE_SCOPES.split(" ");
    if (token === "read-only-token") return ["experience-assignability:check"];
    return [];
  };
  const requireScope = (scope: string) => (req: Request, res: Response, next: () => void) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token === "expired-token") return problem(res, 401, "Unauthorized", "Access token is missing or has expired");
    const scopes = scopesFor(token);
    if (scopes.length === 0) return problem(res, 401, "Unauthorized", "Access token is missing or has expired");
    if (!scopes.includes(scope)) return problem(res, 403, "Forbidden", `Token does not hold the ${scope} scope`);
    next();
  };

  // ---- Experience ------------------------------------------------------------------
  app.get("/experience/experiences/:experienceId/assignability", requireScope("experience-assignability:check"), (req, res) => {
    const { targetType, targetValue } = req.query as Record<string, string>;
    if (!["ACCOUNT", "PHONE_NUMBER", "USER"].includes(targetType ?? "")) {
      return problem(res, 400, "Bad Request", "targetType must be one of PHONE_NUMBER, USER, ACCOUNT");
    }
    if (!targetValue) return problem(res, 400, "Bad Request", "targetValue is required");
    const assignable = Boolean(accountForTarget(targetType, targetValue));
    res.json({ experienceId: req.params.experienceId, targetType, targetValue, assignable });
  });

  // ---- Paging helper ---------------------------------------------------------------
  function page<T>(items: T[], q: Record<string, string>, max = 100) {
    const pageSize = Math.min(Math.max(Number(q.pageSize ?? 100), 1), max);
    const offset = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString()) : 0;
    const slice = items.slice(offset, offset + pageSize);
    const next = offset + pageSize < items.length ? Buffer.from(String(offset + pageSize)).toString("base64url") : null;
    return { entities: slice, cursor: next, pageSize };
  }

  // ---- Connections ---------------------------------------------------------------
  app.get("/experience/connections", requireScope("experience-connections:manage"), (req, res) => {
    const q = req.query as Record<string, string>;
    let accountId = q.accountId;
    if (!accountId) {
      const tn = q.telephoneNumber ?? q.tn;
      if (!tn) return problem(res, 400, "Bad Request", "Either accountId or telephoneNumber is required");
      const acc = accountForNumber(tn);
      if (!acc) return res.json({ entities: [], cursor: null, pageSize: 100 });
      accountId = acc.id;
    }
    let items = connections.filter((c) => c.accountId === accountId);
    if (q.experienceId) items = items.filter((c) => c.experienceId === q.experienceId);
    res.json(page(items, q));
  });

  app.post("/experience/connections", requireScope("experience-connections:manage"), (req, res) => {
    const tn = (req.query.telephoneNumber ?? req.query.tn) as string | undefined;
    if (!tn) return problem(res, 400, "Bad Request", "telephoneNumber is required");
    const acc = accountForNumber(tn);
    if (!acc) return problem(res, 404, "Not Found", `No account owns ${tn}`);
    const body = req.body as Partial<Connection>;
    if (!body.experienceId) return problem(res, 422, "Unprocessable Entity", "experienceId is required", [{ field: "experienceId", message: "required" }]);
    const state = body.state ?? "INACTIVE";
    if (!["ACTIVE", "INACTIVE", "CONNECTED"].includes(state)) return problem(res, 422, "Unprocessable Entity", "state must be ACTIVE or INACTIVE");
    if (connections.some((c) => c.accountId === acc.id && c.experienceId === body.experienceId)) {
      return problem(res, 409, "Conflict", `A connection already exists for account ${acc.id} and experience ${body.experienceId}`);
    }
    const c: Connection = { id: randomUUID(), accountId: acc.id, accountName: acc.name, experienceId: body.experienceId, state, updatedAt: now() };
    connections.push(c);
    res.status(201).json(c);
  });

  app.get("/experience/connections/:id", requireScope("experience-connections:manage"), (req, res) => {
    const c = connections.find((x) => x.id === req.params.id);
    if (!c) return problem(res, 404, "Resource Not Found", `Experience Connection ${req.params.id} does not exist`);
    res.json(c);
  });

  app.put("/experience/connections/:id", requireScope("experience-connections:manage"), (req, res) => {
    const c = connections.find((x) => x.id === req.params.id);
    if (!c) return problem(res, 404, "Resource Not Found", `Experience Connection ${req.params.id} does not exist`);
    const body = req.body as Partial<Connection>;
    if (!body.state || !["ACTIVE", "INACTIVE", "CONNECTED"].includes(body.state)) return problem(res, 400, "Bad Request", "state is required");
    if (body.state === c.state) return problem(res, 409, "Conflict", `Connection is already ${c.state}`);
    c.state = body.state;
    c.updatedAt = now();
    res.json(c);
  });

  app.delete("/experience/connections/:id", requireScope("experience-connections:manage"), (req, res) => {
    const i = connections.findIndex((x) => x.id === req.params.id);
    if (i < 0) return problem(res, 404, "Resource Not Found", `Experience Connection ${req.params.id} does not exist`);
    connections.splice(i, 1);
    res.status(204).end();
  });

  // ---- Assignments ---------------------------------------------------------------
  app.get("/experience/assignments", requireScope("experience-assignments:manage"), (req, res) => {
    const q = req.query as Record<string, string>;
    if (!q.accountId && !(q.targetType && q.targetValue)) return problem(res, 400, "Bad Request", "At least one filter is required");
    if (q.targetValue && !q.targetType) return problem(res, 400, "Bad Request", "targetType is required with targetValue");
    if (q.experienceId && !q.accountId) return problem(res, 400, "Bad Request", "accountId is required with experienceId");
    let items = assignments;
    if (q.accountId) items = items.filter((a) => a.accountId === q.accountId);
    if (q.experienceId) items = items.filter((a) => a.experienceId === q.experienceId);
    if (q.targetType) items = items.filter((a) => a.targetType === q.targetType);
    if (q.targetValue) items = items.filter((a) => a.targetValue === q.targetValue);
    res.json(page(items, q));
  });

  app.post("/experience/assignments", requireScope("experience-assignments:manage"), (req, res) => {
    const body = req.body as Partial<Assignment>;
    if (!body.experienceId || !body.targetType || !body.targetValue) {
      return problem(res, 422, "Unprocessable Entity", "experienceId, targetType, and targetValue are required");
    }
    const acc = accountForTarget(body.targetType, body.targetValue);
    if (!acc) return problem(res, 422, "Unprocessable Entity", `Target ${body.targetType} ${body.targetValue} was not found`);
    if (assignments.some((a) => a.experienceId === body.experienceId && a.targetType === body.targetType && a.targetValue === body.targetValue)) {
      return problem(res, 409, "Conflict", "Cannot create Experience Assignment in this state: it already exists");
    }
    const a: Assignment = { id: randomUUID(), experienceId: body.experienceId, accountId: acc.id, targetType: body.targetType, targetValue: body.targetValue, updatedAt: now() };
    assignments.push(a);
    res.status(201).json(a);
  });

  app.get("/experience/assignments/:id", requireScope("experience-assignments:manage"), (req, res) => {
    const a = assignments.find((x) => x.id === req.params.id);
    if (!a) return problem(res, 404, "Resource Not Found", `Experience Assignment ${req.params.id} does not exist`);
    res.json(a);
  });

  app.delete("/experience/assignments/:id", requireScope("experience-assignments:manage"), (req, res) => {
    const i = assignments.findIndex((x) => x.id === req.params.id);
    if (i < 0) return problem(res, 404, "Resource Not Found", `Experience Assignment ${req.params.id} does not exist`);
    assignments.splice(i, 1);
    res.status(204).end();
  });

  // ---- Users -------------------------------------------------------------------------
  app.get("/users", requireScope("users:manage"), (req, res) => {
    const q = req.query as Record<string, string>;
    const sortBy = (q.sortBy ?? "createdAt") as keyof UnifiedUser;
    if (!["createdAt", "lastName", "firstName"].includes(sortBy)) return problem(res, 400, "Bad Request", "sortBy is not an allowed value");
    const order = q.sortOrder ?? "asc";
    if (!["asc", "desc"].includes(order)) return problem(res, 400, "Bad Request", "sortOrder is not an allowed value");
    let items = q.accountId ? users.filter((u) => u.accountId === q.accountId) : [...users];
    items = [...items].sort((a, b) => String(a[sortBy] ?? "").localeCompare(String(b[sortBy] ?? "")) * (order === "asc" ? 1 : -1));
    res.json({ ...page(items, q, 200), count: items.length });
  });

  app.get("/users/:id", requireScope("users:manage"), (req, res) => {
    const u = users.find((x) => x.id === req.params.id);
    if (!u) return problem(res, 404, "Not Found", `User ${req.params.id} does not exist or is not visible`);
    res.json(u);
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.FAKE_API_PORT ?? 4010);
  createFakeApi().listen(port, "127.0.0.1", () => {
    process.stderr.write(`fake alianza crux api listening on http://127.0.0.1:${port} (auth: same host, POST /oauth/token)\n`);
  });
}
