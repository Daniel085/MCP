/**
 * Shared error handling for tools. Upstream failures become isError results
 * with text the model can act on; anything else is a bug and propagates.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, AuthError } from "../api-client.js";
import { log } from "../log.js";
import { usage } from "../usage.js";
import { MissingInputError } from "./context.js";

/** Scope and the tool that lists a resource, keyed by request path. */
const BY_PATH: Array<[RegExp, { scope: string; listTool?: string }]> = [
  [/assignability/, { scope: "experience-assignability:check" }],
  [/\/experience\/assignments/, { scope: "experience-assignments:manage", listTool: "alianza_list_assignments" }],
  [/\/experience\/connections/, { scope: "experience-connections:manage", listTool: "alianza_list_connections" }],
  [/\/users/, { scope: "users:manage", listTool: "alianza_list_users" }],
];

function lookup(path: string | undefined) {
  return BY_PATH.find(([re]) => re.test(path ?? ""))?.[1];
}

export interface ErrorContext {
  /** Fallback when the ApiError carries no path (it normally does). */
  path?: string;
  /** Tailors the 404 text for delete tools. */
  verb?: "delete";
}

export function apiErrorToText(err: ApiError, context?: ErrorContext): string {
  const trace = err.details.traceId ? ` (traceId ${err.details.traceId})` : "";
  const info = lookup(err.details.path ?? context?.path);
  const fieldErrors = err.details.errors?.length
    ? "\n" + err.details.errors.map((e) => `- ${e.field ?? "field"}: ${e.message ?? JSON.stringify(e)}`).join("\n")
    : "";
  switch (err.status) {
    case 0:
      return `The Alianza API could not be reached (${err.message}). Try again shortly.`;
    case 401:
      return `Alianza rejected the token even after refreshing it. Run \`alianza-mcp login\` again.${trace}`;
    case 403:
      return info
        ? `The token lacks the \`${info.scope}\` scope required for this operation. Re-run \`alianza-mcp login\` with that scope included.${trace}`
        : `Forbidden: ${err.message}${trace}`;
    case 404: {
      const hint =
        context?.verb === "delete"
          ? " It may already be deleted, or the id is wrong."
          : info?.listTool
            ? ` Check the id, or find it with ${info.listTool}.`
            : "";
      return `Not found, or not visible to this token: ${err.message}.${hint}${trace}`;
    }
    case 409: {
      const hint = info?.listTool ? ` Fetch the current state with ${info.listTool} before retrying.` : "";
      return `Conflict: ${err.message}.${hint}${trace}`;
    }
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
  context?: ErrorContext,
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
