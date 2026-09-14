/**
 * Input fragments and formatting helpers shared by every tool group.
 */
import { z } from "zod";
import type { Address, CallingPlan } from "../alianza-types.js";
import { ToolInputError } from "./errors.js";

export const partitionIdInput = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Partition to act in. Omit to use the server's default partition (ALIANZA_PARTITION_ID, or the partition of the configured login). " +
      "Only set this when working in a sub-partition; alianza_get_partition lists them.",
  );

export const accountIdInput = z
  .string()
  .min(1)
  .describe(
    "Alianza account id (the opaque `id` field, e.g. WL84q5lBTumKvm_Ait_hZA), not the account number. " +
      "Resolve an account number or phone number with alianza_get_account first.",
  );

export const userIdInput = z
  .string()
  .min(1)
  .describe("End user id (the opaque `id` field from alianza_list_users, e.g. Nyaqv4uxQAKFr_wt_KPmFw).");

export const phoneNumberInput = z
  .string()
  .min(10)
  .describe("North American phone number. 11 digits with country code preferred (18015551212); 10 digits are accepted.");

export const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD format.");

/**
 * Normalise a phone number to Alianza's 11-digit, leading-1 format.
 * Accepts formatted input such as "(801) 555-1212" or "+1 801 555 1212".
 */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const tn = digits.length === 10 ? `1${digits}` : digits;
  if (!/^1\d{10}$/.test(tn)) {
    throw new ToolInputError(
      `"${raw}" is not a valid North American phone number. Use 11 digits including the leading 1, e.g. 18015551212.`,
    );
  }
  return tn;
}

/** Normalise a MAC address to 12 lowercase hex characters, as Alianza stores it. */
export function normalizeMacAddress(raw: string): string {
  const mac = raw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (mac.length !== 12) {
    throw new ToolInputError(`"${raw}" is not a valid MAC address. Use 12 hex characters, e.g. 0004f2aabbcc.`);
  }
  return mac;
}

/** Render an address on one line for text output. */
export function formatAddress(a: Address | undefined): string | undefined {
  if (!a) return undefined;
  const street = [a.streetNumber, a.streetNumberSuffix, a.preDirectional, a.streetName, a.streetSuffix, a.postDirectional]
    .filter(Boolean)
    .join(" ");
  const unit = a.unit ? `${a.secondaryLocationDescription ?? "Unit"} ${a.unit}` : undefined;
  const locality = [a.city, a.state, a.postalCode].filter(Boolean).join(" ");
  const line = [street, unit, locality, a.country].filter(Boolean).join(", ");
  return line || undefined;
}

export function summarizeCallingPlans(plans: CallingPlan[] | undefined) {
  return (plans ?? []).map((p) => ({
    callingPlanProductId: p.callingPlanProductId,
    planMinutes: p.planMinutes,
    minutesRemaining: p.secondsRemaining === undefined ? undefined : Math.round(p.secondsRemaining / 60),
    startDate: p.startDate,
    endDate: p.endDate,
  }));
}

/** Page an array the API returned in full, with a hint for the next page. */
export function pageArray<T>(items: T[], limit: number, offset: number): { page: T[]; text: string } {
  const page = items.slice(offset, offset + limit);
  const shown = offset + page.length;
  if (items.length === 0) return { page, text: "No results." };
  const more = shown < items.length ? ` Pass offset=${shown} for the next page.` : "";
  return { page, text: `Showing ${offset + 1}-${shown} of ${items.length}.${more}` };
}

/** Same hint for APIs that page server-side and report a total. */
export function pageHint(count: number, total: number | undefined, offset: number): string {
  if (count === 0) return "No results.";
  const shown = offset + count;
  const totalText = total === undefined ? `${shown}+` : String(total);
  const more = total !== undefined && shown < total ? ` Pass offset=${shown} for the next page.` : "";
  return `Showing ${offset + 1}-${shown} of ${totalText}.${more}`;
}

/** Drop undefined values so structuredContent and JSON text stay tidy. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
