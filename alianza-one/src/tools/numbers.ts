/**
 * Telephone numbers: on an account, in partition inventory, activation and
 * port orders, reservations, and address validation.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type ApiClient } from "../api-client.js";
import {
  ACTIVATION_EVENT_TYPES,
  ACTIVATION_STATUSES,
  DIRECTIONALS,
  REFERENCE_TYPES,
  SECONDARY_LOCATION_TYPES,
  type CustomerServiceRecord,
  type E911Address,
  type InventoryNumber,
  type PhoneNumberOnAccount,
  type ServiceActivationEvent,
} from "../alianza-types.js";
import { log } from "../log.js";
import {
  accountIdInput,
  compact,
  dateInput,
  formatAddress,
  jsonText,
  normalizePhoneNumber,
  pageArray,
  pageHint,
  partitionIdInput,
  phoneNumberInput,
} from "./common.js";
import { withErrorHandling } from "./errors.js";

const accountNumberShape = {
  phoneNumber: z.string(),
  accountId: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  functionType: z.string().optional(),
  operationalStatus: z.string().optional(),
  carrierStatus: z.string().optional(),
  portId: z.string().optional(),
  tollFree: z.boolean().optional(),
  canAcceptSMS: z.boolean().optional(),
  assignAsCallerId: z.boolean().optional(),
  callerIdName: z.string().optional(),
  e911Address: z.string().optional(),
  directoryListingType: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

function toAccountNumberView(n: PhoneNumberOnAccount) {
  return compact({
    phoneNumber: n.phoneNumber,
    accountId: n.accountId,
    referenceType: n.referenceType,
    referenceId: n.referenceId,
    functionType: n.functionType,
    operationalStatus: n.operationalStatus,
    carrierStatus: n.carrierStatus,
    portId: n.portId,
    tollFree: n.tollFree,
    canAcceptSMS: n.canAcceptSMS,
    assignAsCallerId: n.assignAsCallerId,
    callerIdName: n.customerServiceRecord?.customerName,
    e911Address: formatAddress(n.e911Address ?? n.customerServiceRecord),
    directoryListingType: n.directoryListing?.type,
    tags: n.tags,
  });
}

const inventoryNumberShape = {
  phoneNumber: z.string(),
  partitionId: z.string().optional(),
  accountId: z.string().optional(),
  rateCenter: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  carrierId: z.string().optional(),
  functionType: z.string().optional(),
  operationalStatus: z.string().optional(),
  isInInventory: z.boolean().optional(),
  cooldownExpireDate: z.string().optional(),
  distance: z.number().optional(),
  matchesZip: z.boolean().optional(),
  byotn: z.boolean().optional(),
  port: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
};

function toInventoryView(n: InventoryNumber) {
  return compact({
    phoneNumber: n.phoneNumber,
    partitionId: n.partitionId,
    accountId: n.accountId,
    rateCenter: n.rateCenter,
    state: n.state,
    country: n.country,
    carrierId: n.carrierId,
    functionType: n.functionType,
    operationalStatus: n.operationalStatus,
    isInInventory: n.isInInventory,
    cooldownExpireDate: n.cooldownExpireDate,
    distance: n.distance,
    matchesZip: n.matchesZip,
    byotn: n.byotn,
    port: n.port,
    tags: n.tags,
  });
}

const orderShape = {
  id: z.string(),
  serviceType: z.string().optional(),
  status: z.string().optional(),
  accountId: z.string().optional(),
  mainTelephoneNumber: z.string().optional(),
  subTelephoneNumbers: z.array(z.string()).optional(),
  customerName: z.string().optional(),
  createdDate: z.string().optional(),
  lastUpdatedDate: z.string().optional(),
  crdDate: z.string().optional(),
  focDate: z.string().optional(),
  losingCarrier: z.string().optional(),
  carrierType: z.string().optional(),
  parentOrderId: z.string().optional(),
  editableFields: z.array(z.string()).optional(),
  lastLog: z
    .object({
      status: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      actionDate: z.string().optional(),
    })
    .optional(),
};

function toOrderView(e: ServiceActivationEvent) {
  const last = e.logs?.length ? e.logs[e.logs.length - 1] : undefined;
  return compact({
    id: e.id,
    serviceType: e.serviceType,
    status: e.activationStatusType,
    accountId: e.accountId,
    mainTelephoneNumber: e.mainTelephoneNumber,
    subTelephoneNumbers: e.subTelephoneNumbers,
    customerName: e.companyName ?? [e.firstName, e.lastName].filter(Boolean).join(" ") ?? undefined,
    createdDate: e.createdDate,
    lastUpdatedDate: e.lastUpdatedDate,
    crdDate: e.crdDate,
    focDate: e.focDate,
    losingCarrier: e.losingCarrier,
    carrierType: e.inboundCarrierType,
    parentOrderId: e.parentOrderId,
    editableFields: e.editableFieldTypes,
    lastLog: last
      ? compact({ status: last.status, code: last.code, message: last.message, actionDate: last.actionDate })
      : undefined,
  });
}

const addressInputs = {
  streetNumber: z.string().min(1).describe("House/building number, e.g. 333."),
  streetNumberSuffix: z.string().optional().describe("e.g. 1/2 in '123 1/2 Main St'."),
  preDirectional: z.enum(DIRECTIONALS).optional().describe("Directional before the street name, e.g. S in '333 S 520 W'."),
  streetName: z.string().min(1).describe("Street name without number or suffix, e.g. 520 or Jefferson."),
  streetSuffix: z.string().optional().describe("St, Ave, Blvd, etc."),
  postDirectional: z.enum(DIRECTIONALS).optional().describe("Directional after the street, e.g. W in '333 S 520 W'."),
  city: z.string().min(1).describe("City or municipality."),
  state: z.string().length(2).describe("Two-letter state or province code, e.g. UT."),
  postalCode: z.string().min(3).describe("ZIP or postal code."),
  country: z.enum(["USA", "CAN"]).default("USA").describe("USA or CAN."),
  unit: z.string().max(10).optional().describe("Unit number, if the building requires one."),
  secondaryLocationDescription: z
    .enum(SECONDARY_LOCATION_TYPES)
    .optional()
    .describe("Kind of unit: SUITE, APARTMENT, FLOOR, etc. Required when unit is set."),
};

export function registerNumberTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    "alianza_list_phone_numbers",
    {
      title: "List phone numbers on an account",
      description:
        "List every telephone number on an account with where it routes (referenceType/referenceId, e.g. END_USER + " +
        "user id), carrier status (ACTIVE, PORT_PENDING, ACTIVATION_PENDING, ...), port id, caller id name, E911 " +
        "address, and directory listing. Use this to answer 'what numbers does this customer have' and 'where does " +
        "18015551212 ring'. For a number whose account you do not know, use alianza_get_phone_number. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum numbers to return."),
        offset: z.number().int().min(0).default(0).describe("Numbers to skip for paging."),
      },
      outputSchema: {
        phoneNumbers: z.array(z.object(accountNumberShape)),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, limit, offset }) =>
      withErrorHandling("alianza_list_phone_numbers", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const numbers = (await api.listAccountNumbers(pid, accountId)).map(toAccountNumberView);
        const { page, text: hint } = pageArray(numbers, limit, offset);
        const lines = page.map(
          (n) =>
            `- ${n.phoneNumber}: ${n.referenceType ? `${n.referenceType} ${n.referenceId ?? ""}` : "unassigned"} [${n.carrierStatus ?? n.operationalStatus ?? "?"}]` +
            (n.portId ? ` port ${n.portId}` : ""),
        );
        const text = numbers.length === 0 ? "This account has no phone numbers." : `${hint}\n${lines.join("\n")}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { phoneNumbers: page, total: numbers.length, offset, limit },
        };
      }),
  );

  server.registerTool(
    "alianza_get_phone_number",
    {
      title: "Get phone number",
      description:
        "Look up a single telephone number in the partition: whether it is in inventory or on an account (and which), " +
        "rate center and state, operational and carrier status, cooldown after deletion, and, when it is on an " +
        "account, where it routes and its E911 address. Use this for 'whose number is 18015551212' or 'is this number " +
        "available'. To find numbers to assign, use alianza_search_available_numbers instead. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        phoneNumber: phoneNumberInput,
      },
      outputSchema: {
        inventory: z.object(inventoryNumberShape),
        onAccount: z.object(accountNumberShape).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, phoneNumber }) =>
      withErrorHandling("alianza_get_phone_number", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const tn = normalizePhoneNumber(phoneNumber);
        const inventory = toInventoryView(await api.getInventoryNumber(pid, tn));
        let onAccount: ReturnType<typeof toAccountNumberView> | undefined;
        if (inventory.accountId) {
          try {
            onAccount = toAccountNumberView(await api.getAccountNumber(pid, inventory.accountId, tn));
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
        }
        const out = compact({ inventory, onAccount });
        const where = inventory.accountId
          ? `on account ${inventory.accountId}` +
            (onAccount?.referenceType ? `, routed to ${onAccount.referenceType} ${onAccount.referenceId ?? ""}` : "")
          : inventory.isInInventory
            ? "in partition inventory (not assigned)"
            : "known to the partition but not in inventory";
        const text = `${tn} is ${where}. Status: ${onAccount?.carrierStatus ?? inventory.operationalStatus ?? "unknown"}.\n${jsonText(out)}`;
        return { content: [{ type: "text", text }], structuredContent: out };
      }),
  );

  server.registerTool(
    "alianza_search_available_numbers",
    {
      title: "Search available numbers in inventory",
      description:
        "Find unassigned telephone numbers in the partition's inventory near a location. Search by ZIP/postal code " +
        "(most common), by latitude/longitude (most accurate; get them from alianza_validate_address), by rate center " +
        "name (e.g. ALBANY or ALBANY.NY), or by a specific number/prefix. Returns up to `maxResults` candidates " +
        "with rate center, state, and distance. Alianza holds returned numbers briefly; use " +
        "alianza_reserve_phone_number to hold one for 30 minutes and alianza_add_phone_number to assign it. Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        searchType: z
          .enum(["POSTALCODE", "LAT_LONG", "RATECENTER", "TN", "POSTALCODE_OR_TN"])
          .default("POSTALCODE_OR_TN")
          .describe("How to interpret the search. POSTALCODE_OR_TN accepts either a postal code or a number/prefix in `query`."),
        query: z
          .string()
          .optional()
          .describe("Postal code (84042), rate center (ALBANY or ALBANY.NY), or number/prefix (1801555). Not used for LAT_LONG."),
        latitude: z.number().min(-90).max(90).optional().describe("Required for LAT_LONG."),
        longitude: z.number().min(-180).max(180).optional().describe("Required for LAT_LONG."),
        functionType: z
          .enum(["ELS", "TollFree", "TemporaryNumber", "SPTN"])
          .default("ELS")
          .describe("ELS = ordinary local number (default). TollFree for 8xx numbers."),
        maxResults: z.number().int().min(1).max(15).default(10).describe("Numbers to return (Alianza allows up to 15)."),
      },
      outputSchema: {
        phoneNumbers: z.array(z.object(inventoryNumberShape)),
        total: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, searchType, query, latitude, longitude, functionType, maxResults }) =>
      withErrorHandling("alianza_search_available_numbers", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        if (searchType === "LAT_LONG" && (latitude === undefined || longitude === undefined)) {
          return { content: [{ type: "text", text: "LAT_LONG searches need both latitude and longitude." }], isError: true };
        }
        if (searchType !== "LAT_LONG" && !query) {
          return { content: [{ type: "text", text: `A ${searchType} search needs \`query\`.` }], isError: true };
        }
        const results = (
          await api.searchInventory(pid, {
            type: searchType,
            q: searchType === "LAT_LONG" ? undefined : query,
            lat: latitude,
            long: longitude,
            functiontype: functionType,
            maxResults,
          })
        ).map(toInventoryView);
        const lines = results.map(
          (n) =>
            `- ${n.phoneNumber} (${n.rateCenter ?? "?"}, ${n.state ?? "?"}` +
            (n.distance !== undefined ? `, ${n.distance.toFixed(1)} mi` : "") +
            ")",
        );
        const text =
          results.length === 0
            ? "No available numbers matched. Try a nearby postal code, a LAT_LONG search, or a different rate center."
            : `${results.length} available number(s):\n${lines.join("\n")}`;
        return { content: [{ type: "text", text }], structuredContent: { phoneNumbers: results, total: results.length } };
      }),
  );

  server.registerTool(
    "alianza_reserve_phone_number",
    {
      title: "Reserve or release a phone number",
      description:
        "Hold an inventory number for 30 minutes so nobody else assigns it while you finish provisioning " +
        "(action=reserve), or drop a hold early (action=release). Reserving is optional before " +
        "alianza_add_phone_number but recommended when there is a delay between choosing and assigning. " +
        "Reservations expire on their own; releasing is reversible.",
      inputSchema: {
        partitionId: partitionIdInput,
        phoneNumber: phoneNumberInput,
        action: z
          .enum(["reserve", "release"])
          .default("reserve")
          .describe("reserve to hold the number for 30 minutes; release to drop an existing hold."),
      },
      outputSchema: {
        phoneNumber: z.string(),
        reserved: z.boolean(),
        reservedTime: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, phoneNumber, action }) =>
      withErrorHandling("alianza_reserve_phone_number", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const tn = normalizePhoneNumber(phoneNumber);
        if (action === "release") {
          await api.releaseNumber(pid, tn);
          const out = { phoneNumber: tn, reserved: false };
          return { content: [{ type: "text", text: `Released the reservation on ${tn}.` }], structuredContent: out };
        }
        const res = await api.reserveNumber(pid, tn);
        const out = compact({ phoneNumber: tn, reserved: res.reserved ?? true, reservedTime: res.reservedTime });
        return {
          content: [{ type: "text", text: `Reserved ${tn} for about 30 minutes${out.reservedTime ? ` (since ${out.reservedTime})` : ""}.` }],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_validate_address",
    {
      title: "Validate a service address",
      description:
        "Parse and validate a single-line street address against Alianza's carrier and E911 address vendors. Returns " +
        "the address split into the fields alianza_add_phone_number needs (streetNumber, preDirectional, streetName, " +
        "streetSuffix, city, state, postalCode), latitude/longitude for alianza_search_available_numbers, whether it " +
        "validated, and any fields still required (for example unit and secondaryLocationDescription for multi-unit " +
        "buildings). Do this before activating or porting a number; unvalidated E911 addresses get rejected. Read-only.",
      inputSchema: {
        address: z.string().min(5).describe("Single-line address, e.g. '333 S 520 W, Lindon, UT'."),
        postalCode: z.string().optional().describe("ZIP or postal code. Improves match quality; include it when known."),
        country: z.enum(["USA", "CAN", "UNK"]).default("USA").describe("USA, CAN, or UNK if unsure."),
      },
      outputSchema: {
        valid: z.boolean().optional(),
        requiredFields: z.array(z.string()).optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        address: z
          .object({
            streetNumber: z.string().optional(),
            streetNumberSuffix: z.string().optional(),
            preDirectional: z.string().optional(),
            streetName: z.string().optional(),
            streetSuffix: z.string().optional(),
            postDirectional: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            unit: z.string().optional(),
            secondaryLocationDescription: z.string().optional(),
          })
          .optional(),
        formatted: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address, postalCode, country }) =>
      withErrorHandling("alianza_validate_address", async () => {
        const res = await api.validateAddress({ address, postalCode, country });
        const csr = res.customerServiceRecord;
        const out = compact({
          valid: res.valid,
          requiredFields: res.requiredFields,
          latitude: res.latitude,
          longitude: res.longitude,
          address: csr
            ? compact({
                streetNumber: csr.streetNumber,
                streetNumberSuffix: csr.streetNumberSuffix,
                preDirectional: csr.preDirectional,
                streetName: csr.streetName,
                streetSuffix: csr.streetSuffix,
                postDirectional: csr.postDirectional,
                city: csr.city,
                state: csr.state,
                postalCode: csr.postalCode,
                country: csr.country,
                unit: csr.unit,
                secondaryLocationDescription: csr.secondaryLocationDescription,
              })
            : undefined,
          formatted: formatAddress(csr),
        });
        const need = out.requiredFields?.length ? ` Still required: ${out.requiredFields.join(", ")}.` : "";
        const text =
          `${out.valid ? "Valid" : "Not validated"}: ${out.formatted ?? address}` +
          (out.latitude ? ` (lat ${out.latitude}, long ${out.longitude})` : "") +
          `.${need}\n${jsonText(out)}`;
        return { content: [{ type: "text", text }], structuredContent: out };
      }),
  );

  server.registerTool(
    "alianza_search_number_orders",
    {
      title: "Search number activation and port orders",
      description:
        "Track carrier orders for telephone numbers: new-number activations, port-ins, disconnects, E911 address " +
        "changes, and CSR changes. Use this to answer 'what is the status of the port for 18015551212', 'which ports " +
        "are pending FOC', or 'did the activation complete'. Filter by account, number, status (PENDING, IN_PROGRESS, " +
        "FOC_RECEIVED, REJECTED, COMPLETED, ON_HOLD, ...), order type, and date range. Returns total and up to " +
        "`limit` orders with status, FOC and requested dates, losing carrier, editable fields, and the latest log " +
        "entry (rejection reasons appear there). Read-only.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: z.string().min(1).optional().describe("Restrict to one account id."),
        phoneNumber: phoneNumberInput.optional().describe("Restrict to one telephone number."),
        statuses: z.array(z.enum(ACTIVATION_STATUSES)).optional().describe("Only orders in these statuses."),
        orderTypes: z
          .array(z.enum(ACTIVATION_EVENT_TYPES))
          .optional()
          .describe("Only these order types, e.g. [\"PORT_REQUEST\"] or [\"ACTIVATION\"]."),
        startDate: dateInput.optional().describe("Start of date range (see dateType)."),
        endDate: dateInput.optional().describe("End of date range (see dateType)."),
        dateType: z
          .enum(["CreatedDate", "UpdatedDate", "FOCDate"])
          .default("UpdatedDate")
          .describe("Which date the range applies to."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum orders to return."),
        offset: z.number().int().min(0).default(0).describe("Orders to skip for paging."),
      },
      outputSchema: {
        orders: z.array(z.object(orderShape)),
        total: z.number().int().optional(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, phoneNumber, statuses, orderTypes, startDate, endDate, dateType, limit, offset }) =>
      withErrorHandling("alianza_search_number_orders", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const res = await api.searchActivationEvents(pid, {
          accountId,
          telephoneNumber: phoneNumber ? normalizePhoneNumber(phoneNumber) : undefined,
          statusType: statuses,
          eventType: orderTypes,
          startDate,
          endDate,
          dateType: startDate || endDate ? dateType : undefined,
          firstResultIndex: offset,
          maxResult: limit,
        });
        const orders = (res.results ?? []).map(toOrderView);
        const lines = orders.map(
          (o) =>
            `- ${o.id}: ${o.serviceType ?? "?"} ${o.mainTelephoneNumber ?? ""} ${o.status ?? "?"}` +
            (o.focDate ? ` FOC ${o.focDate.slice(0, 10)}` : "") +
            (o.lastLog?.message ? ` — ${o.lastLog.message}` : ""),
        );
        const text = `${pageHint(orders.length, res.totalRecords, offset)}\n${lines.join("\n")}`.trim();
        return {
          content: [{ type: "text", text }],
          structuredContent: compact({ orders, total: res.totalRecords, offset, limit }),
        };
      }),
  );

  server.registerTool(
    "alianza_add_phone_number",
    {
      title: "Activate a phone number on an account",
      description:
        "Assign an inventory number to an account and submit its carrier activation (step 3 of provisioning). Use " +
        "alianza_validate_address first and pass the parsed address fields as the customer service record; it is " +
        "also used as the E911 address. Pass referenceType/referenceId to route the number immediately (e.g. " +
        "END_USER + user id), or route later with alianza_set_phone_number_destination. Set holdActivation=true to " +
        "stage the number without telling the carrier yet. This tool activates new numbers only; it does not port " +
        "numbers from another carrier. Activation is a billable carrier order: confirm the number and address with " +
        "the user before calling. Track progress with alianza_search_number_orders.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        phoneNumber: phoneNumberInput.describe("Number from alianza_search_available_numbers, 11 digits."),
        customerType: z.enum(["RESIDENTIAL", "BUSINESS"]).describe("Who the number is for."),
        firstName: z.string().optional().describe("Required for RESIDENTIAL."),
        lastName: z.string().optional().describe("Required for RESIDENTIAL."),
        businessName: z.string().optional().describe("Required for BUSINESS."),
        callerIdName: z
          .string()
          .max(15)
          .optional()
          .describe("Outbound caller id name, up to 15 characters. Defaults to the customer's name."),
        ...addressInputs,
        latitude: z.string().optional().describe("From alianza_validate_address; improves E911 acceptance."),
        longitude: z.string().optional().describe("From alianza_validate_address; improves E911 acceptance."),
        directoryListingType: z
          .enum(["NOT_LIST_NOT_PUBLISH", "LIST_NOT_PUBLISH", "LIST_PUBLISH"])
          .default("NOT_LIST_NOT_PUBLISH")
          .describe("Directory listing. NOT_LIST_NOT_PUBLISH keeps the number unlisted (recommended default)."),
        holdActivation: z.boolean().default(false).describe("True to stage the number without submitting to the carrier."),
        referenceType: z.enum(REFERENCE_TYPES).optional().describe("Where to route inbound calls, e.g. END_USER."),
        referenceId: z.string().optional().describe("Id of the routing target, e.g. the user id for END_USER."),
      },
      outputSchema: {
        orderId: z.string().optional(),
        accountId: z.string(),
        holdActivation: z.boolean().optional(),
        phoneNumbers: z.array(
          z.object({
            phoneNumber: z.string(),
            referenceType: z.string().optional(),
            referenceId: z.string().optional(),
            functionType: z.string().optional(),
            portId: z.string().optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ partitionId, accountId, phoneNumber, ...input }) =>
      withErrorHandling("alianza_add_phone_number", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const tn = normalizePhoneNumber(phoneNumber);
        if (input.customerType === "RESIDENTIAL" && !(input.firstName && input.lastName)) {
          return { content: [{ type: "text", text: "RESIDENTIAL numbers need firstName and lastName." }], isError: true };
        }
        if (input.customerType === "BUSINESS" && !input.businessName) {
          return { content: [{ type: "text", text: "BUSINESS numbers need businessName." }], isError: true };
        }
        if (input.unit && !input.secondaryLocationDescription) {
          return {
            content: [{ type: "text", text: "unit requires secondaryLocationDescription (SUITE, APARTMENT, ...)." }],
            isError: true,
          };
        }
        if ((input.referenceType && !input.referenceId) || (!input.referenceType && input.referenceId)) {
          return { content: [{ type: "text", text: "referenceType and referenceId must be given together." }], isError: true };
        }
        const address = compact({
          firstName: input.firstName,
          lastName: input.lastName,
          businessName: input.businessName,
          streetNumber: input.streetNumber,
          streetNumberSuffix: input.streetNumberSuffix,
          preDirectional: input.preDirectional,
          streetName: input.streetName,
          streetSuffix: input.streetSuffix,
          postDirectional: input.postDirectional,
          city: input.city,
          state: input.state.toUpperCase(),
          postalCode: input.postalCode,
          country: input.country,
          unit: input.unit,
          secondaryLocationDescription: input.secondaryLocationDescription,
        });
        const customerName =
          input.callerIdName ??
          (input.customerType === "BUSINESS"
            ? input.businessName
            : `${input.lastName} ${input.firstName}`
          )?.slice(0, 15);
        const csr: CustomerServiceRecord = { ...address, customerType: input.customerType, customerName };
        const e911: E911Address = compact({
          ...address,
          customerType: input.customerType,
          latitude: input.latitude,
          longitude: input.longitude,
        });
        const listed = input.directoryListingType !== "NOT_LIST_NOT_PUBLISH";
        const res = await api.activateNumbers(pid, accountId, {
          customerServiceRecord: csr,
          e911Address: e911,
          directoryListing: compact({ listed, type: input.directoryListingType, address: listed ? address : undefined }),
          holdActivation: input.holdActivation,
          telephoneNumbers: [
            compact({ phoneNumber: tn, referenceType: input.referenceType, referenceId: input.referenceId }),
          ],
        });
        const out = compact({
          orderId: res.id,
          accountId,
          holdActivation: res.holdActivation,
          phoneNumbers: (res.telephoneNumbers ?? []).map((n) =>
            compact({
              phoneNumber: n.phoneNumber,
              referenceType: n.referenceType,
              referenceId: n.referenceId,
              functionType: n.functionType,
              portId: n.portId,
            }),
          ),
        });
        log.info("phone number activation submitted", { partitionId: pid, accountId, tn, hold: input.holdActivation });
        const next = input.holdActivation
          ? "The activation is on hold (ON_HOLD) and has not been sent to the carrier."
          : "Carrier activation was submitted; check alianza_search_number_orders for status.";
        const routing = input.referenceType
          ? ` Routed to ${input.referenceType} ${input.referenceId}.`
          : " Route it with alianza_set_phone_number_destination.";
        return {
          content: [{ type: "text", text: `Added ${tn} to account ${accountId}. ${next}${routing}\n${jsonText(out)}` }],
          structuredContent: out,
        };
      }),
  );

  server.registerTool(
    "alianza_set_phone_number_destination",
    {
      title: "Route a phone number",
      description:
        "Set where inbound calls to a number on an account go (step 4 of provisioning): an END_USER, SIP_TRUNK, IVR, " +
        "AUTO_ATTENDANT, BUSINESS_LINE, BUSINESS_LINE_HUNT_GROUP, VFAX, CALL_GROUP, CALL_QUEUE, or CONTACT_CENTER, " +
        "identified by its id. For END_USER destinations, assignAsCallerId=true also makes this number the user's " +
        "outbound caller id. Replaces the previous destination (reversible by calling again). Use " +
        "alianza_list_phone_numbers to see current routing.",
      inputSchema: {
        partitionId: partitionIdInput,
        accountId: accountIdInput,
        phoneNumber: phoneNumberInput,
        referenceType: z.enum(REFERENCE_TYPES).describe("Kind of destination."),
        referenceId: z.string().min(1).describe("Id of the destination object, e.g. a user id for END_USER."),
        assignAsCallerId: z
          .boolean()
          .default(false)
          .describe("For END_USER only: also use this number as the user's outbound caller id."),
      },
      outputSchema: {
        phoneNumber: z.string(),
        accountId: z.string().optional(),
        referenceType: z.string().optional(),
        referenceId: z.string().optional(),
        assignAsCallerId: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ partitionId, accountId, phoneNumber, referenceType, referenceId, assignAsCallerId }) =>
      withErrorHandling("alianza_set_phone_number_destination", async () => {
        const pid = await api.resolvePartitionId(partitionId);
        const tn = normalizePhoneNumber(phoneNumber);
        const res = await api.setNumberDestination(pid, accountId, tn, {
          referenceType,
          referenceId,
          assignAsCallerId: referenceType === "END_USER" ? assignAsCallerId : undefined,
        });
        const out = compact({
          phoneNumber: res.telephoneNumber ?? tn,
          accountId: res.accountId ?? accountId,
          referenceType: res.referenceType ?? referenceType,
          referenceId: res.referenceId ?? referenceId,
          assignAsCallerId: res.assignAsCallerId,
        });
        log.info("phone number routed", { partitionId: pid, accountId, tn, referenceType, referenceId });
        return {
          content: [
            {
              type: "text",
              text: `${tn} now routes to ${out.referenceType} ${out.referenceId}${out.assignAsCallerId ? " and is the user's caller id" : ""}.`,
            },
          ],
          structuredContent: out,
        };
      }),
  );
}
