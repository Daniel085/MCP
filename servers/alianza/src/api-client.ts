/**
 * Client for the Alianza Crux (Experience) API.
 *
 * Owns base URLs, bearer tokens (via AuthManager), timeouts, and the RFC 9457
 * problem-details error shape. Tools call typed methods and never see tokens.
 */
import type { AuthManager, TokenKind } from "./auth.js";
import { AuthError } from "./auth.js";
import type { Config } from "./config.js";

export type TargetType = "ACCOUNT" | "PHONE_NUMBER" | "USER";
export type ConnectionState = "ACTIVE" | "INACTIVE" | "CONNECTED";

export interface Assignability {
  experienceId: string;
  targetType: TargetType;
  targetValue: string;
  assignable: boolean;
}

export interface Assignment {
  id: string;
  experienceId: string;
  accountId: string;
  targetType: TargetType;
  targetValue: string;
  updatedAt: string;
}

export interface Connection {
  id: string;
  accountId: string;
  accountName?: string;
  experienceId: string;
  state: ConnectionState;
  updatedAt: string;
}

export interface UnifiedUser {
  id: string;
  accountId: string;
  firstName?: string;
  lastName?: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface Page<T> {
  entities: T[];
  cursor: string | null;
  pageSize: number;
  /** Users only: total across all pages. */
  count?: number;
}

export interface ProblemFieldError {
  field?: string;
  message?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: {
      title?: string;
      detail?: string;
      traceId?: string;
      errors?: ProblemFieldError[];
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  auth: AuthManager;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly auth: AuthManager;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.auth = opts.auth;
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromConfig(config: Config, auth: AuthManager, fetchImpl?: typeof fetch): ApiClient {
    return new ApiClient({ baseUrl: config.apiBaseUrl, auth, timeoutMs: config.apiTimeoutMs, fetchImpl });
  }

  // ---- Experience -----------------------------------------------------------

  checkAssignability(experienceId: string, targetType: TargetType, targetValue: string): Promise<Assignability> {
    return this.request<Assignability>("assignability", "GET", `/experience/experiences/${enc(experienceId)}/assignability`, {
      query: { targetType, targetValue },
    });
  }

  // ---- Assignments -----------------------------------------------------------

  listAssignments(q: {
    accountId?: string;
    experienceId?: string;
    targetType?: TargetType;
    targetValue?: string;
    cursor?: string;
    pageSize?: number;
  }): Promise<Page<Assignment>> {
    return this.request<Page<Assignment>>("user", "GET", "/experience/assignments", { query: q });
  }

  getAssignment(id: string): Promise<Assignment> {
    return this.request<Assignment>("user", "GET", `/experience/assignments/${enc(id)}`);
  }

  createAssignment(body: { experienceId: string; targetType: TargetType; targetValue: string }): Promise<Assignment> {
    return this.request<Assignment>("user", "POST", "/experience/assignments", { body });
  }

  deleteAssignment(id: string): Promise<void> {
    return this.request<void>("user", "DELETE", `/experience/assignments/${enc(id)}`);
  }

  // ---- Connections -----------------------------------------------------------

  listConnections(q: {
    accountId?: string;
    telephoneNumber?: string;
    experienceId?: string;
    cursor?: string;
    pageSize?: number;
  }): Promise<Page<Connection>> {
    return this.request<Page<Connection>>("user", "GET", "/experience/connections", { query: q });
  }

  getConnection(id: string): Promise<Connection> {
    return this.request<Connection>("user", "GET", `/experience/connections/${enc(id)}`);
  }

  createConnection(telephoneNumber: string, body: { experienceId: string; state: ConnectionState }): Promise<Connection> {
    return this.request<Connection>("user", "POST", "/experience/connections", { query: { telephoneNumber }, body });
  }

  updateConnection(id: string, body: Connection): Promise<Connection> {
    return this.request<Connection>("user", "PUT", `/experience/connections/${enc(id)}`, { body });
  }

  deleteConnection(id: string): Promise<void> {
    return this.request<void>("user", "DELETE", `/experience/connections/${enc(id)}`);
  }

  // ---- Users ------------------------------------------------------------------

  listUsers(q: {
    accountId?: string;
    cursor?: string;
    pageSize?: number;
    sortBy?: "createdAt" | "lastName" | "firstName";
    sortOrder?: "asc" | "desc";
  }): Promise<Page<UnifiedUser>> {
    return this.request<Page<UnifiedUser>>("user", "GET", "/users", { query: q });
  }

  getUser(id: string): Promise<UnifiedUser> {
    return this.request<UnifiedUser>("user", "GET", `/users/${enc(id)}`);
  }

  // ---- Transport ----------------------------------------------------------------

  private async request<T>(
    kind: TokenKind,
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
    retried = false,
  ): Promise<T> {
    const token = await this.auth.getToken(kind);
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
    if (opts.body !== undefined) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "unreachable";
      throw new ApiError(0, `Alianza API ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && !retried && (await this.auth.invalidate(kind))) {
      return this.request<T>(kind, method, path, opts, true);
    }
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function toApiError(res: Response): Promise<ApiError> {
  const retryAfter = Number(res.headers.get("retry-after"));
  let problem: { title?: string; detail?: string; traceId?: string; errors?: ProblemFieldError[] } = {};
  try {
    problem = (await res.json()) as typeof problem;
  } catch {
    // not JSON
  }
  const message = problem.detail || problem.title || `HTTP ${res.status}`;
  return new ApiError(res.status, message, {
    title: problem.title,
    detail: problem.detail,
    traceId: problem.traceId,
    errors: problem.errors,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  });
}

export { AuthError };
