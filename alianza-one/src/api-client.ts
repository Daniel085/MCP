/**
 * Thin client for the Alianza Public API v2. This is the only place that knows
 * about base URLs, the X-AUTH-TOKEN login flow, and timeouts. Tools call typed
 * methods on it and never see credentials.
 *
 * Auth: POST /v2/authorize with username/password returns { authToken,
 * partitionId, ... }. The token goes in the X-AUTH-TOKEN header of every later
 * call and stays valid for 8 hours from its last use. On a 401 the client logs
 * in again once and retries the request.
 */
import type { Config } from "./config.js";
import { log } from "./log.js";
import type {
  Account,
  AccountHistorySearchResponse,
  AccountSearchHit,
  AddressValidation,
  CdrSearchResponse,
  Device,
  DeviceRegistrationStatus,
  EndUser,
  InventoryNumber,
  LoginInfo,
  Partition,
  PhoneNumberDestination,
  PhoneNumberOnAccount,
  ServiceActivationEventResponse,
  TelephoneNumberActivation,
  TelephoneNumberReservation,
  VoicemailMessage,
} from "./alianza-types.js";

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

export interface ApiClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  /** Pre-issued token. When set, no login is performed and 401s are not retried. */
  authToken?: string;
  /** Default partition. Empty falls back to the login's partitionId. */
  partitionId?: string;
  timeoutMs: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly staticToken: string;
  private readonly configuredPartitionId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private token: string | null = null;
  private loginInfo: LoginInfo | null = null;
  private loginInFlight: Promise<LoginInfo> | null = null;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.username = opts.username ?? "";
    this.password = opts.password ?? "";
    this.staticToken = opts.authToken ?? "";
    this.configuredPartitionId = opts.partitionId ?? "";
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (this.staticToken) this.token = this.staticToken;
  }

  static fromConfig(config: Config, fetchImpl?: typeof fetch): ApiClient {
    return new ApiClient({
      baseUrl: config.apiBaseUrl,
      username: config.username,
      password: config.password,
      authToken: config.authToken,
      partitionId: config.partitionId,
      timeoutMs: config.apiTimeoutMs,
      fetchImpl,
    });
  }

  // ---- Auth ---------------------------------------------------------------

  /** Log in (or return the cached login). Never called when a static token is configured. */
  private async login(): Promise<LoginInfo> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      try {
        const info = await this.rawRequest<LoginInfo>("POST", "/v2/authorize", {
          body: { username: this.username, password: this.password },
          auth: false,
        });
        if (!info?.authToken) throw new ApiError(401, "Login succeeded but no authToken was returned");
        this.token = info.authToken;
        this.loginInfo = info;
        log.info("logged in to alianza", { username: info.username, partitionId: info.partitionId });
        return info;
      } finally {
        this.loginInFlight = null;
      }
    })();
    return this.loginInFlight;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    const info = await this.login();
    return info.authToken;
  }

  /**
   * Information about the authenticated user. With username/password this is
   * the login response; with a static token it is GET /v2/authorize/userinfo.
   */
  async getLoginInfo(): Promise<LoginInfo> {
    if (this.loginInfo) return this.loginInfo;
    if (this.staticToken) {
      this.loginInfo = await this.request<LoginInfo>("GET", "/v2/authorize/userinfo");
      return this.loginInfo;
    }
    return this.login();
  }

  /** Resolve the partition a tool call should act in. */
  async resolvePartitionId(override?: string): Promise<string> {
    if (override) return override;
    if (this.configuredPartitionId) return this.configuredPartitionId;
    const info = await this.getLoginInfo();
    if (!info.partitionId) {
      throw new ApiError(
        400,
        "No partition is configured and the login did not report one. Set ALIANZA_PARTITION_ID or pass partitionId.",
      );
    }
    return info.partitionId;
  }

  // ---- Partition ------------------------------------------------------------

  getPartition(partitionId: string): Promise<Partition> {
    return this.request<Partition>("GET", `/v2/partition/${enc(partitionId)}`);
  }

  // ---- Accounts -------------------------------------------------------------

  searchAccounts(partitionId: string, q: string): Promise<AccountSearchHit[]> {
    return this.request<AccountSearchHit[]>("GET", `/v2/partition/${enc(partitionId)}/account/search`, {
      query: { q },
    });
  }

  getAccount(
    partitionId: string,
    id: string,
    idType: "Id" | "AccountNumber" | "PhoneNumber" | "MacAddress" = "Id",
  ): Promise<Account> {
    return this.request<Account>("GET", `/v2/partition/${enc(partitionId)}/account/${enc(id)}`, {
      query: { accountIdType: idType },
    });
  }

  createAccount(partitionId: string, body: Partial<Account>): Promise<Account> {
    return this.request<Account>("POST", `/v2/partition/${enc(partitionId)}/account`, {
      body: { ...body, partitionId },
    });
  }

  searchAccountHistory(
    partitionId: string,
    accountId: string,
    query: Query,
  ): Promise<AccountHistorySearchResponse> {
    return this.request<AccountHistorySearchResponse>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/accounthistorysearch`,
      { query },
    );
  }

  searchCdrs(partitionId: string, accountId: string, query: Query): Promise<CdrSearchResponse> {
    return this.request<CdrSearchResponse>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/cdrsearch`,
      { query },
    );
  }

  // ---- End users ------------------------------------------------------------

  listUsers(partitionId: string, accountId: string): Promise<EndUser[]> {
    return this.request<EndUser[]>("GET", `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/user`);
  }

  getUser(partitionId: string, accountId: string, userId: string, idType: "ID" | "UserName" = "ID"): Promise<EndUser> {
    return this.request<EndUser>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/user/${enc(userId)}`,
      { query: { idType } },
    );
  }

  createUser(partitionId: string, accountId: string, body: Partial<EndUser>): Promise<EndUser> {
    return this.request<EndUser>("POST", `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/user`, {
      body: { ...body, partitionId, accountId },
    });
  }

  listUserVoicemail(partitionId: string, accountId: string, userId: string): Promise<VoicemailMessage[]> {
    return this.request<VoicemailMessage[]>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/user/${enc(userId)}/voicemail`,
    );
  }

  // ---- Telephone numbers ----------------------------------------------------

  listAccountNumbers(partitionId: string, accountId: string): Promise<PhoneNumberOnAccount[]> {
    return this.request<PhoneNumberOnAccount[]>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/telephonenumber`,
    );
  }

  getAccountNumber(partitionId: string, accountId: string, tn: string): Promise<PhoneNumberOnAccount> {
    return this.request<PhoneNumberOnAccount>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/telephonenumber/${enc(tn)}`,
    );
  }

  activateNumbers(
    partitionId: string,
    accountId: string,
    body: Partial<TelephoneNumberActivation>,
  ): Promise<TelephoneNumberActivation> {
    return this.request<TelephoneNumberActivation>(
      "POST",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/telephonenumber`,
      { body: { ...body, partitionId, accountId } },
    );
  }

  setNumberDestination(
    partitionId: string,
    accountId: string,
    tn: string,
    body: Partial<PhoneNumberDestination>,
  ): Promise<PhoneNumberDestination> {
    return this.request<PhoneNumberDestination>(
      "PUT",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/telephonenumber/${enc(tn)}/destination`,
      { body: { ...body, partitionId, accountId, telephoneNumber: tn } },
    );
  }

  getInventoryNumber(partitionId: string, tn: string): Promise<InventoryNumber> {
    return this.request<InventoryNumber>("GET", `/v2/partition/${enc(partitionId)}/telephonenumber/${enc(tn)}`);
  }

  searchInventory(partitionId: string, query: Query): Promise<InventoryNumber[]> {
    return this.request<InventoryNumber[]>("GET", `/v2/partition/${enc(partitionId)}/telephonenumber/search`, {
      query,
    });
  }

  searchActivationEvents(partitionId: string, query: Query): Promise<ServiceActivationEventResponse> {
    return this.request<ServiceActivationEventResponse>(
      "GET",
      `/v2/partition/${enc(partitionId)}/telephonenumber/statussearch`,
      { query },
    );
  }

  reserveNumber(partitionId: string, tn: string): Promise<TelephoneNumberReservation> {
    return this.request<TelephoneNumberReservation>(
      "PUT",
      `/v2/partition/${enc(partitionId)}/telephonenumber/${enc(tn)}/reserve`,
    );
  }

  releaseNumber(partitionId: string, tn: string): Promise<void> {
    return this.request<void>("DELETE", `/v2/partition/${enc(partitionId)}/telephonenumber/${enc(tn)}/reserve`);
  }

  // ---- Devices --------------------------------------------------------------

  listDeviceLines(partitionId: string, accountId: string, query: Query = {}): Promise<Device[]> {
    return this.request<Device[]>("GET", `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/deviceline`, {
      query,
    });
  }

  createDeviceLine(partitionId: string, accountId: string, body: Partial<Device>): Promise<Device> {
    return this.request<Device>("POST", `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/deviceline`, {
      body: { ...body, partitionId, accountId },
    });
  }

  getDeviceRegistration(partitionId: string, accountId: string, deviceId: string): Promise<DeviceRegistrationStatus> {
    return this.request<DeviceRegistrationStatus>(
      "GET",
      `/v2/partition/${enc(partitionId)}/account/${enc(accountId)}/deviceline/${enc(deviceId)}/registrationstatus`,
    );
  }

  // ---- Address --------------------------------------------------------------

  validateAddress(query: Query): Promise<AddressValidation> {
    return this.request<AddressValidation>("GET", "/v2/address/validate", { query });
  }

  // ---- Transport ------------------------------------------------------------

  /** Authenticated request with one re-login on 401 (credential mode only). */
  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const token = await this.ensureToken();
    try {
      return await this.rawRequest<T>(method, path, { ...opts, token });
    } catch (err) {
      const canRetry = err instanceof ApiError && err.status === 401 && !this.staticToken && this.token === token;
      if (!canRetry) throw err;
      log.info("alianza token rejected; logging in again");
      this.token = null;
      this.loginInfo = null;
      const fresh = await this.ensureToken();
      return this.rawRequest<T>(method, path, { ...opts, token: fresh });
    }
  }

  private async rawRequest<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; token?: string; auth?: boolean } = {},
  ): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (opts.token) headers.set("X-AUTH-TOKEN", opts.token);
    if (opts.body !== undefined) headers.set("Content-Type", "application/json");

    const qs = buildQuery(opts.query);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

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

    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ApiError(
        res.status,
        await extractErrorMessage(res),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(502, `Alianza returned a non-JSON response for ${method} ${path}`);
    }
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function buildQuery(query?: Query): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    } else {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

/**
 * Alianza error bodies come in two shapes:
 *   PublicApiException  { status, messages: string[], data }
 *   ApiSingleException  { code, message }
 * plus the occasional HTML page from a gateway.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as {
      messages?: unknown;
      message?: unknown;
      error?: { message?: string } | string;
    };
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      return data.messages.map(String).join("; ");
    }
    if (typeof data.message === "string" && data.message) return data.message;
    if (typeof data.error === "string") return data.error;
    if (data.error && typeof data.error === "object" && data.error.message) return data.error.message;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}
