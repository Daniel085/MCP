#!/usr/bin/env node
/**
 * In-memory stand-in for the Alianza Public API v2, covering exactly the
 * endpoints this server calls. Used by the tests and the smoke test, and for
 * trying the server locally without real credentials.
 *
 * Login: POST /v2/authorize with { username: "api@example.com", password:
 * "correct-horse" } (see fake-data.ts). Every other route needs the returned
 * authToken in X-AUTH-TOKEN. Error bodies use Alianza's PublicApiException
 * shape: { status, messages: [..] }.
 *
 * Test hooks: createFakeApi() returns the app plus `state` (mutable seed data)
 * and `expireTokens()` to simulate an 8-hour token timeout.
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type {
  Account,
  BusinessLine,
  BusinessLineCallHandling,
  BusinessLinePortAssignment,
  CustomerServiceRecord,
  Device,
  EndUser,
  HuntGroup,
  HuntGroupFailoverAction,
  HuntGroupFailoverReason,
  PhoneNumberOnAccount,
  SipTrunk,
  TelephoneNumberActivation,
} from "./alianza-types.js";
import { FAKE_PARTITION_ID, FAKE_PASSWORD, FAKE_USERNAME, seed, type FakeState } from "./fake-data.js";

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ status, messages: [message] });
}

export function createFakeApi() {
  const app = express();
  app.use(express.json());
  const state: FakeState = seed();
  const tokens = new Set<string>();
  let loginCount = 0;

  app.post("/v2/authorize", (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (username !== FAKE_USERNAME || password !== FAKE_PASSWORD) {
      fail(res, 401, "Invalid username or password");
      return;
    }
    loginCount += 1;
    const authToken = `tok_${loginCount}_${randomUUID().slice(0, 8)}`;
    tokens.add(authToken);
    res.json({
      authToken,
      userId: "mgr_1",
      userType: "ManagementUser",
      username,
      firstName: "API",
      lastName: "User",
      partitionId: FAKE_PARTITION_ID,
      partitionName: "Acme Telecom",
      subPartitionIds: ["prt_1_sub"],
      permissions: { Account: "DELETE", EndUser: "EDIT", TelephoneNumber: "EDIT" },
      maxLifeInHours: 8,
    });
  });

  app.use((req, res, next) => {
    const token = req.header("x-auth-token");
    if (!token || !tokens.has(token)) {
      fail(res, 401, "Unauthorized");
      return;
    }
    next();
  });

  app.get("/v2/authorize/userinfo", (_req, res) => {
    res.json({
      userId: "mgr_1",
      userType: "ManagementUser",
      username: FAKE_USERNAME,
      partitionId: FAKE_PARTITION_ID,
      partitionName: "Acme Telecom",
      subPartitionIds: ["prt_1_sub"],
      permissions: { Account: "DELETE", EndUser: "EDIT", TelephoneNumber: "EDIT" },
    });
  });

  // Partition-scoped routes share a guard.
  const partition = (req: Request, res: Response) => {
    const p = state.partitions.find((x) => x.id === req.params.partitionId);
    if (!p) fail(res, 404, `Partition ${req.params.partitionId} not found`);
    return p;
  };
  const account = (req: Request, res: Response) => {
    if (!partition(req, res)) return undefined;
    const a = state.accounts.find((x) => x.id === req.params.accountId && x.partitionId === req.params.partitionId);
    if (!a) fail(res, 404, `Account ${req.params.accountId} not found`);
    return a;
  };

  app.get("/v2/partition/:partitionId", (req, res) => {
    const p = partition(req, res);
    if (p) res.json(p);
  });

  app.get("/v2/partition/:partitionId/account/search", (req, res) => {
    if (!partition(req, res)) return;
    const q = String(req.query.q ?? "").toLowerCase();
    const hits = state.accounts
      .filter((a) => a.partitionId === req.params.partitionId)
      .map((a) => {
        const matches: Record<string, string> = {};
        if (a.accountNumber.toLowerCase().includes(q)) matches.accountNumber = a.accountNumber;
        if (a.accountName.toLowerCase().includes(q)) matches.accountName = a.accountName;
        for (const u of state.users.filter((u) => u.accountId === a.id)) {
          if (u.emailAddress?.toLowerCase().includes(q)) matches.emailAddress = u.emailAddress;
        }
        for (const n of state.numbers.filter((n) => n.accountId === a.id)) {
          if (n.phoneNumber.includes(q)) matches.phoneNumber = n.phoneNumber;
        }
        for (const d of state.devices.filter((d) => d.accountId === a.id)) {
          if (d.macAddress?.includes(q)) matches.macAddress = d.macAddress;
        }
        return { a, matches };
      })
      .filter(({ matches }) => Object.keys(matches).length > 0)
      .map(({ a, matches }) => ({
        partitionId: a.partitionId,
        id: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
        type: a.accountType,
        accountStatus: a.status,
        platformType: a.platformType,
        matches,
      }));
    res.json(hits);
  });

  app.get("/v2/partition/:partitionId/account/:accountId", (req, res) => {
    if (!partition(req, res)) return;
    const idType = String(req.query.accountIdType ?? "Id");
    const id = req.params.accountId;
    let a;
    switch (idType) {
      case "Id":
        a = state.accounts.find((x) => x.id === id);
        break;
      case "AccountNumber":
        a = state.accounts.find((x) => x.accountNumber === id);
        break;
      case "PhoneNumber": {
        const n = state.numbers.find((x) => x.phoneNumber === id);
        a = n && state.accounts.find((x) => x.id === n.accountId);
        break;
      }
      case "MacAddress": {
        const d = state.devices.find((x) => x.macAddress === id.toLowerCase());
        a = d && state.accounts.find((x) => x.id === d.accountId);
        break;
      }
      default:
        res.status(400).json({ code: 400, message: `Invalid accountIdType ${idType}` });
        return;
    }
    if (!a) {
      fail(res, 404, `Account ${id} not found`);
      return;
    }
    res.json(a);
  });

  app.post("/v2/partition/:partitionId/account", (req, res) => {
    if (!partition(req, res)) return;
    const body = req.body as Record<string, unknown>;
    for (const f of ["accountNumber", "accountName", "accountType", "timeZone"]) {
      if (!body[f]) {
        fail(res, 400, `${f} is required`);
        return;
      }
    }
    if (state.accounts.some((a) => a.accountNumber === body.accountNumber)) {
      fail(res, 400, `Account number ${String(body.accountNumber)} already exists`);
      return;
    }
    const created: Account = {
      ...(body as Partial<Account>),
      id: `acc_${state.accounts.length + 1}`,
      partitionId: req.params.partitionId,
      accountNumber: String(body.accountNumber),
      accountName: String(body.accountName),
      status: "ACTIVE",
      routePlanId: "2ea93a62-2c44-4ab6-8fcb-a7b3c0b735e6",
      sendWelcomeEmail: true,
      endUserCount: 0,
      callingPlans: [],
    };
    state.accounts.push(created);
    state.history[created.id] = [
      { id: `h_${randomUUID().slice(0, 6)}`, accountId: created.id, accountNumber: created.accountNumber, loggedDate: new Date().toISOString(), action: "CREATE", accountHistoryType: "ACCOUNT", referenceType: "Account", referenceId: created.id, referenceName: created.accountName, userName: FAKE_USERNAME, userType: "ManagementUser" },
    ];
    state.cdrs[created.id] = [];
    res.json(created);
  });

  app.get("/v2/partition/:partitionId/account/:accountId/accounthistorysearch", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const types = ([] as string[]).concat((req.query.accountHistoryType as string[] | string | undefined) ?? []);
    const start = req.query.startDate ? String(req.query.startDate) : undefined;
    const end = req.query.endDate ? `${String(req.query.endDate)}T23:59:59Z` : undefined;
    const all = (state.history[a.id] ?? []).filter(
      (h) =>
        (types.length === 0 || types.includes(h.accountHistoryType ?? "")) &&
        (!start || (h.loggedDate ?? "") >= start) &&
        (!end || (h.loggedDate ?? "") <= end),
    );
    const first = Number(req.query.firstResultIndex ?? 0);
    const max = Number(req.query.maxResult ?? 20);
    res.json({
      totalRecords: all.length,
      accountCreatedDate: "2026-02-14T12:00:00Z",
      accountLastUpdatedDate: all[0]?.loggedDate,
      results: all.slice(first, first + max),
    });
  });

  app.get("/v2/partition/:partitionId/account/:accountId/cdrsearch", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const { startDate, endDate } = req.query as Record<string, string | undefined>;
    if (!startDate || !endDate) {
      fail(res, 400, "startDate and endDate are required");
      return;
    }
    const callTypes = ([] as string[]).concat((req.query.callType as string[] | string | undefined) ?? []);
    const flags = ([] as string[]).concat((req.query.callFlagType as string[] | string | undefined) ?? []);
    const orig = req.query.origNumber as string | undefined;
    const dialed = req.query.dialedNumber as string | undefined;
    const term = req.query.termNumber as string | undefined;
    let all = (state.cdrs[a.id] ?? []).filter(
      (c) =>
        (c.startTime ?? "") >= startDate &&
        (c.startTime ?? "") <= `${endDate}T23:59:59Z` &&
        (callTypes.length === 0 || callTypes.includes(c.callType ?? "")) &&
        (flags.length === 0 || flags.includes(c.callFlagType ?? "")) &&
        (!orig || c.origNumber === orig) &&
        (!dialed || c.dialedNumber === dialed) &&
        (!term || c.termNumber === term),
    );
    const sort = String(req.query.sort ?? "DATE");
    const key = (c: (typeof all)[number]) =>
      sort === "COST" ? (c.cost ?? 0) : sort === "CALL_LENGTH" ? (c.actualCallLengthSeconds ?? 0) : (c.startTime ?? "");
    all = all.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
    if (String(req.query.sortOrder ?? "DESC") === "DESC") all = all.reverse();
    const first = Number(req.query.firstResultIndex ?? 0);
    const max = Number(req.query.maxResult ?? 20);
    res.json({ totalRecords: all.length, results: all.slice(first, first + max) });
  });

  // ---- End users -----------------------------------------------------------

  app.get("/v2/partition/:partitionId/account/:accountId/user", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    res.json(state.users.filter((u) => u.accountId === a.id).map(withDevices));
  });

  function withDevices(u: EndUser): EndUser {
    return { ...u, devices: state.devices.filter((d) => d.userId === u.id) };
  }

  app.post("/v2/partition/:partitionId/account/:accountId/user", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as Partial<EndUser>;
    if (!body.firstName || !body.lastName || !body.timeZone) {
      fail(res, 400, "firstName, lastName and timeZone are required");
      return;
    }
    if (body.username && state.users.some((u) => u.username === body.username)) {
      fail(res, 400, `Username ${body.username} is already in use`);
      return;
    }
    if (a.accountType === "ADVANCED" && body.extension && body.extension.length !== a.extensionLength) {
      fail(res, 400, `Extension must be ${a.extensionLength} digits`);
      return;
    }
    const created: EndUser = {
      id: `usr_${state.users.length + 1}`,
      partitionId: a.partitionId,
      accountId: a.id,
      mustChangePassword: true,
      pinLockedOut: false,
      voicemailBoxId: `vmb_${state.users.length + 1}`,
      callerIdConfig: { externalCallerIdVisible: false, extensionCallerIdVisible: true },
      callHandlingSettings: {
        callWaitingEnabled: true,
        doNotDisturbEnabled: false,
        callHandlingOptionType: "RingPhone",
        ringPhoneCallHandling: {
          busyCallHandling: { type: "Voicemail" },
          noAnswerCallHandling: { type: "Voicemail", timeout: 20 },
          unregisteredCallHandling: { type: "Voicemail" },
        },
      },
      callingPlans: [],
      devices: [],
      ...body,
      welcomeEmailSent: body.allowPortalAccess && !body.blockEmail ? new Date().toISOString() : undefined,
    };
    state.users.push(created);
    state.voicemail[created.id] = [];
    a.endUserCount = (a.endUserCount ?? 0) + 1;
    res.json(created);
  });

  app.get("/v2/partition/:partitionId/account/:accountId/user/:userId", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const byName = String(req.query.idType ?? "ID") === "UserName";
    const u = state.users.find(
      (x) => x.accountId === a.id && (byName ? x.username === req.params.userId : x.id === req.params.userId),
    );
    if (!u) {
      fail(res, 404, `End user ${req.params.userId} not found`);
      return;
    }
    res.json(withDevices(u));
  });

  app.get("/v2/partition/:partitionId/account/:accountId/user/:userId/voicemail", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const u = state.users.find((x) => x.accountId === a.id && x.id === req.params.userId);
    if (!u) {
      fail(res, 404, `End user ${req.params.userId} not found`);
      return;
    }
    res.json(state.voicemail[u.id] ?? []);
  });

  // ---- Telephone numbers on accounts ----------------------------------------

  app.get("/v2/partition/:partitionId/account/:accountId/telephonenumber", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    res.json(state.numbers.filter((n) => n.accountId === a.id));
  });

  app.post("/v2/partition/:partitionId/account/:accountId/telephonenumber", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as TelephoneNumberActivation;
    const csr = body.customerServiceRecord as CustomerServiceRecord | undefined;
    if (!csr?.streetNumber || !csr.streetName || !csr.city || !csr.state || !csr.postalCode) {
      fail(res, 400, "customerServiceRecord address is incomplete");
      return;
    }
    if (!body.telephoneNumbers?.length) {
      fail(res, 400, "telephoneNumbers is required");
      return;
    }
    const out: TelephoneNumberActivation["telephoneNumbers"] = [];
    for (const t of body.telephoneNumbers) {
      const inv = state.inventory.find((n) => n.phoneNumber === t.phoneNumber);
      if (!inv || !inv.isInInventory) {
        fail(res, 400, `Telephone number ${t.phoneNumber} is not available in inventory`);
        return;
      }
      const reservedBy = state.reservations[t.phoneNumber];
      if (reservedBy && reservedBy !== a.id) {
        fail(res, 400, `Telephone number ${t.phoneNumber} is reserved by another account`);
        return;
      }
      if (t.referenceType === "END_USER" && !state.users.some((u) => u.id === t.referenceId && u.accountId === a.id)) {
        fail(res, 400, `End user ${t.referenceId} is not on this account`);
        return;
      }
      inv.isInInventory = false;
      inv.accountId = a.id;
      inv.operationalStatus = body.holdActivation ? "STAGED" : "ACTIVE";
      const onAccount: PhoneNumberOnAccount = {
        id: t.phoneNumber,
        phoneNumber: t.phoneNumber,
        partitionId: a.partitionId,
        accountId: a.id,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        functionType: inv.functionType as PhoneNumberOnAccount["functionType"],
        operationalStatus: inv.operationalStatus,
        carrierStatus: body.holdActivation ? "ACTIVATION_ON_HOLD" : "ACTIVATION_PENDING",
        tollFree: inv.functionType === "TollFree",
        customerServiceRecord: csr,
        e911Address: body.e911Address,
        directoryListing: body.directoryListing,
      };
      state.numbers.push(onAccount);
      delete state.reservations[t.phoneNumber];
      state.orders.push({
        id: `sae_${state.orders.length + 1}`,
        partitionId: a.partitionId,
        accountId: a.id,
        serviceType: "ACTIVATION",
        referenceType: "TELEPHONE",
        referenceId: t.phoneNumber,
        activationStatusType: body.holdActivation ? "ON_HOLD" : "PENDING",
        createdDate: new Date().toISOString(),
        lastUpdatedDate: new Date().toISOString(),
        mainTelephoneNumber: t.phoneNumber,
        subTelephoneNumbers: [t.phoneNumber],
        companyName: csr.businessName,
        firstName: csr.firstName,
        lastName: csr.lastName,
        logs: [{ status: body.holdActivation ? "ON_HOLD" : "PENDING", actionDate: new Date().toISOString(), code: "Activation", message: "Start" }],
      });
      out.push({ phoneNumber: t.phoneNumber, referenceType: t.referenceType, referenceId: t.referenceId, functionType: inv.functionType, id: t.phoneNumber, tollFree: inv.functionType === "TollFree" });
    }
    res.json({ ...body, id: `act_${randomUUID().slice(0, 8)}`, partitionId: a.partitionId, accountId: a.id, telephoneNumbers: out });
  });

  app.get("/v2/partition/:partitionId/account/:accountId/telephonenumber/:tn", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const n = state.numbers.find((x) => x.accountId === a.id && x.phoneNumber === req.params.tn);
    if (!n) {
      fail(res, 404, `Telephone number ${req.params.tn} is not on account ${a.id}`);
      return;
    }
    res.json(n);
  });

  app.put("/v2/partition/:partitionId/account/:accountId/telephonenumber/:tn/destination", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const n = state.numbers.find((x) => x.accountId === a.id && x.phoneNumber === req.params.tn);
    if (!n) {
      fail(res, 404, `Telephone number ${req.params.tn} is not on account ${a.id}`);
      return;
    }
    const body = req.body as { referenceType?: PhoneNumberOnAccount["referenceType"]; referenceId?: string; assignAsCallerId?: boolean };
    if (!body.referenceType || !body.referenceId) {
      fail(res, 400, "referenceType and referenceId are required");
      return;
    }
    if (body.referenceType === "END_USER") {
      const u = state.users.find((x) => x.id === body.referenceId && x.accountId === a.id);
      if (!u) {
        fail(res, 400, `End user ${body.referenceId} is not on this account`);
        return;
      }
      if (body.assignAsCallerId) u.callerIdConfig = { ...u.callerIdConfig, callerIdNumber: n.phoneNumber, externalCallerIdVisible: true, extensionCallerIdVisible: true };
    }
    n.referenceType = body.referenceType;
    n.referenceId = body.referenceId;
    n.assignAsCallerId = body.assignAsCallerId;
    res.json({ partitionId: a.partitionId, accountId: a.id, telephoneNumber: n.phoneNumber, referenceType: n.referenceType, referenceId: n.referenceId, assignAsCallerId: body.assignAsCallerId ?? false, id: n.phoneNumber });
  });

  // ---- Partition inventory ---------------------------------------------------

  app.get("/v2/partition/:partitionId/telephonenumber/search", (req, res) => {
    if (!partition(req, res)) return;
    const type = String(req.query.type ?? "POSTALCODE_OR_TN");
    const q = String(req.query.q ?? "");
    const ft = String(req.query.functiontype ?? "ELS");
    const max = Number(req.query.maxResults ?? 10);
    if (type === "LAT_LONG" && (req.query.lat === undefined || req.query.long === undefined)) {
      fail(res, 400, "lat and long are required for LAT_LONG");
      return;
    }
    const pool = state.inventory.filter((n) => n.isInInventory && n.functionType === ft && !state.reservations[n.phoneNumber]);
    let hits = pool;
    if (type === "RATECENTER") hits = pool.filter((n) => (n.rateCenter ?? "").toUpperCase().startsWith(q.split(".")[0].toUpperCase()));
    else if (type === "TN" || (type === "POSTALCODE_OR_TN" && q.length > 5)) hits = pool.filter((n) => n.phoneNumber.startsWith(q));
    else if (type === "POSTALCODE" || type === "POSTALCODE_OR_TN") hits = q === "84042" || q === "" ? pool : [];
    res.json(hits.slice(0, max));
  });

  app.get("/v2/partition/:partitionId/telephonenumber/statussearch", (req, res) => {
    if (!partition(req, res)) return;
    const statuses = ([] as string[]).concat((req.query.statusType as string[] | string | undefined) ?? []);
    const types = ([] as string[]).concat((req.query.eventType as string[] | string | undefined) ?? []);
    const accountId = req.query.accountId as string | undefined;
    const tn = req.query.telephoneNumber as string | undefined;
    const all = state.orders.filter(
      (o) =>
        o.partitionId === req.params.partitionId &&
        (!accountId || o.accountId === accountId) &&
        (!tn || o.mainTelephoneNumber === tn || o.subTelephoneNumbers?.includes(tn)) &&
        (statuses.length === 0 || statuses.includes(o.activationStatusType ?? "")) &&
        (types.length === 0 || types.includes(o.serviceType ?? "")),
    );
    const first = Number(req.query.firstResultIndex ?? 0);
    const max = Number(req.query.maxResult ?? 50);
    res.json({ totalRecords: all.length, results: all.slice(first, first + max) });
  });

  app.get("/v2/partition/:partitionId/telephonenumber/:tn", (req, res) => {
    if (!partition(req, res)) return;
    const n = state.inventory.find((x) => x.phoneNumber === req.params.tn) ?? state.numbers.find((x) => x.phoneNumber === req.params.tn);
    if (!n) {
      fail(res, 404, `Telephone number ${req.params.tn} not found`);
      return;
    }
    const onAccount = state.numbers.find((x) => x.phoneNumber === req.params.tn);
    res.json({
      id: n.phoneNumber,
      partitionId: req.params.partitionId,
      phoneNumber: n.phoneNumber,
      rateCenter: "rateCenter" in n ? n.rateCenter : undefined,
      state: "state" in n ? n.state : undefined,
      country: "country" in n ? n.country : "USA",
      accountId: onAccount?.accountId ?? ("accountId" in n ? n.accountId : undefined),
      functionType: n.functionType,
      isInInventory: "isInInventory" in n ? n.isInInventory : false,
      cooldownExpireDate: "cooldownExpireDate" in n ? n.cooldownExpireDate : undefined,
      operationalStatus: onAccount?.operationalStatus ?? ("operationalStatus" in n ? n.operationalStatus : undefined),
      port: !!onAccount?.portId,
      byotn: false,
    });
  });

  app.put("/v2/partition/:partitionId/telephonenumber/:tn/reserve", (req, res) => {
    if (!partition(req, res)) return;
    const n = state.inventory.find((x) => x.phoneNumber === req.params.tn && x.isInInventory);
    if (!n) {
      fail(res, 404, `Telephone number ${req.params.tn} is not in inventory`);
      return;
    }
    state.reservations[n.phoneNumber] = "*";
    res.json({ id: n.phoneNumber, tn: n.phoneNumber, reserved: true, reservedTime: new Date().toISOString() });
  });

  app.delete("/v2/partition/:partitionId/telephonenumber/:tn/reserve", (req, res) => {
    if (!partition(req, res)) return;
    if (!state.reservations[req.params.tn]) {
      fail(res, 404, `Telephone number ${req.params.tn} is not reserved`);
      return;
    }
    delete state.reservations[req.params.tn];
    res.status(204).end();
  });

  // ---- Devices ---------------------------------------------------------------

  app.get("/v2/partition/:partitionId/account/:accountId/deviceline", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const filterType = req.query.filterType as string | undefined;
    const filter = req.query.filter as string | undefined;
    if (filterType && !filter) {
      fail(res, 400, "filter is required when filterType is set");
      return;
    }
    let devices = state.devices.filter((d) => d.accountId === a.id);
    if (filterType === "MAC_ADDRESS") devices = devices.filter((d) => d.macAddress === filter?.toLowerCase());
    else if (filterType === "OWNING_USERID") devices = devices.filter((d) => d.userId === filter);
    res.json(devices);
  });

  app.post("/v2/partition/:partitionId/account/:accountId/deviceline", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as Partial<Device>;
    if (!body.userId || !body.deviceName || !body.deviceTypeId || body.lineNumber === undefined) {
      fail(res, 400, "userId, deviceName, deviceTypeId and lineNumber are required");
      return;
    }
    if (!state.users.some((u) => u.id === body.userId && u.accountId === a.id)) {
      fail(res, 400, `End user ${body.userId} is not on this account`);
      return;
    }
    const p = state.partitions.find((x) => x.id === a.partitionId);
    if (p?.allowedDeviceTypes && !p.allowedDeviceTypes.includes(body.deviceTypeId)) {
      fail(res, 400, `Device type ${body.deviceTypeId} is not allowed on this partition`);
      return;
    }
    if (body.macAddress && state.devices.some((d) => d.macAddress === body.macAddress && d.lineNumber === body.lineNumber)) {
      fail(res, 400, `Line ${body.lineNumber} on MAC ${body.macAddress} is already in use`);
      return;
    }
    const created: Device = {
      id: `dev_${state.devices.length + 1}`,
      partitionId: a.partitionId,
      accountId: a.id,
      lineType: "Line",
      faxEnabled: false,
      emergencyNumber: "",
      ...body,
      sipUsername: `dev_${state.devices.length + 1}`,
    };
    state.devices.push(created);
    state.registrations[created.id] = false;
    res.status(201).json(created);
  });

  app.get("/v2/partition/:partitionId/account/:accountId/deviceline/:deviceId/registrationstatus", (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const d = state.devices.find((x) => x.accountId === a.id && x.id === req.params.deviceId);
    if (!d) {
      fail(res, 404, `Device ${req.params.deviceId} not found`);
      return;
    }
    res.json({ registered: state.registrations[d.id] ?? false });
  });

  // ---- Business lines --------------------------------------------------------

  const B = "/v2/partition/:partitionId/account/:accountId/business-line";
  const expandLine = (l: BusinessLine) => ({
    ...l,
    cname: l.callerIdName,
    callHandling: state.lineCallHandling[l.id],
    sipCredentials: { sipUsername: `sip_${l.id}` },
    device: state.linePorts[l.id],
  });
  const businessLine = (req: Request, res: Response) => {
    const a = account(req, res);
    if (!a) return undefined;
    const l = state.businessLines.find((x) => x.accountId === a.id && x.id === req.params.businessLineId);
    if (!l) fail(res, 404, `Business line ${req.params.businessLineId} not found`);
    return l;
  };

  app.get(B, (req, res) => {
    const a = account(req, res);
    if (a) res.json(state.businessLines.filter((l) => l.accountId === a.id));
  });
  app.get(`${B}/views/expanded`, (req, res) => {
    const a = account(req, res);
    if (a) res.json(state.businessLines.filter((l) => l.accountId === a.id).map(expandLine));
  });
  app.post(B, (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as Partial<BusinessLine>;
    if (!body.name) {
      fail(res, 400, "name is required");
      return;
    }
    for (const [field, tn] of [["callerIdPhoneNumber", body.callerIdPhoneNumber], ["emergencyCallbackPhoneNumber", body.emergencyCallbackPhoneNumber]] as const) {
      if (tn && !state.numbers.some((n) => n.accountId === a.id && n.phoneNumber === tn)) {
        fail(res, 400, `${field} ${tn} is not on this account`);
        return;
      }
    }
    const created: BusinessLine = {
      callerIdName: a.accountName.toUpperCase(),
      callerIdVisible: true,
      ...body,
      id: `bl_${state.businessLines.length + 1}`,
      name: body.name,
      accountId: a.id,
      partitionId: a.partitionId,
    };
    state.businessLines.push(created);
    state.lineCallHandling[created.id] = {
      activeCallHandling: "RING_LINE",
      callWaitingEnabled: true,
      busyFailoverAction: { "@type": "VoicemailRingFailoverAction" },
      unregisteredFailoverAction: { "@type": "VoicemailRingFailoverAction" },
      ringTimeoutConfiguration: { "@type": "LimitedRingTimeoutConfiguration", timeoutSeconds: 20, noAnswerAction: { "@type": "VoicemailRingFailoverAction" } },
    };
    state.lineRegistrations[created.id] = { registered: false, lockedOut: false };
    res.json(created);
  });
  app.get(`${B}/:businessLineId`, (req, res) => {
    const l = businessLine(req, res);
    if (l) res.json(l);
  });
  app.get(`${B}/:businessLineId/views/expanded`, (req, res) => {
    const l = businessLine(req, res);
    if (l) res.json(expandLine(l));
  });
  app.get(`${B}/:businessLineId/registration`, (req, res) => {
    const l = businessLine(req, res);
    if (l) res.json(state.lineRegistrations[l.id] ?? { registered: false, lockedOut: false });
  });
  app.get(`${B}/:businessLineId/call-handling`, (req, res) => {
    const l = businessLine(req, res);
    if (l) res.json(state.lineCallHandling[l.id]);
  });
  app.put(`${B}/:businessLineId/call-handling`, (req, res) => {
    const l = businessLine(req, res);
    if (!l) return;
    const body = req.body as BusinessLineCallHandling;
    if (!body.activeCallHandling || !body.busyFailoverAction || !body.unregisteredFailoverAction || !body.ringTimeoutConfiguration) {
      fail(res, 400, "activeCallHandling, busyFailoverAction, unregisteredFailoverAction and ringTimeoutConfiguration are required");
      return;
    }
    if (body.activeCallHandling === "FORWARD" && !body.forwardToPhoneNumber) {
      fail(res, 400, "forwardToPhoneNumber is required when activeCallHandling is FORWARD");
      return;
    }
    state.lineCallHandling[l.id] = body;
    res.json(body);
  });
  app.get(`${B}/:businessLineId/port-assignment`, (req, res) => {
    const l = businessLine(req, res);
    if (!l) return;
    const p = state.linePorts[l.id];
    if (!p) {
      fail(res, 404, `Business line ${l.id} has no port assignment`);
      return;
    }
    res.json(p);
  });
  const savePort = (create: boolean) => (req: Request, res: Response) => {
    const l = businessLine(req, res);
    if (!l) return;
    const body = req.body as BusinessLinePortAssignment;
    if (!body.deviceTypeId) {
      fail(res, 400, "deviceTypeId is required");
      return;
    }
    if (create && state.linePorts[l.id]) {
      fail(res, 400, `Business line ${l.id} already has a port assignment; use PUT`);
      return;
    }
    if (!create && !state.linePorts[l.id]) {
      fail(res, 404, `Business line ${l.id} has no port assignment; use POST`);
      return;
    }
    const clash = Object.entries(state.linePorts).find(
      ([id, p]) => id !== l.id && body.macAddress && p.macAddress === body.macAddress && p.portNumber === body.portNumber,
    );
    if (clash) {
      fail(res, 400, `Port ${body.portNumber} on MAC ${body.macAddress} is already used by business line ${clash[0]}`);
      return;
    }
    state.linePorts[l.id] = { ...body, businessLineId: l.id };
    res.json(state.linePorts[l.id]);
  };
  app.post(`${B}/:businessLineId/port-assignment`, savePort(true));
  app.put(`${B}/:businessLineId/port-assignment`, savePort(false));

  // ---- Hunt groups -----------------------------------------------------------

  const H = "/v2/partition/:partitionId/account/:accountId/business-line-hunt-group";
  const huntGroup = (req: Request, res: Response) => {
    const a = account(req, res);
    if (!a) return undefined;
    const g = state.huntGroups.find((x) => x.accountId === a.id && x.id === req.params.huntGroupId);
    if (!g) fail(res, 404, `Hunt group ${req.params.huntGroupId} not found`);
    return g;
  };
  const validateHunting = (a: Account, g: HuntGroup, res: Response): boolean => {
    const c = g.huntingConfiguration;
    if (!c || !c["@type"]) {
      fail(res, 400, "huntingConfiguration.@type is required");
      return false;
    }
    const ids = c["@type"] === "SimultaneousHuntingConfiguration" ? c.members : c.members.map((m) => m.businessLineId);
    if (!ids?.length) {
      fail(res, 400, "huntingConfiguration.members must have at least one member");
      return false;
    }
    const missing = ids.find((id) => !state.businessLines.some((l) => l.accountId === a.id && l.id === id));
    if (missing) {
      fail(res, 400, `Business line ${missing} is not on this account`);
      return false;
    }
    return true;
  };
  app.get(H, (req, res) => {
    const a = account(req, res);
    if (a) res.json(state.huntGroups.filter((g) => g.accountId === a.id));
  });
  app.post(H, (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as HuntGroup;
    if (!body.name) {
      fail(res, 400, "name is required");
      return;
    }
    if (!validateHunting(a, body, res)) return;
    const created: HuntGroup = { ...body, id: `hg_${state.huntGroups.length + 1}`, accountId: a.id, partitionId: a.partitionId };
    state.huntGroups.push(created);
    state.huntGroupFailover[created.id] = {
      BUSY: { "@type": "BusyFailoverAction", failoverReason: "BUSY" },
      NO_ANSWER: { "@type": "BusyFailoverAction", failoverReason: "NO_ANSWER" },
      UNREGISTERED: { "@type": "BusyFailoverAction", failoverReason: "UNREGISTERED" },
    };
    res.json(created);
  });
  app.get(`${H}/:huntGroupId`, (req, res) => {
    const g = huntGroup(req, res);
    if (g) res.json(g);
  });
  app.put(`${H}/:huntGroupId`, (req, res) => {
    const g = huntGroup(req, res);
    if (!g) return;
    const a = state.accounts.find((x) => x.id === g.accountId)!;
    const body = req.body as HuntGroup;
    if (!validateHunting(a, body, res)) return;
    Object.assign(g, { name: body.name ?? g.name, huntingConfiguration: body.huntingConfiguration });
    res.json(g);
  });
  app.get(`${H}/:huntGroupId/failover-action/:reason`, (req, res) => {
    const g = huntGroup(req, res);
    if (!g) return;
    const action = state.huntGroupFailover[g.id]?.[req.params.reason as HuntGroupFailoverReason];
    if (!action) {
      fail(res, 404, `No failover action for ${req.params.reason}`);
      return;
    }
    res.json(action);
  });
  app.put(`${H}/:huntGroupId/failover-action/:reason`, (req, res) => {
    const g = huntGroup(req, res);
    if (!g) return;
    const body = req.body as HuntGroupFailoverAction;
    if (!body["@type"] || body.failoverReason !== req.params.reason) {
      fail(res, 400, "@type and a matching failoverReason are required");
      return;
    }
    if (body["@type"] === "VoicemailFailoverAction" && !body.voicemailBoxId) {
      fail(res, 400, "voicemailBoxId is required");
      return;
    }
    state.huntGroupFailover[g.id] = { ...state.huntGroupFailover[g.id], [body.failoverReason]: body };
    res.json(body);
  });

  // ---- SIP trunks ------------------------------------------------------------

  const S = "/v2/partition/:partitionId/account/:accountId/siptrunk_2";
  const stripPassword = ({ sipPassword: _pw, ...t }: SipTrunk) => t;
  const sipTrunk = (req: Request, res: Response) => {
    const a = account(req, res);
    if (!a) return undefined;
    const t = state.sipTrunks.find((x) => x.accountId === a.id && x.id === req.params.sipTrunkId);
    if (!t) fail(res, 404, `SIP trunk ${req.params.sipTrunkId} not found`);
    return t;
  };
  app.get(S, (req, res) => {
    const a = account(req, res);
    if (a) res.json(state.sipTrunks.filter((t) => t.accountId === a.id).map(stripPassword));
  });
  app.post(S, (req, res) => {
    const a = account(req, res);
    if (!a) return;
    const body = req.body as Partial<SipTrunk>;
    if (!body.trunkName || !body.sipUsername || !body.sipPassword || !body.concurrentCalls) {
      fail(res, 400, "trunkName, sipUsername, sipPassword and concurrentCalls are required");
      return;
    }
    if (state.sipTrunks.some((t) => t.sipUsername === body.sipUsername)) {
      fail(res, 400, `SIP username ${body.sipUsername} is already in use`);
      return;
    }
    if (state.sipTrunks.some((t) => t.accountId === a.id && t.trunkName === body.trunkName)) {
      fail(res, 400, `Trunk name ${body.trunkName} already exists on this account`);
      return;
    }
    for (const tn of [body.primaryTn, body.callbackNumber]) {
      if (tn && !state.numbers.some((n) => n.accountId === a.id && n.phoneNumber === tn)) {
        fail(res, 400, `Telephone number ${tn} is not on this account`);
        return;
      }
    }
    const created: SipTrunk = {
      localServicesEnabled: false,
      ipBasedAuthEnabled: false,
      lockedOut: false,
      telephoneNumbers: [],
      callingPlans: [{ referenceId: "", referenceType: "SIP_TRUNK", callingPlanProductId: "cpp_unlimited", planMinutes: 20000, secondsRemaining: 1200000 }],
      ...body,
      id: `trk_${state.sipTrunks.length + 1}`,
      trunkName: body.trunkName,
      accountId: a.id,
      partitionId: a.partitionId,
      sipProxyServer: "sip.alianza.example",
      provisioningStatus: "PROVISIONED",
    };
    created.callingPlans![0].referenceId = created.id;
    state.sipTrunks.push(created);
    state.sipTrunkRegistrations[created.id] = false;
    state.sipTrunkForward[created.id] = { sipTrunkId: created.id, forwardOnFailure: [], forwardOnCapacityExceeded: [] };
    res.json(created);
  });
  app.get(`${S}/:sipTrunkId`, (req, res) => {
    const t = sipTrunk(req, res);
    if (t) res.json(stripPassword(t));
  });
  app.get(`${S}/:sipTrunkId/registrationstatus`, (req, res) => {
    const t = sipTrunk(req, res);
    if (t) res.json({ registered: state.sipTrunkRegistrations[t.id] ?? false, lockedOut: t.lockedOut ?? false });
  });
  app.get(`${S}/:sipTrunkId/forward`, (req, res) => {
    const t = sipTrunk(req, res);
    if (t) res.json(state.sipTrunkForward[t.id] ?? { sipTrunkId: t.id });
  });

  // ---- Address ---------------------------------------------------------------

  app.get("/v2/address/validate", (req, res) => {
    const address = String(req.query.address ?? "");
    if (!address) {
      fail(res, 400, "address is required");
      return;
    }
    if (/nowhere/i.test(address)) {
      res.json({ valid: false, requiredFields: [], customerServiceRecord: {} });
      return;
    }
    const needsUnit = /tower/i.test(address);
    res.json({
      valid: true,
      requiredFields: needsUnit ? ["unit", "secondaryLocationDescription"] : [],
      customerServiceRecord: {
        streetNumber: "333",
        streetNumberSuffix: "",
        preDirectional: "S",
        streetName: "520",
        streetSuffix: "",
        postDirectional: "W",
        city: "Lindon",
        state: "UT",
        country: String(req.query.country ?? "USA"),
        postalCode: String(req.query.postalCode ?? "84042"),
        blockCustomerName: false,
      },
      latitude: "40.332486",
      longitude: "-111.728156",
    });
  });

  app.use((_req, res) => fail(res, 404, "No such endpoint in the fake Alianza API"));

  return {
    app,
    state,
    /** Simulate token expiry: every issued token stops working. */
    expireTokens() {
      tokens.clear();
    },
    get loginCount() {
      return loginCount;
    },
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.FAKE_API_PORT ?? 4010);
  createFakeApi().app.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `fake alianza api listening on http://127.0.0.1:${port} (login ${FAKE_USERNAME} / ${FAKE_PASSWORD}, partition ${FAKE_PARTITION_ID})\n`,
    );
  });
}
