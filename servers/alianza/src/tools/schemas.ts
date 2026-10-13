/** Shared Zod pieces so every tool describes ids and targets the same way. */
import { z } from "zod";

export const uuid = z.string().uuid();
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164 phone number, e.g. +14155551234");
export const targetType = z.enum(["ACCOUNT", "PHONE_NUMBER", "USER"]);
export const settableState = z.enum(["ACTIVE", "INACTIVE"]);
export const anyState = z.enum(["ACTIVE", "INACTIVE", "CONNECTED"]);

export const experienceIdInput = z
  .string()
  .uuid()
  .optional()
  .describe("Experience id (UUID). Omit to use the server's configured ALIANZA_EXPERIENCE_ID.");

export const targetValueDescription =
  "Target value in the format for its type: PHONE_NUMBER is E.164 (+14155551234); ACCOUNT and USER are UUIDs.";

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

/** Validate a target value against its type before any HTTP call. */
export function validateTarget(type: z.infer<typeof targetType>, value: string): string | null {
  if (type === "PHONE_NUMBER") return e164.safeParse(value).success ? null : "PHONE_NUMBER target must be E.164, e.g. +14155551234";
  return uuid.safeParse(value).success ? null : `${type} target must be a UUID`;
}

export function pagingHint(cursor: string | null, cursorArg: string): string {
  return cursor ? `\nMore results: call again with ${cursorArg}="${cursor}".` : "";
}
