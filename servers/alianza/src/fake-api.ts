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

interface FakeAccount {
  id: string;
  name: string;
  numbers: string[];
}

export function createFakeApi() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const accounts: FakeAccount[] = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Acme Communications", numbers: ["+14155551234", "+14155551235"] },
    { id: "22222222-2222-4222-8222-222222222222", name: "Beta Dental", numbers: ["+14155559999"] },
  ];
  const users: UnifiedUser[] = [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", accountId: accounts[0].id, firstName: "Jane", lastName: "Doe", createdAt: "2026-03-15T14:22:00Z", updatedAt: "2026-03-18T09:15:30Z" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", accountId: accounts[0].id, firstName: "John", lastName: "Smith", createdAt: "2026-03-16T08:00:00Z", updatedAt: null },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", accountId: accounts[0].id, firstName: "Ann", lastName: "Adams", createdAt: "2026-03-17T08:00:00Z", updatedAt: null },
    { id: "aaaaaaaa-0000-4000-8000-000000000004", accountId: accounts[1].id, firstName: "Bo", lastName: "Baker", createdAt: "2026-04-01T08:00:00Z", updatedAt: null },
  ];
  const connections: Connection[] = [];
  const assignments: Assignment[] = [];
  let tokenCounter = 0;
  const issuedUserTokens = new Set<string>();

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
