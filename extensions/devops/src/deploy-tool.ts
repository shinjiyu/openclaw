import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  atomicSwapSymlink,
  readDeployState,
  writeDeployState,
} from "./build-dir.js";
import {
  DEVOPS_LAST_RESULT_FILE,
  DEVOPS_LOG_FILE,
  createLogger,
  readRecentLogs,
} from "./logger.js";
import { formatResult, runShell } from "./run.js";
import type { DevOpsConfig } from "./types.js";
import {
  AUTO_ROLLBACK_SECONDS_DEFAULT,
  BUILDS_DIR_DEFAULT,
  SANDBOX_CONTAINER_NAME,
  SOURCE_REPO_DEFAULT,
} from "./types.js";

const log = createLogger("deploy-tool");

export function createDeployTool(cfg: DevOpsConfig) {
  const autoRollbackSeconds = cfg.autoRollbackSeconds ?? AUTO_ROLLBACK_SECONDS_DEFAULT;
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;
  const restartCmd = cfg.gatewayRestartCmd ?? "systemctl restart openclaw-gateway";
  const healthCmd = cfg.gatewayHealthCmd ?? "ss -ltnp | grep 18789";

  return {
    name: "devops_deploy",
    label: "DevOps Deploy",
    description: [
      "Promote a tested build dir to production or rollback to the previous version.",
      "CHAT-SAFE: promote uses a deferred restart (gateway restarts 5s AFTER returning the response to you,",
      "  so this message is guaranteed to be delivered before the restart).",
      "LOGGING: all actions are logged to /root/.openclaw-devops/deploy.log.",
      "AUTO-CLEANUP: on successful promote only the active + previous build dirs are kept.",
      "Actions:",
      "status   — production symlink, git log, gateway port, last deploy result.",
      "promote  — swap symlink, schedule deferred restart + watchdog (chat-safe).",
      "rollback — swap symlink back to previous build dir + restart.",
      "logs     — tail last 80 lines of the deploy log.",
      "cleanup  — delete all build dirs except active + previous.",
      "tag      — create a git snapshot tag in the source repo.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "One of: status | promote | rollback | logs | cleanup | tag",
      }),
      buildDir: Type.Optional(Type.String({
        description: "Build dir to promote (action=promote). Uses last sandbox dir if omitted.",
      })),
      tagName: Type.Optional(Type.String({
        description: "Tag name for action=tag. Auto-generated if omitted.",
      })),
      force: Type.Optional(Type.Boolean({
        description: "For promote: skip deferred restart, restart immediately (not safe from chat).",
      })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as {
        action: string;
        buildDir?: string;
        tagName?: string;
        force?: boolean;
      };
      log.info(`execute action=${p.action}`);

      switch (p.action?.trim()) {
        case "status":
          return deployStatus(cfg, sourceRepo, healthCmd);
        case "promote":
          return deployPromote(cfg, p.buildDir, autoRollbackSeconds, p.force ?? false, buildsDir, restartCmd, healthCmd);
        case "rollback":
          return deployRollback(cfg, restartCmd);
        case "logs":
          return deployLogs();
        case "cleanup":
          return deployCleanup(cfg);
        case "tag":
          return deployTag(sourceRepo, p.tagName);
        default:
          return errResult(`Unknown action '${p.action}'. Use: status | promote | rollback | logs | cleanup | tag`);
      }
    },
  };
}

// ── status ────────────────────────────────────────────────────────────────────

async function deployStatus(cfg: DevOpsConfig, sourceRepo: string, healthCmd: string) {
  log.info("status check");
  const state = readDeployState();
  const symlink = cfg.globalSymlink ?? "/usr/lib/node_modules/openclaw";

  const [symlinkTarget, gitLog, gwPort] = await Promise.all([
    runShell(`readlink -f ${symlink} 2>/dev/null || readlink ${symlink} 2>/dev/null || echo "(not a symlink)"`, { timeoutMs: 5000 }),
    runShell("git log --oneline -5", { cwd: sourceRepo, timeoutMs: 10_000 }),
    runShell(`${healthCmd} | head -2`, { timeoutMs: 5000 }),
  ]);

  // Last watchdog result
  let lastResult = "(no deploy recorded yet)";
  try {
    const raw = fs.readFileSync(DEVOPS_LAST_RESULT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { ts: string; ok: boolean; message: string };
    lastResult = `[${parsed.ts}] ${parsed.ok ? "✅" : "❌"} ${parsed.message}`;
  } catch {
    // fine
  }

  const lines = [
    "=== Production Deploy Status ===",
    `Symlink:  ${symlink}`,
    `  → ${symlinkTarget.stdout || "(not found)"}`,
    "",
    `State:`,
    `  active:   ${state.activeDir ?? "(unmanaged — initial install)"}`,
    `  previous: ${state.previousDir ?? "(none)"}`,
    `  sandbox:  ${state.sandboxDir ?? "(none — run devops_sandbox create)"}`,
    "",
    `Source repo git log (${sourceRepo}):`,
    gitLog.stdout || gitLog.stderr,
    "",
    `Gateway port 18789: ${gwPort.stdout || "NOT LISTENING"}`,
    "",
    `Last deploy result: ${lastResult}`,
    `Full logs: ${DEVOPS_LOG_FILE}`,
  ];

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { ok: true, state },
  };
}

// ── promote ───────────────────────────────────────────────────────────────────

async function deployPromote(
  cfg: DevOpsConfig,
  buildDirPath: string | undefined,
  autoRollbackSeconds: number,
  force: boolean,
  buildsDir: string,
  restartCmd: string,
  healthCmd: string,
) {
  const steps: string[] = [];
  const step = (msg: string) => {
    steps.push(msg);
    log.info(msg);
  };

  step("=== PROMOTE START ===");

  // Resolve build dir
  const state = readDeployState();
  const targetDir = buildDirPath ?? state.sandboxDir;
  if (!targetDir) {
    const msg = "No buildDir specified and no sandbox dir in state. Run devops_sandbox(create) first.";
    log.error(msg);
    return errResult(msg);
  }
  step(`Target build dir: ${targetDir}`);

  // Verify dist/entry.js exists
  const distCheck = await runShell(`ls ${targetDir}/dist/entry.js`, { timeoutMs: 5000 });
  if (!distCheck.ok) {
    const msg = `Build dir has no dist/entry.js — run devops_sandbox(build, buildDir="${targetDir}") first.`;
    log.error(msg);
    return errResult(msg);
  }
  step("✅ dist/entry.js verified");

  // Read current symlink for rollback reference
  const symlink = cfg.globalSymlink ?? "/usr/lib/node_modules/openclaw";
  const currentSymlink = await runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 });
  const previousDir = state.activeDir ?? (currentSymlink.ok ? currentSymlink.stdout.trim() : null);
  step(`Previous dir: ${previousDir ?? "(none)"}`);

  // Atomic symlink swap
  const { ok: swapOk, log: swapLog } = await atomicSwapSymlink(cfg, targetDir);
  step(swapLog);
  if (!swapOk) {
    log.error("symlink swap failed", { targetDir });
    return errResult(`Symlink swap failed.\n${steps.join("\n")}`);
  }
  step("✅ Symlink swapped atomically");

  // Persist deploy state
  const newState = {
    activeDir: targetDir,
    previousDir: previousDir,
    sandboxDir: state.sandboxDir,
    updatedAt: Date.now(),
  };
  writeDeployState(newState);
  step(`Deploy state saved`);

  // Tag source repo
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  await runShell(`git tag promoted-${ts} 2>/dev/null || true`, { cwd: sourceRepo, timeoutMs: 5000 });
  step(`Source repo tagged: promoted-${ts}`);

  if (force) {
    // Immediate restart (not safe from chat context — user explicitly opted in)
    step("⚠️ force=true: restarting immediately (not chat-safe)");
    await runShell(restartCmd, { timeoutMs: 15_000 });
    step("Gateway restarting...");
    return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: true } };
  }

  // CHAT-SAFE: generate + launch a self-contained watchdog bash script,
  // then schedule the restart to happen 5s AFTER we return this response.
  // The watchdog checks health and auto-rolls back if the gateway doesn't come up.
  const watchdogPath = await writeWatchdogScript({
    targetDir,
    previousDir,
    symlink,
    autoRollbackSeconds,
    buildsDir,
    sourceRepo,
    restartCmd,
    healthCmd,
  });
  step(`Watchdog script written: ${watchdogPath}`);

  // Launch watchdog in background (nohup, fully detached from this process)
  const launchResult = await runShell(
    `nohup bash ${watchdogPath} >> ${DEVOPS_LOG_FILE} 2>&1 &`,
    { timeoutMs: 5000 },
  );
  step(launchResult.ok ? "✅ Watchdog launched (background)" : `⚠️ Watchdog launch: ${launchResult.stderr}`);

  // Schedule deferred restart (5s delay — allows this response to be delivered first)
  const escapedCmd = restartCmd.replace(/'/g, "'\\''");
  const deferredResult = await runShell(
    `nohup bash -c 'sleep 5 && ${escapedCmd}' >> ${DEVOPS_LOG_FILE} 2>&1 &`,
    { timeoutMs: 5000 },
  );
  step(deferredResult.ok
    ? "✅ Deferred restart scheduled (gateway will restart in ~5 seconds)"
    : `⚠️ Deferred restart: ${deferredResult.stderr}`);

  steps.push("");
  steps.push("┌─────────────────────────────────────────────────────────────┐");
  steps.push("│  🚀 PROMOTE INITIATED — this response will be delivered     │");
  steps.push("│  before the gateway restarts in ~5 seconds.                 │");
  steps.push("│  Watchdog will auto-rollback if health check fails.         │");
  steps.push(`│  Check result: devops_deploy(status) after ~${autoRollbackSeconds + 10}s           │`);
  steps.push(`│  Live logs:    devops_deploy(logs)                          │`);
  steps.push("└─────────────────────────────────────────────────────────────┘");

  return {
    content: [{ type: "text" as const, text: steps.join("\n") }],
    details: { ok: true, activeDir: targetDir, watchdog: watchdogPath },
  };
}

// ── watchdog script generation ────────────────────────────────────────────────

async function writeWatchdogScript(opts: {
  targetDir: string;
  previousDir: string | null;
  symlink: string;
  autoRollbackSeconds: number;
  buildsDir: string;
  sourceRepo: string;
  restartCmd: string;
  healthCmd: string;
}): Promise<string> {
  const scriptPath = path.join(os.tmpdir(), `openclaw-watchdog-${Date.now()}.sh`);
  const stateFile = DEVOPS_LOG_FILE.replace("/deploy.log", "/deploy-state.json");
  const resultFile = DEVOPS_LAST_RESULT_FILE;

  const script = `#!/usr/bin/env bash
# OpenClaw deploy watchdog — auto-generated, do not edit
# Target:   ${opts.targetDir}
# Previous: ${opts.previousDir ?? "none"}
# RestartCmd: ${opts.restartCmd}
# HealthCmd:  ${opts.healthCmd}

TARGET_DIR="${opts.targetDir}"
PREV_DIR="${opts.previousDir ?? ""}"
SYMLINK="${opts.symlink}"
RESULT_FILE="${resultFile}"
BUILDS_DIR="${opts.buildsDir}"
MAX_WAIT_SECS="${opts.autoRollbackSeconds}"
HEALTH_CMD=${JSON.stringify(opts.healthCmd)}
RESTART_CMD=${JSON.stringify(opts.restartCmd)}

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo "[\$(ts)] [INFO ] [watchdog] $*"; }
logw() { echo "[\$(ts)] [WARN ] [watchdog] $*"; }
loge() { echo "[\$(ts)] [ERROR] [watchdog] $*"; }

save_result() {
  local ok="$1" msg="$2"
  printf '{"ts":"%s","ok":%s,"message":"%s"}\\n' "\$(ts)" "$ok" "$msg" > "$RESULT_FILE" 2>/dev/null || true
}

log "=== WATCHDOG STARTED (pid $$) ==="
log "Target dir  : $TARGET_DIR"
log "Previous    : \${PREV_DIR:-none}"
log "Symlink     : $SYMLINK"
log "Max wait    : ${opts.autoRollbackSeconds}s"
log "Health cmd  : $HEALTH_CMD"
log "Restart cmd : $RESTART_CMD"

# Give the deferred restart time to fire
sleep 8

# Poll for gateway health using the configured health command
log "Polling health (max ${opts.autoRollbackSeconds}s)..."
waited=0
healthy=false
while [ "$waited" -lt "$MAX_WAIT_SECS" ]; do
  if eval "$HEALTH_CMD" > /dev/null 2>&1; then
    log "Health check passed — gateway healthy (waited \${waited}s)"
    healthy=true
    break
  fi
  # Also check journal if available
  if command -v journalctl >/dev/null 2>&1; then
    if journalctl -u openclaw-gateway -n 3 --no-pager 2>/dev/null | grep -q "listening on"; then
      log "Journal: 'listening on' — gateway healthy (waited \${waited}s)"
      healthy=true
      break
    fi
  fi
  log "Not ready yet (\${waited}s elapsed)..."
  sleep 4
  waited=$((waited + 4))
done

if [ "$healthy" = "true" ]; then
  log "=== DEPLOY SUCCESSFUL ==="
  save_result "true" "promote to $TARGET_DIR succeeded"

  # Auto-cleanup: keep only active + previous, remove everything else
  log "Running auto-cleanup (keeping active + previous)..."
  if [ -d "$BUILDS_DIR" ]; then
    active_real="$(realpath "$TARGET_DIR" 2>/dev/null || echo "$TARGET_DIR")"
    prev_real="$(realpath "$PREV_DIR" 2>/dev/null || echo "$PREV_DIR")"
    for d in "$BUILDS_DIR"/*/; do
      d_real="$(realpath "$d" 2>/dev/null || echo "$d")"
      if [ "$d_real" = "$active_real" ] || [ "$d_real" = "$prev_real" ]; then
        log "Keeping: $d"
      else
        log "Removing old build dir: $d"
        rm -rf "$d" || logw "Failed to remove $d"
      fi
    done
  fi

  # Clean up sandbox Docker container if running
  docker rm -f openclaw-sandbox 2>/dev/null && log "Sandbox container cleaned up" || true

  log "=== WATCHDOG DONE (success) ==="
  exit 0
fi

# === AUTO-ROLLBACK ===
loge "Gateway not healthy after \${MAX_WAIT_SECS}s — initiating AUTO ROLLBACK"

if [ -z "$PREV_DIR" ] || [ ! -f "$PREV_DIR/dist/entry.js" ]; then
  loge "No valid previous dir for rollback (\${PREV_DIR:-empty})"
  save_result "false" "promote failed + no rollback target"
  exit 1
fi

log "Swapping symlink back: $PREV_DIR"
ln -sfn "$PREV_DIR" "$SYMLINK"
log "Symlink reverted to $PREV_DIR"

log "Restarting gateway with previous version..."
eval "$RESTART_CMD"

# Wait for rollback gateway
rb_waited=0
rb_healthy=false
while [ "$rb_waited" -lt 40 ]; do
  if eval "$HEALTH_CMD" > /dev/null 2>&1; then
    log "Rollback gateway healthy (waited \${rb_waited}s)"
    rb_healthy=true
    break
  fi
  sleep 4
  rb_waited=$((rb_waited + 4))
done

if [ "$rb_healthy" = "true" ]; then
  log "=== ROLLBACK SUCCESSFUL === active: $PREV_DIR"
  save_result "false" "promote failed — rolled back to $PREV_DIR successfully"
else
  loge "=== ROLLBACK ALSO FAILED === manual intervention required"
  loge "  Symlink: $SYMLINK → $PREV_DIR (already restored)"
  loge "  Try: systemctl restart openclaw-gateway"
  save_result "false" "promote AND rollback failed — manual intervention required"
fi

log "=== WATCHDOG DONE (rollback path) ==="
exit 1
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

// ── rollback ──────────────────────────────────────────────────────────────────

async function deployRollback(cfg: DevOpsConfig, restartCmd: string) {
  const steps: string[] = [];
  const step = (msg: string) => { steps.push(msg); log.info(msg); };

  step("=== MANUAL ROLLBACK ===");
  const state = readDeployState();
  const rollbackTarget = state.previousDir;

  if (!rollbackTarget) {
    const msg = "No previous build dir in state. Cannot rollback automatically.";
    log.error(msg);
    return errResult(msg);
  }

  const distCheck = await runShell(`ls ${rollbackTarget}/dist/entry.js`, { timeoutMs: 5000 });
  if (!distCheck.ok) {
    const msg = `Previous dir ${rollbackTarget} has no dist/entry.js.`;
    log.error(msg);
    return errResult(msg);
  }
  step(`Rolling back to: ${rollbackTarget}`);

  const { ok: swapOk, log: swapLog } = await atomicSwapSymlink(cfg, rollbackTarget);
  step(swapLog);
  if (!swapOk) return errResult(steps.join("\n"));

  // Update state
  writeDeployState({
    ...state,
    activeDir: rollbackTarget,
    previousDir: state.activeDir,
    updatedAt: Date.now(),
  });

  // Deferred restart (same chat-safe pattern)
  const escapedCmd = restartCmd.replace(/'/g, "'\\''");
  const launchResult = await runShell(
    `nohup bash -c 'sleep 5 && ${escapedCmd}' >> ${DEVOPS_LOG_FILE} 2>&1 &`,
    { timeoutMs: 5000 },
  );
  step(launchResult.ok ? "✅ Deferred restart scheduled (~5s)" : `Restart: ${launchResult.stderr}`);

  step("");
  step("✅ Rollback initiated — gateway will restart in ~5 seconds.");
  step(`Check: devops_deploy(status) after ~30s`);

  return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: true } };
}

// ── logs ──────────────────────────────────────────────────────────────────────

function deployLogs() {
  const lines = readRecentLogs(80);
  return {
    content: [{ type: "text" as const, text: `=== Deploy Log (last 80 lines) ===\n${lines}` }],
    details: { ok: true, logFile: DEVOPS_LOG_FILE },
  };
}

// ── cleanup ───────────────────────────────────────────────────────────────────

async function deployCleanup(cfg: DevOpsConfig) {
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;
  const state = readDeployState();
  log.info("manual cleanup", { active: state.activeDir, previous: state.previousDir });

  const steps: string[] = ["=== CLEANUP ==="];

  let entries: string[] = [];
  try {
    const { readdirSync, statSync } = await import("node:fs");
    entries = readdirSync(buildsDir)
      .map((n) => path.join(buildsDir, n))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  } catch {
    return errResult(`Cannot read builds dir: ${buildsDir}`);
  }

  const keep = new Set([state.activeDir, state.previousDir].filter(Boolean));
  let removed = 0;

  for (const dir of entries) {
    const realDir = fs.realpathSync(dir);
    if (keep.has(dir) || keep.has(realDir)) {
      steps.push(`KEEP   ${dir}`);
    } else {
      const result = await runShell(`rm -rf ${dir}`, { timeoutMs: 30_000 });
      if (result.ok) {
        steps.push(`REMOVE ${dir} ✅`);
        removed++;
      } else {
        steps.push(`REMOVE ${dir} ❌ ${result.stderr.slice(0, 100)}`);
      }
    }
  }

  steps.push(`\nDone: removed ${removed}, kept ${keep.size} (active + previous).`);
  log.info(`cleanup done`, { removed, kept: keep.size });

  return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: true, removed } };
}

// ── tag ───────────────────────────────────────────────────────────────────────

async function deployTag(sourceRepo: string, tagName?: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const tag = tagName ?? `snapshot-${ts}`;
  log.info(`tagging source repo: ${tag}`);
  const result = await runShell(`git tag ${tag}`, { cwd: sourceRepo, timeoutMs: 10_000 });
  return {
    content: [{
      type: "text" as const,
      text: result.ok
        ? `✅ Tagged source repo HEAD as '${tag}'`
        : `❌ Tagging failed\n${formatResult(result)}`,
    }],
    details: { ok: result.ok, tag },
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function errResult(message: string) {
  log.error(message);
  return {
    content: [{ type: "text" as const, text: `devops_deploy error: ${message}` }],
    details: { ok: false, error: message },
  };
}
