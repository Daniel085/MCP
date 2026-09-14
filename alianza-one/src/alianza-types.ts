/**
 * Subset of the Alianza Public API v2 schemas that this server reads or
 * writes. Field names match the OpenAPI spec; only the fields the tools use
 * are declared, everything else is passed through untyped.
 */

export type AccountStatus = "ACTIVE" | "DISABLED" | "DELETED" | "DELETE_PENDING" | "SUSPENDED" | "PENDING";
export type AccountType = "SIMPLE" | "ADVANCED";
export type PlatformType = "V2_0" | "V2_1" | "CPE1" | "CPE2";

export const TIME_ZONES = [
  "US/Samoa",
  "US/Hawaii",
  "US/Alaska",
  "US/Pacific",
  "US/Arizona",
  "US/Mountain",
  "US/Central",
  "US/Eastern",
  "America/St_Thomas",
  "Canada/Pacific",
  "Canada/Mountain",
  "Canada/Central",
  "Canada/Eastern",
  "Canada/Atlantic",
  "Canada/Newfoundland",
] as const;
export type TimeZone = (typeof TIME_ZONES)[number];

export const DIALING_BEHAVIORS = [
  "SEVEN_DIGIT",
  "TEN_DIGIT",
  "OPEN_DIAL_PLAN",
  "DIAL_NINE_SEVEN_DIGIT",
  "DIAL_NINE_TEN_DIGIT",
  "OPEN_DIAL_PLAN_TEN_DIGIT",
] as const;

export const REFERENCE_TYPES = [
  "END_USER",
  "SIP_TRUNK",
  "IVR",
  "VFAX",
  "BUSINESS_LINE",
  "BUSINESS_LINE_HUNT_GROUP",
  "AUTO_ATTENDANT",
  "CONTACT_CENTER",
  "CALL_GROUP",
  "CALL_QUEUE",
  "SPECIALTY_LINE",
  "LINE_APPEARANCE",
  "LINE_HUNTGROUP",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const ACTIVATION_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "REJECTED",
  "FOC_RECEIVED",
  "FOC_REMOVED",
  "CANCELLED",
  "CANCEL_PENDING",
  "CARRIER_CANCELLED",
  "DELETE_PENDING",
  "DELETE_SCHEDULED",
  "COMPLETED",
  "CORRECTED_COMPLETED",
  "COOLDOWN",
  "HOT_CUT_PORT",
  "ON_HOLD",
  "RESELLER_PENDING",
] as const;

export const ACTIVATION_EVENT_TYPES = [
  "ACTIVATION",
  "PORT_REQUEST",
  "DISCONNECT",
  "CSR_CHANGE_REQUEST",
  "NINE_ONE_ONE_ADDRESS",
  "DYNAMIC_RESERVATION",
  "BYOTN_REQUEST",
  "SERVICE_PROVIDER_TN",
] as const;

export const ACCOUNT_HISTORY_TYPES = [
  "ACCOUNT",
  "ACCOUNT_STATUS",
  "ACCOUNT_USER",
  "USER",
  "PHONE_NUMBER",
  "PROVISIONING",
  "DEVICE",
  "DEVICE_METADATA",
  "USER_DEVICE_LINE",
  "CALL_FORWARDING",
  "CALL_SCREENING",
  "ADDRESS",
  "ADDRESS_CSR",
  "ADDRESS_E911",
  "ADDRESS_DIRECTORY_LISTING",
  "VOICEMAIL",
  "CALLING_PLAN",
  "INBOUND_CALLING_PLAN",
  "IVR",
  "AUTO_ATTENDANT",
  "SIP_TRUNK",
  "SIP_TRUNK_GROUP",
  "SIP_CREDENTIALS",
  "BUSINESS_LINE",
  "BUSINESS_LINE_HUNT_GROUP",
  "CALL_GROUP",
  "CALL_QUEUE",
  "CALL_PARKING_SPOT",
  "PAGING_GROUP",
  "PICKUP_GROUP",
  "VFAX",
  "EMERGENCY_NOTIFICATION",
  "DYNAMIC_RESERVATION",
  "SPECIALTY_LINE",
  "CONTACT_CENTER",
  "CALL_RECORDING",
  "USER_GROUP",
] as const;

export const DIRECTIONALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export const SECONDARY_LOCATION_TYPES = [
  "APARTMENT",
  "BUILDING",
  "BASEMENT",
  "DEPARTMENT",
  "FLOOR",
  "FRONT",
  "HANGER",
  "KEY",
  "LOBBY",
  "LOT",
  "LOWER",
  "OFFICE",
  "PENTHOUSE",
  "PIER",
  "REAR",
  "ROOM",
  "SIDE",
  "SLIP",
  "SPACE",
  "SUITE",
  "STOP",
  "TRAILER",
  "UNIT",
  "UPPER",
] as const;

export interface LoginInfo {
  authToken: string;
  userId?: string;
  userType?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  partitionId?: string;
  partitionName?: string;
  accountId?: string;
  subPartitionIds?: string[];
  permissions?: Record<string, string>;
  maxLifeInHours?: number;
}

export interface Partition {
  id: string;
  name?: string;
  status?: "ACTIVE" | "ARCHIVED" | "HIDDEN";
  parentId?: string;
  country?: string;
  customerServiceNumber?: string;
  defaultTimeZone?: TimeZone;
  subPartitionIds?: string[];
  tnDeleteCooldownDays?: number;
  requiresDeviceInventory?: boolean;
  allowedDeviceTypes?: string[];
  defaultExtensionLength?: number;
  defaultSimpleDialingBehaviorType?: string;
  defaultAdvancedDialingBehaviorType?: string;
  useOwnCarrier?: boolean;
}

export interface AccountSearchHit {
  partitionId?: string;
  id: string;
  accountNumber?: string;
  accountName?: string;
  type?: AccountType;
  accountStatus?: AccountStatus;
  platformType?: PlatformType;
  matches?: Record<string, string>;
}

export interface CallingPlan {
  id?: string;
  referenceId?: string;
  referenceType?: string;
  callingPlanProductId?: string;
  startDate?: string;
  endDate?: string;
  planMinutes?: number;
  secondsRemaining?: number;
}

export interface Account {
  id: string;
  partitionId?: string;
  accountNumber: string;
  accountName: string;
  billingCycleDay?: number;
  customField?: string;
  status?: AccountStatus;
  timeZone?: TimeZone;
  accountType?: AccountType;
  platformType?: PlatformType;
  extensionLength?: number;
  dialingBehaviorType?: string;
  routePlanId?: string;
  regulatoryType?: "RESIDENTIAL" | "COMMERCIAL" | "GOVERNMENT";
  sendWelcomeEmail?: boolean;
  endUserCount?: number;
  callingPlans?: CallingPlan[];
  holdTimeoutSeconds?: number;
  languageTag?: string;
}

export interface CallHandling {
  type?: "Forward" | "Voicemail" | "Busy" | "RingForever";
  timeout?: number;
  forwardToNumber?: string;
}

export interface EndUser {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  partitionId?: string;
  accountId?: string;
  extension?: string;
  timeZone?: TimeZone;
  endUserType?: "ADMIN" | "ADVANCED_ADMIN" | "BASIC_ADMIN" | "STANDARD" | "STANDARD_ADMIN" | "SUPER_ADMIN";
  userProductPlan?: "STANDARD" | "ADVANCED" | "PROFESSIONAL";
  allowPortalAccess?: boolean;
  blockEmail?: boolean;
  mustChangePassword?: boolean;
  pinLockedOut?: boolean;
  voicemailBoxId?: string;
  welcomeEmailSent?: string;
  languageTag?: string;
  callerIdConfig?: {
    callerIdNumber?: string;
    callerIdName?: string;
    externalCallerIdVisible?: boolean;
    extensionCallerIdVisible?: boolean;
  };
  callHandlingSettings?: {
    callWaitingEnabled?: boolean;
    doNotDisturbEnabled?: boolean;
    callHandlingOptionType?: "RingPhone" | "ForwardAlways" | "SimultaneousRing" | "FindMeFollowMe";
    forwardAlwaysToNumber?: string;
    ringPhoneCallHandling?: {
      busyCallHandling?: CallHandling;
      noAnswerCallHandling?: CallHandling;
      unregisteredCallHandling?: CallHandling;
    };
  };
  callingPlans?: CallingPlan[];
  devices?: Device[];
}

export interface Device {
  id: string;
  deviceTypeId?: string;
  accountId?: string;
  partitionId?: string;
  macAddress?: string;
  deviceName?: string;
  emergencyNumber?: string;
  faxEnabled?: boolean;
  lineNumber?: number;
  userId?: string;
  sipUsername?: string;
  lineType?: string;
  referenceId?: string;
}

export interface DeviceRegistrationStatus {
  registered?: boolean;
}

export interface Address {
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  businessName?: string;
  streetNumber?: string;
  streetNumberSuffix?: string;
  preDirectional?: string;
  streetName?: string;
  streetSuffix?: string;
  postDirectional?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  secondaryLocationDescription?: string;
  unit?: string;
}

export interface CustomerServiceRecord extends Address {
  customerType?: "BUSINESS" | "RESIDENTIAL";
  customerName?: string;
  blockCustomerName?: boolean;
}

export interface E911Address extends Address {
  customerType?: "BUSINESS" | "RESIDENTIAL";
  latitude?: string;
  longitude?: string;
}

export interface DirectoryListing {
  listed?: boolean;
  type?: "LIST_PUBLISH" | "LIST_NOT_PUBLISH" | "NOT_LIST_NOT_PUBLISH" | "PORTED" | "COMPLEX" | "ERROR";
  address?: Address;
}

export interface PhoneNumberOnAccount {
  id?: string;
  phoneNumber: string;
  partitionId?: string;
  accountId?: string;
  referenceType?: ReferenceType | "TELEPHONE";
  referenceId?: string;
  functionType?: "ELS" | "TollFree" | "TemporaryNumber" | "SPTN";
  operationalStatus?: "ACTIVE" | "STAGED";
  carrierStatus?: string;
  portId?: string;
  tollFree?: boolean;
  canAcceptSMS?: boolean;
  assignAsCallerId?: boolean;
  customerServiceRecord?: CustomerServiceRecord;
  e911Address?: E911Address;
  directoryListing?: DirectoryListing;
  tags?: string[];
}

export interface TelephoneNumberActivation {
  id?: string;
  partitionId?: string;
  accountId?: string;
  customerServiceRecord?: CustomerServiceRecord;
  directoryListing?: DirectoryListing;
  e911Address?: E911Address;
  holdActivation?: boolean;
  telephoneNumbers?: Array<{
    phoneNumber: string;
    referenceType?: ReferenceType;
    referenceId?: string;
    functionType?: string;
    portId?: string;
    id?: string;
    tollFree?: boolean;
  }>;
}

export interface PhoneNumberDestination {
  id?: string;
  partitionId?: string;
  accountId?: string;
  telephoneNumber: string;
  referenceType?: ReferenceType;
  referenceId?: string;
  assignAsCallerId?: boolean;
  ringType?: string;
}

export interface InventoryNumber {
  id?: string;
  partitionId?: string;
  phoneNumber: string;
  rateCenter?: string;
  rateCenterReorderName?: string;
  state?: string;
  country?: string;
  prefix?: string;
  accountId?: string;
  carrierId?: string;
  cooldownExpireDate?: string;
  functionType?: string;
  matchesZip?: boolean;
  distance?: number;
  byotn?: boolean;
  activationDate?: number;
  isInInventory?: boolean;
  operationalStatus?: "ACTIVE" | "STAGED";
  port?: boolean;
  tags?: string[];
}

export interface TelephoneNumberReservation {
  id?: string;
  tn?: string;
  reserved?: boolean;
  reservedTime?: string;
}

export interface ServiceActivationEventLog {
  status?: string;
  actionDate?: string;
  code?: string;
  message?: string;
  generatedTicketId?: string;
}

export interface ServiceActivationEvent {
  id: string;
  partitionId?: string;
  accountId?: string;
  serviceType?: string;
  referenceType?: string;
  referenceId?: string;
  activationStatusType?: string;
  createdDate?: string;
  lastUpdatedDate?: string;
  focDate?: string;
  crdDate?: string;
  mainTelephoneNumber?: string;
  subTelephoneNumbers?: string[];
  firstName?: string;
  lastName?: string;
  companyName?: string;
  losingCarrier?: string;
  inboundCarrierType?: string;
  parentOrderId?: string;
  editableFieldTypes?: string[];
  logs?: ServiceActivationEventLog[];
}

export interface ServiceActivationEventResponse {
  totalRecords?: number;
  results?: ServiceActivationEvent[];
}

export interface CallDetailRecord {
  id?: string;
  startTime?: string;
  connectTime?: string;
  endTime?: string;
  actualCallLengthSeconds?: number;
  billCallLengthSeconds?: number;
  cost?: number;
  inPlan?: boolean;
  dialedNumber?: string;
  origNumber?: string;
  termNumber?: string;
  forwardingNumber?: string;
  callType?: "INBOUND" | "OUTBOUND";
  callFlagType?: string;
  disconnectType?: string;
  origCallCategory?: string;
  termCallCategory?: string;
  origCityName?: string;
  origState?: string;
  termCityName?: string;
  termState?: string;
}

export interface CdrSearchResponse {
  totalRecords?: number;
  results?: CallDetailRecord[];
}

export interface AccountHistoryRecord {
  id?: string;
  accountId?: string;
  accountNumber?: string;
  oldValue?: string;
  newValue?: string;
  userName?: string;
  userId?: string;
  userType?: string;
  accountHistoryType?: string;
  loggedDate?: string;
  referenceType?: string;
  referenceId?: string;
  referenceName?: string;
  action?: "CREATE" | "UPDATE" | "PROVISION_REQUEST" | "DELETE";
}

export interface AccountHistorySearchResponse {
  totalRecords?: number;
  accountCreatedDate?: string;
  accountLastUpdatedDate?: string;
  results?: AccountHistoryRecord[];
}

export interface VoicemailMessage {
  id: string;
  createdDate?: string;
  fromName?: string;
  fromNumber?: string;
  toPhoneNumber?: string;
  lengthInSeconds?: number;
  lengthInPages?: number;
  read?: boolean;
  messageType?: "FAX" | "VOICE";
  voicemailBoxId?: string;
  transcriptionStatus?: string;
  transcriptionText?: string;
}

export interface AddressValidation {
  requiredFields?: string[];
  customerServiceRecord?: CustomerServiceRecord;
  latitude?: string;
  longitude?: string;
  valid?: boolean;
}

// ---- Business Lines ---------------------------------------------------------

export interface BusinessLine {
  id: string;
  name: string;
  accountId?: string;
  partitionId?: string;
  callerIdPhoneNumber?: string;
  callerIdName?: string;
  callerIdVisible?: boolean;
  emergencyCallbackPhoneNumber?: string;
}

export type RingFailoverAction =
  | { "@type": "BusyRingFailoverAction" }
  | { "@type": "VoicemailRingFailoverAction" }
  | { "@type": "ForwardRingFailoverAction"; forwardToPhoneNumber: string };

export type RingTimeoutConfiguration =
  | { "@type": "UnlimitedRingTimeoutConfiguration" }
  | { "@type": "LimitedRingTimeoutConfiguration"; timeoutSeconds?: number; noAnswerAction: RingFailoverAction };

export interface BusinessLineCallHandling {
  activeCallHandling: "RING_LINE" | "FORWARD";
  callWaitingEnabled?: boolean;
  busyFailoverAction: RingFailoverAction;
  unregisteredFailoverAction: RingFailoverAction;
  ringTimeoutConfiguration: RingTimeoutConfiguration;
  forwardToPhoneNumber?: string;
  voicemailBoxId?: string;
}

export interface BusinessLinePortAssignment {
  businessLineId?: string;
  deviceTypeId: string;
  macAddress?: string;
  portNumber?: number;
  faxEnabled?: boolean;
}

export interface BusinessLineExpanded extends BusinessLine {
  cname?: string;
  callHandling?: BusinessLineCallHandling;
  sipCredentials?: { sipUsername?: string };
  device?: BusinessLinePortAssignment;
}

export interface LineRegistrationStatus {
  registered?: boolean;
  lockedOut?: boolean;
}

// ---- Business Line Hunt Groups ----------------------------------------------

export type HuntingConfiguration =
  | {
      "@type": "LinearHuntingConfiguration";
      ringTimeoutSeconds: number;
      members: Array<{ businessLineId: string; sequenceOrder: number }>;
    }
  | {
      "@type": "SequentialHuntingConfiguration";
      members: Array<{ businessLineId: string; sequenceOrder: number; ringTimeoutSeconds: number }>;
    }
  | { "@type": "SimultaneousHuntingConfiguration"; ringTimeoutSeconds: number; members: string[] };

export interface HuntGroup {
  id: string;
  name: string;
  partitionId?: string;
  accountId?: string;
  huntingConfiguration: HuntingConfiguration;
  activeForwardConfigurationId?: string;
}

export type HuntGroupFailoverReason = "BUSY" | "NO_ANSWER" | "UNREGISTERED";

export type HuntGroupFailoverAction =
  | { "@type": "BusyFailoverAction"; failoverReason: HuntGroupFailoverReason }
  | { "@type": "ForwardFailoverAction"; failoverReason: HuntGroupFailoverReason; forwardToPhoneNumber: string }
  | { "@type": "VoicemailFailoverAction"; failoverReason: HuntGroupFailoverReason; voicemailBoxId: string };

// ---- SIP Trunks -------------------------------------------------------------

export interface SipTrunk {
  id: string;
  partitionId?: string;
  accountId?: string;
  trunkName: string;
  sipUsername?: string;
  sipPassword?: string;
  callbackNumber?: string;
  concurrentCalls?: number;
  maxBurstCalls?: number;
  callingPlans?: CallingPlan[];
  telephoneNumbers?: string[];
  sipProxyServer?: string;
  lockedOut?: boolean;
  localServicesEnabled?: boolean;
  primaryTn?: string;
  extensionPatterns?: string[];
  provisioningStatus?: string;
  ipBasedAuthEnabled?: boolean;
  ipAddress?: string;
  portNumber?: number;
  sipTrunkGroupId?: string;
  pbxTnDigits?: number;
}

export interface SipTrunkForwardReference {
  referenceType: "SIP_TRUNK" | "END_USER" | "TELEPHONE" | "AUTO_ATTENDANT" | "IVR" | "BUSY" | "VOICE_MAIL";
  referenceId?: string;
  enabled?: boolean;
}

export interface SipTrunkForwardRules {
  sipTrunkId?: string;
  forwardAlways?: SipTrunkForwardReference;
  forwardOnFailure?: SipTrunkForwardReference[];
  forwardOnCapacityExceeded?: SipTrunkForwardReference[];
}
