/**
 * Builds a fully registered McpServer. Called once for stdio and once per
 * request for stateless HTTP, so keep construction cheap.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerAuthTools } from "./tools/auth-status.js";
import { registerConnectionTools } from "./tools/connections.js";
import type { ToolContext } from "./tools/context.js";
import { registerEnableTool } from "./tools/enable.js";
import { registerExperienceTools } from "./tools/experience.js";
import { registerUserTools } from "./tools/users.js";

export const SERVER_NAME = "alianza-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tools for the Alianza Experience (Crux) API: enabling a partner's Post-Call or Virtual Agent Experience for " +
        "customer accounts and phone numbers, and reading users. Vocabulary: a Connection links the Experience to one " +
        "account and its state (ACTIVE/INACTIVE) gates media; an Assignment picks which targets (ACCOUNT, PHONE_NUMBER, " +
        "USER) on that account the Experience applies to. To enable for a customer, prefer alianza_enable_experience. " +
        "Activation, deletion, and assignment changes affect live calls, so confirm with the user first. If a tool reports " +
        "an auth problem, call alianza_auth_status and relay its instructions.",
    },
  );
  registerAuthTools(server, ctx);
  registerExperienceTools(server, ctx);
  registerConnectionTools(server, ctx);
  registerAssignmentTools(server, ctx);
  registerUserTools(server, ctx);
  registerEnableTool(server, ctx);
  return server;
}
