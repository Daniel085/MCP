/** Minimal interactive prompts on stderr/stdin, so stdout stays clean. */
import readline from "node:readline";

export interface PromptOptions {
  default?: string;
  secret?: boolean;
  required?: boolean;
  validate?: (value: string) => string | null;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export async function ask(question: string, opts: PromptOptions = {}): Promise<string> {
  const suffix = opts.default ? ` [${opts.secret ? "keep current" : opts.default}]` : "";
  for (;;) {
    const raw = await readLine(`${question}${suffix}: `, opts.secret ?? false);
    const value = raw.trim() === "" && opts.default !== undefined ? opts.default : raw.trim();
    if (!value && opts.required) {
      process.stderr.write("  A value is required.\n");
      continue;
    }
    const problem = value && opts.validate ? opts.validate(value) : null;
    if (problem) {
      process.stderr.write(`  ${problem}\n`);
      continue;
    }
    return value;
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const answer = await readLine(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}: `, false);
  if (answer.trim() === "") return defaultYes;
  return /^y(es)?$/i.test(answer.trim());
}

function readLine(prompt: string, secret: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (secret) {
      // Echo asterisks instead of the typed characters.
      const anyRl = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
      const original = anyRl._writeToOutput.bind(rl);
      let asked = false;
      anyRl._writeToOutput = (s: string) => {
        if (!asked && s.includes(prompt)) {
          asked = true;
          original(s);
          return;
        }
        if (s === "\r\n" || s === "\n") original(s);
        else original(s.replace(/[^\r\n]/g, "*"));
      };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      if (secret) process.stderr.write("\n");
      resolve(answer);
    });
  });
}
