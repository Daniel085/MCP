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
      return `The upstream API could not be reached (${err.message}). Try again shortly.`;
    case 401:
    case 403:
      return "Authentication with the upstream API failed. Check the API credentials configured for this server.";
    case 404:
      return `Not found: ${err.message}`;
    case 400:
    case 422:
      return `The API rejected the request: ${err.message}`;
    case 429:
      return `Rate limited by the upstream API. Retry after ${err.retryAfterSeconds ?? 30} seconds.`;
    default:
      return err.status >= 500
        ? `The upstream API is unavailable (HTTP ${err.status}). Try again shortly.`
        : `Upstream API error (HTTP ${err.status}): ${err.message}`;
  }
}

/**
 * Run a tool body. ApiError becomes an isError result; anything else is a bug
 * and is rethrown so the SDK reports it and it shows up in logs.
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
    log.error("tool crashed", { tool: toolName, error: String(err) });
    throw err;
  }
}
