import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import type { Config } from "../config.js";

export interface ToolContext {
  api: ApiClient;
  auth: AuthManager;
  config: Config;
}

/** Resolve the experience id from the argument or the configured default. */
export function resolveExperienceId(ctx: ToolContext, given?: string): string {
  const id = given || ctx.config.experienceId;
  if (!id) {
    throw new MissingInputError(
      "No experience id: pass experience_id or set ALIANZA_EXPERIENCE_ID for this server.",
    );
  }
  return id;
}

export class MissingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingInputError";
  }
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
