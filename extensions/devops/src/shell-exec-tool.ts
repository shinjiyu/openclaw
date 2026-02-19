import { Type } from "@sinclair/typebox";
import type { DevOpsConfig } from "./types.js";
import {
  ALLOWED_COMMAND_PREFIXES,
  ALLOWED_CWD_PREFIXES,
  BUILDS_DIR_DEFAULT,
  MAX_SHELL_TIMEOUT_DEFAULT,
  SOURCE_REPO_DEFAULT,
} from "./types.js";
import { formatResult, runShell } from "./run.js";

export function createShellExecTool(cfg: DevOpsConfig) {
  const maxTimeout = (cfg.maxShellTimeoutSeconds ?? MAX_SHELL_TIMEOUT_DEFAULT) * 1000;
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;

  const allowedCwds = [
    ...ALLOWED_CWD_PREFIXES,
    sourceRepo,
    buildsDir,
  ];

  return {
    name: "shell_exec",
    label: "Shell Exec (DevOps)",
    description: [
      "Execute a shell command on the server with safety restrictions.",
      "Allowed commands: git, pnpm, node, docker, systemctl, diff, cat, ls, mkdir, cp, mv, grep, find, journalctl, ss, ps, sed, awk, jq, python3, and more.",
      "Working directory must be under /root/openclaw-fork, /root/openclaw-builds/, /tmp, or /root/.openclaw-sandbox.",
      "Use this to read/modify source code, build, run docker, check logs, etc.",
      "Dangerous ops like rm -rf /, writing to /etc, curl|sh are blocked.",
    ].join(" "),
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute. Pipes and redirects are supported." }),
      cwd: Type.Optional(Type.String({ description: "Working directory. Must be under an allowed path." })),
      timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds (max 600). Default: 60." })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as { command: string; cwd?: string; timeoutSeconds?: number };
      const command = p.command?.trim();

      if (!command) {
        return err("command is required");
      }

      // Safety: block obviously dangerous patterns
      const dangerous = [
        /rm\s+-rf\s+\//,
        /mkfs/,
        /dd\s+if=/,
        /curl\s+.*\|\s*(ba)?sh/,
        /wget\s+.*-O\s*-.*\|\s*(ba)?sh/,
        />\s*\/etc\/(passwd|shadow|sudoers|crontab)/,
        /chmod\s+777\s+\/etc/,
      ];
      for (const pattern of dangerous) {
        if (pattern.test(command)) {
          return err(`Blocked dangerous pattern: ${pattern}`);
        }
      }

      // Safety: check command prefix whitelist
      const firstWord = command.split(/\s+/)[0]?.replace(/^.*\//, "") ?? "";
      if (!ALLOWED_COMMAND_PREFIXES.includes(firstWord)) {
        return err(`Command '${firstWord}' is not in the allowed list. Allowed: ${ALLOWED_COMMAND_PREFIXES.join(", ")}`);
      }

      // Safety: validate cwd
      const cwd = p.cwd ?? productionPath;
      const cwdOk = allowedCwds.some((prefix) => cwd === prefix || cwd.startsWith(prefix + "/"));
      if (!cwdOk) {
        return err(`cwd '${cwd}' is not allowed. Allowed prefixes: ${allowedCwds.join(", ")}`);
      }

      const timeoutMs = Math.min((p.timeoutSeconds ?? 60) * 1000, maxTimeout);

      const result = await runShell(command, { cwd, timeoutMs });
      const text = formatResult(result, command.slice(0, 60));

      return {
        content: [{ type: "text" as const, text }],
        details: {
          exitCode: result.exitCode,
          ok: result.ok,
          durationMs: result.durationMs,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 1000),
        },
      };
    },
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `shell_exec error: ${message}` }],
    details: { ok: false, error: message },
  };
}
