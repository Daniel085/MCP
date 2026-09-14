/**
 * Seed data for the fake Alianza API. Shapes follow the Alianza Public API v2
 * schemas (Account, EndUserV2X, TelephoneNumberAccountV2X, DeviceX, ...).
 */
import type {
  Account,
  BusinessLine,
  BusinessLineCallHandling,
  BusinessLinePortAssignment,
  HuntGroup,
  HuntGroupFailoverAction,
  HuntGroupFailoverReason,
  SipTrunk,
  SipTrunkForwardRules,
  AccountHistoryRecord,
  CallDetailRecord,
  Device,
  EndUser,
  InventoryNumber,
  Partition,
  PhoneNumberOnAccount,
  ServiceActivationEvent,
  VoicemailMessage,
} from "./alianza-types.js";

export const FAKE_USERNAME = "api@example.com";
export const FAKE_PASSWORD = "correct-horse";
export const FAKE_PARTITION_ID = "prt_1";

export interface FakeState {
  partitions: Partition[];
  accounts: Account[];
  users: EndUser[];
  numbers: PhoneNumberOnAccount[];
  inventory: InventoryNumber[];
  devices: Device[];
  registrations: Record<string, boolean>;
  cdrs: Record<string, CallDetailRecord[]>;
  history: Record<string, AccountHistoryRecord[]>;
  voicemail: Record<string, VoicemailMessage[]>;
  orders: ServiceActivationEvent[];
  reservations: Record<string, string>;
  businessLines: BusinessLine[];
  lineCallHandling: Record<string, BusinessLineCallHandling>;
  linePorts: Record<string, BusinessLinePortAssignment>;
  lineRegistrations: Record<string, { registered: boolean; lockedOut: boolean }>;
  huntGroups: HuntGroup[];
  huntGroupFailover: Record<string, Partial<Record<HuntGroupFailoverReason, HuntGroupFailoverAction>>>;
  sipTrunks: SipTrunk[];
  sipTrunkRegistrations: Record<string, boolean>;
  sipTrunkForward: Record<string, SipTrunkForwardRules>;
}

const csrJane = {
  firstName: "Jane",
  lastName: "Doe",
  streetNumber: "333",
  preDirectional: "S",
  streetName: "520",
  postDirectional: "W",
  city: "Lindon",
  state: "UT",
  country: "USA",
  postalCode: "84042",
  customerType: "BUSINESS" as const,
  customerName: "ACME DENTAL",
  businessName: "Acme Dental",
};

export function seed(): FakeState {
  return {
    partitions: [
      {
        id: FAKE_PARTITION_ID,
        name: "Acme Telecom",
        status: "ACTIVE",
        country: "USA",
        customerServiceNumber: "18015550000",
        defaultTimeZone: "US/Mountain",
        defaultExtensionLength: 4,
        subPartitionIds: ["prt_1_sub"],
        tnDeleteCooldownDays: 30,
        requiresDeviceInventory: false,
        allowedDeviceTypes: ["VVX411", "SPA122", "T46S"],
      },
      { id: "prt_1_sub", name: "Acme Telecom Wholesale", status: "ACTIVE", parentId: FAKE_PARTITION_ID, country: "USA" },
    ],
    accounts: [
      {
        id: "acc_1",
        partitionId: FAKE_PARTITION_ID,
        accountNumber: "ACME-1001",
        accountName: "Acme Dental",
        status: "ACTIVE",
        accountType: "ADVANCED",
        platformType: "CPE2",
        timeZone: "US/Mountain",
        extensionLength: 4,
        dialingBehaviorType: "OPEN_DIAL_PLAN_TEN_DIGIT",
        billingCycleDay: 1,
        regulatoryType: "COMMERCIAL",
        routePlanId: "2ea93a62-2c44-4ab6-8fcb-a7b3c0b735e6",
        sendWelcomeEmail: true,
        endUserCount: 2,
        callingPlans: [
          {
            referenceId: "acc_1",
            referenceType: "ACCOUNT",
            callingPlanProductId: "cpp_unlimited",
            startDate: "2026-01-01T00:00:00Z",
            planMinutes: 20000,
            secondsRemaining: 1140000,
          },
        ],
      },
      {
        id: "acc_2",
        partitionId: FAKE_PARTITION_ID,
        accountNumber: "HOME-2002",
        accountName: "Bob Jones",
        status: "SUSPENDED",
        accountType: "SIMPLE",
        platformType: "CPE1",
        timeZone: "US/Pacific",
        dialingBehaviorType: "TEN_DIGIT",
        billingCycleDay: 15,
        regulatoryType: "RESIDENTIAL",
        endUserCount: 1,
        callingPlans: [],
      },
      {
        id: "acc_3",
        partitionId: FAKE_PARTITION_ID,
        accountNumber: "LINES-3003",
        accountName: "Lindon Bakery",
        status: "ACTIVE",
        accountType: "ADVANCED",
        platformType: "CPE2",
        timeZone: "US/Mountain",
        extensionLength: 4,
        dialingBehaviorType: "OPEN_DIAL_PLAN_TEN_DIGIT",
        billingCycleDay: 1,
        regulatoryType: "COMMERCIAL",
        endUserCount: 0,
        callingPlans: [],
      },
    ],
    users: [
      {
        id: "usr_1",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_1",
        username: "jane.doe",
        firstName: "Jane",
        lastName: "Doe",
        emailAddress: "jane@acmedental.example",
        extension: "1001",
        timeZone: "US/Mountain",
        endUserType: "SUPER_ADMIN",
        userProductPlan: "PROFESSIONAL",
        allowPortalAccess: true,
        blockEmail: false,
        mustChangePassword: false,
        pinLockedOut: false,
        voicemailBoxId: "vmb_1",
        welcomeEmailSent: "2026-02-14T12:46:46Z",
        callerIdConfig: { callerIdNumber: "18015551001", externalCallerIdVisible: true, extensionCallerIdVisible: true },
        callHandlingSettings: {
          callWaitingEnabled: true,
          doNotDisturbEnabled: false,
          callHandlingOptionType: "RingPhone",
          ringPhoneCallHandling: {
            busyCallHandling: { type: "Voicemail" },
            noAnswerCallHandling: { type: "Voicemail", timeout: 20 },
            unregisteredCallHandling: { type: "Forward", forwardToNumber: "18015559999" },
          },
        },
        callingPlans: [
          { referenceId: "usr_1", referenceType: "END_USER", callingPlanProductId: "cpp_unlimited", planMinutes: 20000, secondsRemaining: 1140000 },
        ],
        devices: [],
      },
      {
        id: "usr_2",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_1",
        username: "john.smith",
        firstName: "John",
        lastName: "Smith",
        emailAddress: "john@acmedental.example",
        extension: "1002",
        timeZone: "US/Mountain",
        endUserType: "STANDARD",
        userProductPlan: "STANDARD",
        allowPortalAccess: false,
        pinLockedOut: true,
        voicemailBoxId: "vmb_2",
        callerIdConfig: { callerIdNumber: "18015551001", externalCallerIdVisible: true, extensionCallerIdVisible: true },
        callHandlingSettings: {
          callWaitingEnabled: true,
          doNotDisturbEnabled: true,
          callHandlingOptionType: "ForwardAlways",
          forwardAlwaysToNumber: "18015557777",
        },
        callingPlans: [],
        devices: [],
      },
      {
        id: "usr_3",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_2",
        firstName: "Bob",
        lastName: "Jones",
        timeZone: "US/Pacific",
        allowPortalAccess: false,
        voicemailBoxId: "vmb_3",
        callerIdConfig: { callerIdNumber: "12135552002", externalCallerIdVisible: true, extensionCallerIdVisible: false },
        callingPlans: [],
        devices: [],
      },
    ],
    numbers: [
      {
        id: "18015551001",
        phoneNumber: "18015551001",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_1",
        referenceType: "END_USER",
        referenceId: "usr_1",
        functionType: "ELS",
        operationalStatus: "ACTIVE",
        carrierStatus: "ACTIVE",
        tollFree: false,
        canAcceptSMS: false,
        assignAsCallerId: true,
        customerServiceRecord: csrJane,
        e911Address: { ...csrJane, latitude: "40.332486", longitude: "-111.728156" },
        directoryListing: { listed: false, type: "NOT_LIST_NOT_PUBLISH" },
        tags: ["main-line"],
      },
      {
        id: "18015551002",
        phoneNumber: "18015551002",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_1",
        referenceType: "END_USER",
        referenceId: "usr_2",
        functionType: "ELS",
        operationalStatus: "STAGED",
        carrierStatus: "PORT_PENDING",
        portId: "port_77",
        tollFree: false,
        customerServiceRecord: csrJane,
        directoryListing: { type: "PORTED" },
      },
      {
        id: "12135552002",
        phoneNumber: "12135552002",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_2",
        referenceType: "END_USER",
        referenceId: "usr_3",
        functionType: "ELS",
        operationalStatus: "ACTIVE",
        carrierStatus: "ACTIVE",
        customerServiceRecord: {
          firstName: "Bob",
          lastName: "Jones",
          streetNumber: "100",
          streetName: "Main",
          streetSuffix: "St",
          city: "Los Angeles",
          state: "CA",
          country: "USA",
          postalCode: "90001",
          customerType: "RESIDENTIAL",
          customerName: "JONES BOB",
        },
        directoryListing: { listed: true, type: "LIST_PUBLISH" },
      },
      {
        id: "18015553001",
        phoneNumber: "18015553001",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_3",
        referenceType: "BUSINESS_LINE_HUNT_GROUP",
        referenceId: "hg_1",
        functionType: "ELS",
        operationalStatus: "ACTIVE",
        carrierStatus: "ACTIVE",
        customerServiceRecord: { businessName: "Lindon Bakery", streetNumber: "10", streetName: "Center", streetSuffix: "St", city: "Lindon", state: "UT", country: "USA", postalCode: "84042", customerType: "BUSINESS", customerName: "LINDON BAKERY" },
        directoryListing: { listed: false, type: "NOT_LIST_NOT_PUBLISH" },
      },
      {
        id: "18015553002",
        phoneNumber: "18015553002",
        partitionId: FAKE_PARTITION_ID,
        accountId: "acc_3",
        referenceType: "SIP_TRUNK",
        referenceId: "trk_1",
        functionType: "ELS",
        operationalStatus: "ACTIVE",
        carrierStatus: "ACTIVE",
        customerServiceRecord: { businessName: "Lindon Bakery", streetNumber: "10", streetName: "Center", streetSuffix: "St", city: "Lindon", state: "UT", country: "USA", postalCode: "84042", customerType: "BUSINESS", customerName: "LINDON BAKERY" },
        directoryListing: { listed: false, type: "NOT_LIST_NOT_PUBLISH" },
      },
    ],
    inventory: [
      { id: "18015550100", phoneNumber: "18015550100", partitionId: FAKE_PARTITION_ID, rateCenter: "LINDON", state: "UT", country: "USA", prefix: "1801555", carrierId: "car_1", functionType: "ELS", isInInventory: true, distance: 1.2, matchesZip: true, byotn: false },
      { id: "18015550101", phoneNumber: "18015550101", partitionId: FAKE_PARTITION_ID, rateCenter: "LINDON", state: "UT", country: "USA", prefix: "1801555", carrierId: "car_1", functionType: "ELS", isInInventory: true, distance: 1.2, matchesZip: true, byotn: false },
      { id: "18017690817", phoneNumber: "18017690817", partitionId: FAKE_PARTITION_ID, rateCenter: "PLEASANT GROVE", state: "UT", country: "USA", prefix: "1801769", carrierId: "car_1", functionType: "ELS", isInInventory: true, distance: 2.3, matchesZip: false, byotn: false },
      { id: "18885550199", phoneNumber: "18885550199", partitionId: FAKE_PARTITION_ID, rateCenter: "TOLLFREE", country: "USA", prefix: "1888555", carrierId: "car_2", functionType: "TollFree", isInInventory: true, byotn: false },
      { id: "18015550999", phoneNumber: "18015550999", partitionId: FAKE_PARTITION_ID, rateCenter: "LINDON", state: "UT", country: "USA", prefix: "1801555", carrierId: "car_1", functionType: "ELS", isInInventory: false, cooldownExpireDate: "2026-10-01T00:00:00Z", byotn: false },
    ],
    devices: [
      { id: "dev_1", partitionId: FAKE_PARTITION_ID, accountId: "acc_1", userId: "usr_1", deviceName: "Front desk", deviceTypeId: "VVX411", macAddress: "0004f2aabbcc", lineNumber: 1, lineType: "Line", emergencyNumber: "18015551001", faxEnabled: false, sipUsername: "dev_1" },
      { id: "dev_2", partitionId: FAKE_PARTITION_ID, accountId: "acc_1", userId: "usr_2", deviceName: "Office 2", deviceTypeId: "T46S", macAddress: "805ec0112233", lineNumber: 1, lineType: "Line", faxEnabled: false, sipUsername: "dev_2" },
      { id: "dev_3", partitionId: FAKE_PARTITION_ID, accountId: "acc_2", userId: "usr_3", deviceName: "ATA", deviceTypeId: "SPA122", macAddress: "c4e90a445566", lineNumber: 1, lineType: "Line", faxEnabled: false, sipUsername: "dev_3" },
    ],
    registrations: { dev_1: true, dev_2: false, dev_3: true },
    cdrs: {
      acc_1: [
        { id: "cdr_1", startTime: "2026-09-10T15:04:00Z", endTime: "2026-09-10T15:09:30Z", callType: "INBOUND", callFlagType: "ANSWERED", origNumber: "18015559876", dialedNumber: "18015551001", termNumber: "18015551001", actualCallLengthSeconds: 330, billCallLengthSeconds: 330, cost: 0, inPlan: true, disconnectType: "Hang", origCallCategory: "OffNet", origCityName: "Provo", origState: "UT" },
        { id: "cdr_2", startTime: "2026-09-10T18:30:00Z", endTime: "2026-09-10T18:30:20Z", callType: "INBOUND", callFlagType: "MISSED", origNumber: "12125550123", dialedNumber: "18015551002", termNumber: "18015551002", actualCallLengthSeconds: 0, billCallLengthSeconds: 0, cost: 0, inPlan: true, disconnectType: "NoAnswer", origCallCategory: "OffNet", origCityName: "New York", origState: "NY" },
        { id: "cdr_3", startTime: "2026-09-11T09:00:00Z", endTime: "2026-09-11T09:12:00Z", callType: "OUTBOUND", callFlagType: "ANSWERED", origNumber: "18015551001", dialedNumber: "14155550100", termNumber: "14155550100", actualCallLengthSeconds: 720, billCallLengthSeconds: 720, cost: 0.12, inPlan: false, disconnectType: "Hang", termCallCategory: "OffNet", termCityName: "San Francisco", termState: "CA" },
      ],
      acc_2: [],
    },
    history: {
      acc_1: [
        { id: "h_3", accountId: "acc_1", accountNumber: "ACME-1001", loggedDate: "2026-09-05T10:00:00Z", action: "UPDATE", accountHistoryType: "CALL_FORWARDING", referenceType: "EndUser", referenceId: "usr_2", referenceName: "John Smith", oldValue: "RingPhone", newValue: "ForwardAlways 18015557777", userName: "jane.doe", userType: "EndUser" },
        { id: "h_2", accountId: "acc_1", accountNumber: "ACME-1001", loggedDate: "2026-08-20T16:20:00Z", action: "PROVISION_REQUEST", accountHistoryType: "PHONE_NUMBER", referenceType: "Telephone", referenceId: "18015551002", referenceName: "18015551002", newValue: "PORT_PENDING", userName: "api@example.com", userType: "ManagementUser" },
        { id: "h_1", accountId: "acc_1", accountNumber: "ACME-1001", loggedDate: "2026-02-14T12:00:00Z", action: "CREATE", accountHistoryType: "ACCOUNT", referenceType: "Account", referenceId: "acc_1", referenceName: "Acme Dental", userName: "api@example.com", userType: "ManagementUser" },
      ],
      acc_2: [
        { id: "h_4", accountId: "acc_2", accountNumber: "HOME-2002", loggedDate: "2026-09-01T08:00:00Z", action: "UPDATE", accountHistoryType: "ACCOUNT_STATUS", referenceType: "Account", referenceId: "acc_2", referenceName: "Bob Jones", oldValue: "ACTIVE", newValue: "SUSPENDED", userName: "billing-bot", userType: "ManagementUser" },
      ],
    },
    voicemail: {
      usr_1: [
        { id: "vm_1", voicemailBoxId: "vmb_1", createdDate: "2026-09-12T14:02:00Z", fromNumber: "18015559876", fromName: "PROVO CLINIC", toPhoneNumber: "18015551001", lengthInSeconds: 42, read: false, messageType: "VOICE", transcriptionStatus: "COMPLETED", transcriptionText: "Hi Jane, this is Dr. Lee's office confirming your appointment for Thursday at ten." },
        { id: "vm_2", voicemailBoxId: "vmb_1", createdDate: "2026-09-09T11:30:00Z", fromNumber: "12125550123", toPhoneNumber: "18015551001", lengthInSeconds: 8, read: true, messageType: "VOICE" },
      ],
      usr_2: [],
      usr_3: [],
    },
    orders: [
      { id: "sae_1", partitionId: FAKE_PARTITION_ID, accountId: "acc_1", serviceType: "ACTIVATION", referenceType: "TELEPHONE", referenceId: "18015551001", activationStatusType: "COMPLETED", createdDate: "2026-02-14T13:00:00Z", lastUpdatedDate: "2026-02-14T13:05:00Z", mainTelephoneNumber: "18015551001", subTelephoneNumbers: ["18015551001"], companyName: "Acme Dental", inboundCarrierType: "BANDWIDTH", logs: [{ status: "PENDING", actionDate: "2026-02-14T13:00:00Z", code: "Activation", message: "Start" }, { status: "COMPLETED", actionDate: "2026-02-14T13:05:00Z", code: "Activation", message: "Activated" }] },
      { id: "sae_2", partitionId: FAKE_PARTITION_ID, accountId: "acc_1", serviceType: "PORT_REQUEST", referenceType: "PORT", referenceId: "port_77", activationStatusType: "FOC_RECEIVED", createdDate: "2026-08-20T16:20:00Z", lastUpdatedDate: "2026-08-22T17:24:00Z", focDate: "2026-09-20T07:00:00Z", crdDate: "2026-09-20T07:00:00Z", mainTelephoneNumber: "18015551002", subTelephoneNumbers: ["18015551002"], companyName: "Acme Dental", losingCarrier: "Lumen", inboundCarrierType: "BANDWIDTH", parentOrderId: "PON-12345", editableFieldTypes: ["crdDate"], logs: [{ status: "PENDING", actionDate: "2026-08-20T16:20:00Z", code: "Port", message: "Start Port" }, { status: "IN_PROGRESS", actionDate: "2026-08-20T16:25:00Z", code: "SUBMIT", message: "", generatedTicketId: "ALZREST.12345" }, { status: "FOC_RECEIVED", actionDate: "2026-08-22T17:24:00Z", code: "FOC", message: "FOC 2026-09-20" }] },
      { id: "sae_3", partitionId: FAKE_PARTITION_ID, accountId: "acc_2", serviceType: "PORT_REQUEST", referenceType: "PORT", referenceId: "port_78", activationStatusType: "REJECTED", createdDate: "2026-09-01T09:00:00Z", lastUpdatedDate: "2026-09-03T09:00:00Z", mainTelephoneNumber: "12135552003", subTelephoneNumbers: ["12135552003"], firstName: "Bob", lastName: "Jones", losingCarrier: "Verizon", inboundCarrierType: "BANDWIDTH", logs: [{ status: "PENDING", actionDate: "2026-09-01T09:00:00Z", code: "Port", message: "Start Port" }, { status: "REJECTED", actionDate: "2026-09-03T09:00:00Z", code: "REJECT", message: "Address mismatch: losing carrier has 100 Main St Apt 2" }] },
    ],
    reservations: {},
    businessLines: [
      { id: "bl_1", name: "Counter", accountId: "acc_3", partitionId: FAKE_PARTITION_ID, callerIdPhoneNumber: "18015553001", callerIdName: "LINDON BAKERY", callerIdVisible: true, emergencyCallbackPhoneNumber: "18015553001" },
      { id: "bl_2", name: "Kitchen", accountId: "acc_3", partitionId: FAKE_PARTITION_ID, callerIdPhoneNumber: "18015553001", callerIdName: "LINDON BAKERY", callerIdVisible: true, emergencyCallbackPhoneNumber: "18015553001" },
    ],
    lineCallHandling: {
      bl_1: {
        activeCallHandling: "RING_LINE",
        callWaitingEnabled: true,
        busyFailoverAction: { "@type": "VoicemailRingFailoverAction" },
        unregisteredFailoverAction: { "@type": "ForwardRingFailoverAction", forwardToPhoneNumber: "18015559999" },
        ringTimeoutConfiguration: { "@type": "LimitedRingTimeoutConfiguration", timeoutSeconds: 25, noAnswerAction: { "@type": "VoicemailRingFailoverAction" } },
        voicemailBoxId: "blvm_1",
      },
      bl_2: {
        activeCallHandling: "FORWARD",
        forwardToPhoneNumber: "18015558888",
        callWaitingEnabled: false,
        busyFailoverAction: { "@type": "BusyRingFailoverAction" },
        unregisteredFailoverAction: { "@type": "BusyRingFailoverAction" },
        ringTimeoutConfiguration: { "@type": "UnlimitedRingTimeoutConfiguration" },
      },
    },
    linePorts: {
      bl_1: { businessLineId: "bl_1", deviceTypeId: "SPA122", macAddress: "c4e90a778899", portNumber: 1, faxEnabled: false },
    },
    lineRegistrations: { bl_1: { registered: true, lockedOut: false }, bl_2: { registered: false, lockedOut: false } },
    huntGroups: [
      {
        id: "hg_1",
        name: "Bakery ring group",
        accountId: "acc_3",
        partitionId: FAKE_PARTITION_ID,
        huntingConfiguration: { "@type": "SimultaneousHuntingConfiguration", ringTimeoutSeconds: 30, members: ["bl_1", "bl_2"] },
      },
    ],
    huntGroupFailover: {
      hg_1: {
        BUSY: { "@type": "BusyFailoverAction", failoverReason: "BUSY" },
        NO_ANSWER: { "@type": "VoicemailFailoverAction", failoverReason: "NO_ANSWER", voicemailBoxId: "blvm_1" },
        UNREGISTERED: { "@type": "ForwardFailoverAction", failoverReason: "UNREGISTERED", forwardToPhoneNumber: "18015559999" },
      },
    },
    sipTrunks: [
      {
        id: "trk_1",
        accountId: "acc_3",
        partitionId: FAKE_PARTITION_ID,
        trunkName: "Bakery PBX",
        sipUsername: "lindon-bakery-pbx",
        sipPassword: "s3cret-never-shown",
        concurrentCalls: 10,
        maxBurstCalls: 12,
        primaryTn: "18015553002",
        callbackNumber: "18015553002",
        telephoneNumbers: ["18015553002"],
        sipProxyServer: "sip.alianza.example",
        lockedOut: false,
        localServicesEnabled: true,
        extensionPatterns: ["21XX"],
        provisioningStatus: "PROVISIONED",
        ipBasedAuthEnabled: false,
        callingPlans: [{ referenceId: "trk_1", referenceType: "SIP_TRUNK", callingPlanProductId: "cpp_unlimited", planMinutes: 20000, secondsRemaining: 600000 }],
      },
    ],
    sipTrunkRegistrations: { trk_1: true },
    sipTrunkForward: {
      trk_1: {
        sipTrunkId: "trk_1",
        forwardAlways: { referenceType: "TELEPHONE", referenceId: "18015559999", enabled: false },
        forwardOnFailure: [{ referenceType: "TELEPHONE", referenceId: "18015557777" }],
        forwardOnCapacityExceeded: [{ referenceType: "BUSY" }],
      },
    },
  };
}
