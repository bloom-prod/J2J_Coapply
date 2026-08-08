import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Structured (JSONL) logger for operational events — auth, data mutations
// (via pub/sub), SSE, maintenance. Appends to a single file (default
// ~/logs/jobless.logs) and never throws into the request path. Best-effort:
// if the file/dir can't be written it degrades to the console, which `docker
// compose logs` still surfaces.
//
// The default resolves `~` from os.homedir(). In a container the runner user
// (nextjs) usually can't write HOME, so mount a volume and point LOG_FILE at
// it, e.g. LOG_FILE=/logs/jobless.logs. In `npm run dev` it lands where you'd
// expect: ~/logs/jobless.logs.

type Level = "info" | "warn" | "error";

let resolvedPath: string | null = null;
let dirEnsured: Promise<void> | null = null;

function logPath(): string {
  if (resolvedPath) return resolvedPath;
  const env = process.env.LOG_FILE;
  resolvedPath = env
    ? env.replace(/^~\//, `${os.homedir()}/`)
    : path.join(os.homedir(), "logs", "jobless.logs");
  return resolvedPath;
}

function ensureDir(): Promise<void> {
  if (!dirEnsured) {
    dirEnsured = mkdir(path.dirname(logPath()), { recursive: true }).catch((e) => {
      console.error(`[logger] can't create log dir: ${(e as Error)?.message ?? e}`);
    }).then(() => undefined);
  }
  return dirEnsured;
}

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  const rec = {
    ts: new Date().toISOString(),
    level,
    event,
    service: "bloom-tracker",
    ...fields,
  };
  const line = JSON.stringify(rec);
  // Fire-and-forget disk write; failures fall back to the console line below.
  void ensureDir().then(() => appendFile(logPath(), `${line}\n`)).catch(() => {});
  // Also mirror to stdout so it shows in `docker compose logs` / `npm run dev`.
  if (level === "error") console.error(line);
  else console.log(line);
}

const info = (event: string, fields?: Record<string, unknown>) => write("info", event, fields);
const warn = (event: string, fields?: Record<string, unknown>) => write("warn", event, fields);
const error = (event: string, fields?: Record<string, unknown>) => write("error", event, fields);

export const logger = { info, warn, error };