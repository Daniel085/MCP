/**
 * Local usage log. One JSON line per tool call: which tool, whether it
 * succeeded, the upstream status on failure, and how long it took. No
 * arguments and no identifiers are recorded, so the file is safe to share.
 *
 * An MCP server never sees the user's prompt, only the model's tool calls,
 * so this is the most a server can learn about how it is used.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type UsageOutcome = "ok" | "error" | "auth" | "crash";

export interface UsageEvent {
  ts: string;
  tool: string;
  outcome: UsageOutcome;
  ms: number;
  status?: number;
  session: string;
  version: string;
}

class UsageRecorder {
  private file: string | null = null;
  private readonly session = randomUUID().slice(0, 8);
  private version = "0.0.0";
  private pending: Promise<void> = Promise.resolve();

  configure(file: string | null, version: string): void {
    this.file = file;
    this.version = version;
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      } catch {
        this.file = null;
      }
    }
  }

  record(event: Omit<UsageEvent, "ts" | "session" | "version">): void {
    if (!this.file) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event, session: this.session, version: this.version } satisfies UsageEvent);
    const file = this.file;
    // Serialise appends and never let logging break a tool call.
    this.pending = this.pending.then(() => fs.promises.appendFile(file, line + "\n")).catch(() => undefined);
  }

  /** Test hook: wait for queued writes. */
  flush(): Promise<void> {
    return this.pending;
  }
}

export const usage = new UsageRecorder();

export interface ToolSummary {
  calls: number;
  ok: number;
  error: number;
  auth: number;
  crash: number;
  p50ms: number;
  statuses: Record<string, number>;
}

export interface UsageSummary {
  file: string;
  since: string | null;
  until: string | null;
  events: number;
  sessions: number;
  tools: Record<string, ToolSummary>;
}

export function summarize(file: string, sinceDays = 30): UsageSummary {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    // no file yet
  }
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const events: UsageEvent[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as UsageEvent;
      if (e.tool && Date.parse(e.ts) >= cutoff) events.push(e);
    } catch {
      // skip corrupt line
    }
  }
  const tools: Record<string, ToolSummary & { durations: number[] }> = {};
  const sessions = new Set<string>();
  for (const e of events) {
    sessions.add(e.session);
    const t = (tools[e.tool] ??= { calls: 0, ok: 0, error: 0, auth: 0, crash: 0, p50ms: 0, statuses: {}, durations: [] });
    t.calls++;
    t[e.outcome]++;
    t.durations.push(e.ms);
    if (e.status !== undefined) t.statuses[String(e.status)] = (t.statuses[String(e.status)] ?? 0) + 1;
  }
  const out: Record<string, ToolSummary> = {};
  for (const [name, t] of Object.entries(tools)) {
    const sorted = [...t.durations].sort((a, b) => a - b);
    const { durations: _d, ...rest } = t;
    out[name] = { ...rest, p50ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0 };
  }
  const times = events.map((e) => e.ts).sort();
  return { file, since: times[0] ?? null, until: times[times.length - 1] ?? null, events: events.length, sessions: sessions.size, tools: out };
}

export function formatSummary(s: UsageSummary): string {
  if (s.events === 0) return `No usage recorded yet in ${s.file}.`;
  const rows = Object.entries(s.tools)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([name, t]) => {
      const failures = t.error + t.auth + t.crash;
      const statuses = Object.entries(t.statuses)
        .map(([k, v]) => `${k}x${v}`)
        .join(" ");
      return `${name.padEnd(32)} ${String(t.calls).padStart(6)} ${String(failures).padStart(8)} ${String(t.p50ms).padStart(7)}  ${statuses}`;
    });
  return [
    `Usage from ${s.since} to ${s.until}: ${s.events} tool calls across ${s.sessions} session(s).`,
    `Log file: ${s.file} (no arguments or identifiers are recorded; safe to share).`,
    "",
    `${"tool".padEnd(32)} ${"calls".padStart(6)} ${"failures".padStart(8)} ${"p50 ms".padStart(7)}  upstream statuses`,
    ...rows,
  ].join("\n");
}
