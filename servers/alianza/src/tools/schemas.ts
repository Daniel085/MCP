/** Shared Zod pieces so every tool describes ids, targets, and paging the same way. */
import { z } from "zod";

export const EXAMPLE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const EXAMPLE_E164 = "+14155551234";

/**
 * Alianza documents ids as UUIDs (RFC 4122). This pattern accepts any hex
 * UUID shape rather than Zod's strict version/variant check, so a legitimate
 * id is never rejected before the tool runs.
 */
export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `UUID, e.g. ${EXAMPLE_UUID}`);
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, `E.164 phone number, e.g. ${EXAMPLE_E164}`);
export const targetType = z.enum(["ACCOUNT", "PHONE_NUMBER", "USER"]);
export const settableState = z.enum(["ACTIVE", "INACTIVE"]);
export const anyState = z.enum(["ACTIVE", "INACTIVE", "CONNECTED"]);

export const idInput = (what: string) => uuid.describe(`${what} id (UUID), e.g. ${EXAMPLE_UUID}`);
export const phoneInput = (what: string) => e164.describe(`${what}, E.164 format, e.g. ${EXAMPLE_E164}`);

export const experienceIdInput = uuid
  .optional()
  .describe(`Experience id (UUID), e.g. ${EXAMPLE_UUID}. Omit to use the server's configured ALIANZA_EXPERIENCE_ID.`);

export const targetValueDescription = `Target value in the format for its type: PHONE_NUMBER is E.164 (e.g. ${EXAMPLE_E164}); ACCOUNT and USER are UUIDs (e.g. ${EXAMPLE_UUID}).`;

export const pageSizeInput = (max: number) =>
  z.number().int().min(1).max(max).default(50).describe(`Results per page, 1 to ${max}. Default 50.`);
export const cursorInput = z
  .string()
  .optional()
  .describe("Opaque cursor from a previous page's response. Omit for the first page. Keep the other filters identical while paging.");

export const assignmentShape = {
  id: z.string(),
  experienceId: z.string(),
  accountId: z.string(),
  targetType,
  targetValue: z.string(),
  updatedAt: z.string(),
};

export const connectionShape = {
  id: z.string(),
  accountId: z.string(),
  accountName: z.string().optional(),
  experienceId: z.string(),
  state: anyState,
  updatedAt: z.string(),
};

export const userShape = {
  id: z.string(),
  accountId: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
};

export const pageShape = { cursor: z.string().nullable(), pageSize: z.number().int() };
export const deletedShape = { id: z.string(), deleted: z.boolean() };

/** Validate a target value against its type before any HTTP call. */
export function validateTarget(type: z.infer<typeof targetType>, value: string): string | null {
  if (type === "PHONE_NUMBER") {
    return e164.safeParse(value).success ? null : `PHONE_NUMBER target must be E.164, e.g. ${EXAMPLE_E164}`;
  }
  return uuid.safeParse(value).success ? null : `${type} target must be a UUID, e.g. ${EXAMPLE_UUID}`;
}

export function pagingHint(cursor: string | null, cursorArg: string): string {
  return cursor ? `\nMore results: call again with ${cursorArg}="${cursor}".` : "";
}
