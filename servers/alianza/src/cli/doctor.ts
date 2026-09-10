/**
 * `alianza-mcp doctor`: verify the install end to end and say what to fix.
 */
import fs from "node:fs";
import { ApiClient, ApiError } from "../api-client.js";
import { AuthError, AuthManager } from "../auth.js";
import type { Config } from "../config.js";
import { redirectUriInstructions } from "./setup.js";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function runDoctor(config: Config, fetchImpl?: typeof fetch): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(
    major >= 20
      ? { name: "Node.js", status: "ok", detail: `v${process.versions.node}` }
      : { name: "Node.js", status: "fail", detail: `v${process.versions.node} is too old; install Node 20 or newer.` },
  );

  const hasFile = fs.existsSync(config.configFile);
  checks.push(
    hasFile
      ? { name: "Config file", status: "ok", detail: config.configFile }
      : { name: "Config file", status: "warn", detail: `${config.configFile} not found; using environment variables only. Run \`alianza-mcp setup\`.` },
  );
  checks.push({ name: "Environment", status: "ok", detail: `${config.env} (${config.apiBaseUrl})` });

  const missing = (["clientId", "clientSecret", "experienceId"] as const).filter((k) => !config[k]);
  if (missing.length) {
    checks.push({ name: "Credentials", status: "fail", detail: `Missing ${missing.join(", ")}. Run \`alianza-mcp setup\`.` });
    return checks;
  }
  checks.push({ name: "Credentials", status: "ok", detail: `client ${config.clientId}, experience ${config.experienceId}` });

  const auth = AuthManager.fromConfig(config, fetchImpl);
  const api = ApiClient.fromConfig(config, auth, fetchImpl);

  try {
    const r = await api.checkAssignability(config.experienceId, "PHONE_NUMBER", "+15555550100");
    checks.push({ name: "Client credentials", status: "ok", detail: `token issued; assignability check answered (assignable=${r.assignable} for a placeholder number)` });
  } catch (err) {
    checks.push({ name: "Client credentials", status: "fail", detail: describe(err) });
  }

  const status = auth.status({ env: config.env, apiBaseUrl: config.apiBaseUrl, experienceId: config.experienceId });
  if (status.userToken.source === "none") {
    checks.push({
      name: "User sign-in",
      status: "fail",
      detail: `No user-context token. Run \`alianza-mcp login\`.\n${redirectUriInstructions(config.clientId, config.redirectUri)}`,
    });
    return checks;
  }
  try {
    const page = await api.listUsers({ pageSize: 1 });
    checks.push({
      name: "User sign-in",
      status: "ok",
      detail: `${status.userToken.source}${status.userToken.expiresAt ? `, expires ${status.userToken.expiresAt}` : ""}; users endpoint answered (${page.count ?? page.entities.length} visible)`,
    });
  } catch (err) {
    checks.push({ name: "User sign-in", status: "fail", detail: describe(err) });
  }

  checks.push(
    config.usageLog
      ? { name: "Usage log", status: "ok", detail: `${config.usageLog} (tool names and outcomes only; share with \`alianza-mcp usage\`)` }
      : { name: "Usage log", status: "warn", detail: "disabled" },
  );
  return checks;
}

function describe(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof ApiError) return `HTTP ${err.status}: ${err.message}${err.details.traceId ? ` (traceId ${err.details.traceId})` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

export function formatChecks(checks: Check[]): string {
  const icon = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  return checks.map((c) => `${icon[c.status]}  ${c.name.padEnd(18)} ${c.detail.replace(/\n/g, "\n" + " ".repeat(24))}`).join("\n");
}
