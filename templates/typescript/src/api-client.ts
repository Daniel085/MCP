/**
 * Thin client for the upstream API. This is the only place that knows about
 * base URLs, auth headers, and timeouts. Tools call typed methods on it and
 * never see credentials.
 *
 * Replace the Items methods with calls to the real API you are wrapping.
 */
import type { Config } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Item {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface ItemPage {
  items: Item[];
  total: number;
  offset: number;
  limit: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromConfig(config: Config, fetchImpl?: typeof fetch): ApiClient {
    return new ApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.apiTimeoutMs,
      fetchImpl,
    });
  }

  // ---- Endpoint methods. Replace these for your API. ----------------------

  listItems(params: { query?: string; limit: number; offset: number }): Promise<ItemPage> {
    const search = new URLSearchParams();
    if (params.query) search.set("q", params.query);
    search.set("limit", String(params.limit));
    search.set("offset", String(params.offset));
    return this.request<ItemPage>("GET", `/items?${search.toString()}`);
  }

  getItem(id: string): Promise<Item> {
    return this.request<Item>("GET", `/items/${encodeURIComponent(id)}`);
  }

  createItem(input: { name: string; description?: string }): Promise<Item> {
    return this.request<Item>("POST", "/items", input);
  }

  // ---- Transport ----------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "unreachable";
      throw new ApiError(0, `Upstream API ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ApiError(
        res.status,
        await extractErrorMessage(res),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
    if (data.message) return data.message;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}
