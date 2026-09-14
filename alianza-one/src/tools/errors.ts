/**
 * Shared error handling for tools. Upstream failures become isError results
 * with text the model can act on; anything else is a bug and propagates.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "../api-client.js";
import { log } from "../log.js";

/** Convert an upstream failure into text the model can act on. */
export function apiErrorToText(err: ApiError): string {
  switch (err.status) {
    case 0:
      return `The Alianza API could not be reached (${err.message}). Try again shortly.`;
    case 401:
      return "Authentication with Alianza failed. Check ALIANZA_USERNAME/ALIANZA_PASSWORD (or ALIANZA_AUTH_TOKEN) configured for this server.";
    case 403:
      return `The Alianza user configured for this server is not permitted to do this (${err.message}). Ask an Alianza admin to grant the permission.`;
    case 404:
      return `Not found: ${err.message}. Check the partition, account, and identifiers.`;
    case 400:
    case 422:
      return `Alianza rejected the request: ${err.message}`;
    case 409:
      return `Conflict: ${err.message}`;
    case 429:
      return `Rate limited by Alianza. Retry after ${err.retryAfterSeconds ?? 30} seconds.`;
    default:
      return err.status >= 500
        ? `The Alianza API is unavailable (HTTP ${err.status}). Try again shortly.`
        : `Alianza API error (HTTP ${err.status}): ${err.message}`;
  }
}

/** A tool-level validation failure the model can fix by changing its arguments. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * Run a tool body. ApiError and ToolInputError become isError results;
 * anything else is a bug and is rethrown so the SDK reports it and it shows
 * up in logs.
 */
export async function withErrorHandling(
  toolName: string,
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn("tool returned error", { tool: toolName, status: err.status, message: err.message });
      return { content: [{ type: "text", text: apiErrorToText(err) }], isError: true };
    }
    if (err instanceof ToolInputError) {
      log.warn("tool rejected input", { tool: toolName, message: err.message });
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    log.error("tool crashed", { tool: toolName, error: String(err) });
    throw err;
  }
}
