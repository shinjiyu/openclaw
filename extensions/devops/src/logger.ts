import fs from "node:fs";
import path from "node:path";

export const DEVOPS_LOG_DIR = "/root/.openclaw-devops";
export const DEVOPS_LOG_FILE = path.join(DEVOPS_LOG_DIR, "deploy.log");
export const DEVOPS_DEPLOY_STATE_FILE = path.join(DEVOPS_LOG_DIR, "deploy-state.json");
export const DEVOPS_LAST_RESULT_FILE = path.join(DEVOPS_LOG_DIR, "last-result.json");

const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate at 5 MB

function ensureLogDir(): void {
  try {
    fs.mkdirSync(DEVOPS_LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function maybeRotate(): void {
  try {
    const stat = fs.statSync(DEVOPS_LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(DEVOPS_LOG_FILE, DEVOPS_LOG_FILE + ".1");
    }
  } catch {
    // no-op if file doesn't exist yet
  }
}

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/**
 * Write a structured log line to the devops log file.
 * Returns the formatted line so callers can include it in tool output.
 */
export function devopsLog(
  level: LogLevel,
  component: string,
  message: string,
  extra?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const extraStr = extra ? `  ${JSON.stringify(extra)}` : "";
  const line = `[${ts}] [${level.padEnd(5)}] [${component}] ${message}${extraStr}`;

  try {
    ensureLogDir();
    maybeRotate();
    fs.appendFileSync(DEVOPS_LOG_FILE, line + "\n", "utf-8");
  } catch {
    // writing logs should never throw
  }

  return line;
}

/** Structured logger bound to a component name. */
export function createLogger(component: string) {
  return {
    info:  (msg: string, extra?: Record<string, unknown>) => devopsLog("INFO",  component, msg, extra),
    warn:  (msg: string, extra?: Record<string, unknown>) => devopsLog("WARN",  component, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => devopsLog("ERROR", component, msg, extra),
    debug: (msg: string, extra?: Record<string, unknown>) => devopsLog("DEBUG", component, msg, extra),
  };
}

/** Read the last N lines of the log file. */
export function readRecentLogs(lines = 60): string {
  try {
    const content = fs.readFileSync(DEVOPS_LOG_FILE, "utf-8");
    const all = content.split("\n").filter(Boolean);
    return all.slice(-lines).join("\n");
  } catch {
    return "(no logs yet)";
  }
}
