export type DevOpsConfig = {
  productionPath?: string;
  sandboxPort?: number;
  sandboxConfigDir?: string;
  maxShellTimeoutSeconds?: number;
  autoRollbackSeconds?: number;
  requireTestsPass?: boolean;
};

export type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
  durationMs: number;
};

export const PRODUCTION_PATH_DEFAULT = "/root/openclaw-fork";
export const SANDBOX_PORT_DEFAULT = 18790;
export const SANDBOX_CONFIG_DIR_DEFAULT = "/root/.openclaw-sandbox";
export const MAX_SHELL_TIMEOUT_DEFAULT = 600;
export const AUTO_ROLLBACK_SECONDS_DEFAULT = 40;

export const SANDBOX_CONTAINER_NAME = "openclaw-sandbox";
export const SANDBOX_IMAGE_TAG = "openclaw:sandbox";
export const PROD_IMAGE_TAG = "openclaw:prod";
export const PROD_PREV_IMAGE_TAG = "openclaw:prod-prev";

/** Commands allowed in shell_exec (prefix match). */
export const ALLOWED_COMMAND_PREFIXES = [
  "git",
  "pnpm",
  "node",
  "docker",
  "systemctl",
  "diff",
  "cat",
  "ls",
  "mkdir",
  "cp",
  "mv",
  "tee",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "echo",
  "curl",
  "which",
  "env",
  "printenv",
  "journalctl",
  "ss",
  "ps",
  "kill",
  "sleep",
  "date",
  "stat",
  "wc",
  "sort",
  "uniq",
  "jq",
  "python3",
  "sed",
  "awk",
  "tr",
];

/** Working directories allowed as cwd in shell_exec. */
export const ALLOWED_CWD_PREFIXES = [
  "/root/openclaw-fork",
  "/root/openclaw-sandbox-config",
  "/root/.openclaw-sandbox",
  "/tmp",
  "/root",
];
