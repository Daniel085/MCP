/** Tiny flag parser: --key value, --key=value, --flag, --no-flag. */
export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out.positional.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      out.flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (body.startsWith("no-")) {
      out.flags[body.slice(3)] = false;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out.flags[body] = argv[++i];
    } else {
      out.flags[body] = true;
    }
  }
  return out;
}

export function str(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function bool(flags: ParsedArgs["flags"], name: string, fallback: boolean): boolean {
  const v = flags[name];
  return typeof v === "boolean" ? v : fallback;
}
