import { spawn } from "node:child_process";
import type { ShellResult } from "./types.js";

/**
 * Run a shell command and return stdout/stderr/exitCode.
 * Uses /bin/sh -c so pipes and redirects work.
 */
export function runShell(
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  } = {},
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeoutMs = opts.timeoutMs ?? 60_000;

    const proc = spawn("/bin/sh", ["-c", command], {
      cwd: opts.cwd ?? "/root",
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 3000);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        ok: exitCode === 0,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: String(err),
        exitCode: -1,
        ok: false,
        durationMs: Date.now() - start,
      });
    });
  });
}

/** Format ShellResult into a readable string for agent tool responses. */
export function formatResult(result: ShellResult, label?: string): string {
  const header = label ? `[${label}] exitCode=${result.exitCode} (${result.durationMs}ms)` : `exitCode=${result.exitCode} (${result.durationMs}ms)`;
  const parts = [header];
  if (result.stdout) {
    parts.push(`stdout:\n${result.stdout.slice(0, 4000)}`);
  }
  if (result.stderr) {
    parts.push(`stderr:\n${result.stderr.slice(0, 2000)}`);
  }
  return parts.join("\n");
}
