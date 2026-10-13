/**
 * Shared error handling for tools. Upstream failures become isError results
 * with text the model can act on; anything else is a bug and propagates.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, AuthError } from "../api-client.js";
import { log } from "../log.js";
import { usage } from "../usage.js";
import { MissingInputError } from "./context.js";

const SCOPE_BY_PATH: Array<[RegExp, string]> = [
  [/assignability/, "experience-assignability:check"],
  [/\/experience\/assignments/, "experience-assignments:manage"],
  [/\/experience\/connections/, "experience-connections:manage"],
  [/\/users/, "users:manage"],
];

export function apiErrorToText(err: ApiError, context?: { path?: string }): string {
  const trace = err.details.traceId ? ` (traceId ${err.details.traceId})` : "";
  const fieldErrors = err.details.errors?.length
    ? "\n" + err.details.errors.map((e) => `- ${e.field ?? "field"}: ${e.message ?? JSON.stringify(e)}`).join("\n")
    : "";
  switch (err.status) {
    case 0:
      return `The Alianza API could not be reached (${err.message}). Try again shortly.`;
    case 401:
      return `Alianza rejected the token even after refreshing it. Run \`alianza-mcp login\` again.${trace}`;
    case 403: {
      const scope = SCOPE_BY_PATH.find(([re]) => re.test(context?.path ?? ""))?.[1];
      return scope
        ? `The token lacks the \`${scope}\` scope required for this operation. Re-run \`alianza-mcp login\` with that scope included.${trace}`
        : `Forbidden: ${err.message}${trace}`;
    }
    case 404:
      return `Not found, or not visible to this token: ${err.message}${trace}`;
    case 409:
      return `Conflict: ${err.message}${trace}`;
    case 400:
    case 422:
      return `Alianza rejected the request: ${err.message}${fieldErrors}${trace}`;
    case 429:
      return `Rate limited by Alianza (100 requests/second per credential). Retry after ${err.details.retryAfterSeconds ?? 5} seconds.`;
    default:
      return err.status >= 500
        ? `The Alianza API is unavailable (HTTP ${err.status}).${trace} Try again shortly.`
        : `Alianza API error (HTTP ${err.status}): ${err.message}${trace}`;
  }
}

export async function withErrorHandling(
  toolName: string,
  fn: () => Promise<CallToolResult>,
  context?: { path?: string },
): Promise<CallToolResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  try {
    const result = await fn();
    usage.record({ tool: toolName, outcome: result.isError ? "error" : "ok", ms: ms() });
    return result;
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn("tool returned error", { tool: toolName, status: err.status, message: err.message, traceId: err.details.traceId });
      usage.record({ tool: toolName, outcome: err.status === 401 || err.status === 403 ? "auth" : "error", ms: ms(), status: err.status });
      return { content: [{ type: "text", text: apiErrorToText(err, context) }], isError: true };
    }
    if (err instanceof AuthError) {
      log.warn("tool blocked by auth", { tool: toolName, message: err.message });
      usage.record({ tool: toolName, outcome: "auth", ms: ms() });
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    if (err instanceof MissingInputError) {
      usage.record({ tool: toolName, outcome: "error", ms: ms() });
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    log.error("tool crashed", { tool: toolName, error: String(err) });
    usage.record({ tool: toolName, outcome: "crash", ms: ms() });
    throw err;
  }
}
