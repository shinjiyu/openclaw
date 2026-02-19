export type DevOpsConfig = {
  /** Git source repo (never modified directly). Default: /root/openclaw-fork */
  sourceRepo?: string;
  /** Parent dir for isolated build dirs. Default: /root/openclaw-builds */
  buildsDir?: string;
  /** Global npm symlink that production uses. Default: /usr/lib/node_modules/openclaw */
  globalSymlink?: string;
  /**
   * Shell command to restart the gateway after promote/rollback.
   * Default (Linux): "systemctl restart openclaw-gateway"
   * macOS example:   "pkill -9 -f 'openclaw gateway' || true; sleep 2; nohup pnpm --prefix /path/to/openclaw openclaw gateway run --bind loopback --port 18789 >> /tmp/openclaw-gateway.log 2>&1 &"
   */
  gatewayRestartCmd?: string;
  /** Shell command to check if the gateway is healthy. Default: "ss -ltnp | grep 18789" */
  gatewayHealthCmd?: string;
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

export const SOURCE_REPO_DEFAULT = "/root/openclaw-fork";
export const BUILDS_DIR_DEFAULT = "/root/openclaw-builds";
export const GLOBAL_SYMLINK_DEFAULT = "/usr/lib/node_modules/openclaw";
export const SANDBOX_PORT_DEFAULT = 18790;
export const SANDBOX_CONFIG_DIR_DEFAULT = "/root/.openclaw-sandbox";
export const MAX_SHELL_TIMEOUT_DEFAULT = 600;
export const AUTO_ROLLBACK_SECONDS_DEFAULT = 40;

export const SANDBOX_CONTAINER_NAME = "openclaw-sandbox";
export const SANDBOX_IMAGE_TAG = "openclaw:sandbox";

/** Commands allowed in shell_exec (first word match). */
export const ALLOWED_COMMAND_PREFIXES = [
  "git",
  "pnpm",
  "npm",
  "node",
  "docker",
  "systemctl",
  "ln",
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
  "readlink",
  "realpath",
];

/** Working directories allowed as cwd in shell_exec. */
export const ALLOWED_CWD_PREFIXES = [
  "/root/openclaw-fork",
  "/root/openclaw-builds",
  "/root/.openclaw-sandbox",
  "/tmp",
  "/root",
];
