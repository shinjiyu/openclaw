import { Type } from "@sinclair/typebox";
import {
  atomicSwapSymlink,
  pruneOldBuilds,
  readDeployState,
  writeDeployState,
} from "./build-dir.js";
import { formatResult, runShell } from "./run.js";
import type { DevOpsConfig } from "./types.js";
import {
  AUTO_ROLLBACK_SECONDS_DEFAULT,
  SANDBOX_CONTAINER_NAME,
  SOURCE_REPO_DEFAULT,
} from "./types.js";

export function createDeployTool(cfg: DevOpsConfig) {
  const autoRollbackSeconds = cfg.autoRollbackSeconds ?? AUTO_ROLLBACK_SECONDS_DEFAULT;
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;

  return {
    name: "devops_deploy",
    label: "DevOps Deploy",
    description: [
      "Promote a tested build dir to production or rollback to the previous version.",
      "SAFE: uses atomic symlink swap — the running process is never touched mid-flight.",
      "Actions:",
      "status — show production symlink target, git log, and gateway health.",
      "promote — swap symlink to new build dir, restart gateway, watchdog verifies health.",
      "          Fails gracefully: reverts symlink + restarts if health check fails.",
      "rollback — swap symlink back to previous build dir and restart gateway.",
      "cleanup — remove old build dirs keeping last 3.",
      "tag — create a git tag in the source repo at current HEAD.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "One of: status | promote | rollback | cleanup | tag",
      }),
      buildDir: Type.Optional(Type.String({
        description: "Build dir to promote (for action=promote). Uses last sandbox dir if omitted.",
      })),
      tagName: Type.Optional(Type.String({
        description: "Tag name for action=tag. Auto-generated if omitted.",
      })),
      force: Type.Optional(Type.Boolean({
        description: "Skip health-check confirmation for promote (not recommended).",
      })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as {
        action: string;
        buildDir?: string;
        tagName?: string;
        force?: boolean;
      };

      switch (p.action?.trim()) {
        case "status":
          return deployStatus(cfg, sourceRepo);
        case "promote":
          return deployPromote(cfg, p.buildDir, autoRollbackSeconds, p.force ?? false);
        case "rollback":
          return deployRollback(cfg);
        case "cleanup":
          return deployCleanup(cfg);
        case "tag":
          return deployTag(sourceRepo, p.tagName);
        default:
          return errResult(`Unknown action '${p.action}'. Use: status | promote | rollback | cleanup | tag`);
      }
    },
  };
}

// ── actions ───────────────────────────────────────────────────────────────────

async function deployStatus(cfg: DevOpsConfig, sourceRepo: string) {
  const state = readDeployState();
  const symlink = cfg.globalSymlink ?? "/usr/lib/node_modules/openclaw";

  const [symlinkTarget, gitLog, gwPort] = await Promise.all([
    runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 }),
    runShell("git log --oneline -5", { cwd: sourceRepo, timeoutMs: 10_000 }),
    runShell("ss -ltnp | grep 18789 | head -2", { timeoutMs: 5000 }),
  ]);

  const lines = [
    "=== Production Deploy Status ===",
    `Symlink (${symlink}):`,
    `  → ${symlinkTarget.stdout || "(not a symlink or not found)"}`,
    "",
    `Deploy state:`,
    `  active:   ${state.activeDir ?? "(unmanaged)"}`,
    `  previous: ${state.previousDir ?? "(none)"}`,
    `  sandbox:  ${state.sandboxDir ?? "(none)"}`,
    "",
    `Source repo (${sourceRepo}) git log:`,
    gitLog.stdout || gitLog.stderr,
    "",
    `Gateway port 18789:`,
    gwPort.stdout || "not listening",
  ];

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { ok: true, state },
  };
}

async function deployPromote(
  cfg: DevOpsConfig,
  buildDirPath: string | undefined,
  autoRollbackSeconds: number,
  force: boolean,
) {
  const steps: string[] = [];

  // Resolve the build dir to promote
  const state = readDeployState();
  const targetDir = buildDirPath ?? state.sandboxDir;
  if (!targetDir) {
    return errResult("No buildDir specified and no sandbox dir in state. Run devops_sandbox(create) first.");
  }
  steps.push(`Promoting: ${targetDir}`);

  // Verify the build dir has dist/entry.js (was built)
  const distCheck = await runShell(`ls ${targetDir}/dist/entry.js`, { timeoutMs: 5000 });
  if (!distCheck.ok) {
    return errResult(`Build dir ${targetDir} has no dist/entry.js — run devops_sandbox(build) first.`);
  }
  steps.push("✅ Build artifacts verified (dist/entry.js exists)");

  // Read current symlink target before swapping (for rollback)
  const { ok: swapOk, oldTarget, log: swapLog } = await atomicSwapSymlink(cfg, targetDir);
  steps.push(swapLog);
  if (!swapOk) {
    return errResult(`Symlink swap failed.\n${steps.join("\n")}`);
  }

  // Update deploy state
  const newState = {
    activeDir: targetDir,
    previousDir: state.activeDir ?? oldTarget,
    sandboxDir: state.sandboxDir,
    updatedAt: Date.now(),
  };
  writeDeployState(newState);
  steps.push(`Deploy state saved. Previous: ${newState.previousDir}`);

  // Tag the source repo at current HEAD for audit trail
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  await runShell(`git tag promoted-${ts} 2>/dev/null || true`, { cwd: sourceRepo, timeoutMs: 5000 });
  steps.push(`Tagged source repo: promoted-${ts}`);

  // Restart gateway
  const restartResult = await runShell("systemctl restart openclaw-gateway", { timeoutMs: 15_000 });
  steps.push(restartResult.ok ? "✅ Gateway restarting..." : `⚠️ Restart: ${restartResult.stderr.slice(0, 100)}`);

  if (force) {
    steps.push("⚠️ force=true: skipping health check");
    return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: true, activeDir: targetDir } };
  }

  // Watchdog
  steps.push(`Waiting up to ${autoRollbackSeconds}s for gateway health...`);
  const healthy = await waitForGateway(autoRollbackSeconds * 1000);

  if (healthy) {
    // Clean up sandbox container
    await runShell(`docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || true`, { timeoutMs: 10_000 });
    steps.push("✅ Gateway healthy — promotion complete!");
    steps.push("Sandbox container cleaned up.");
    return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: true, activeDir: targetDir } };
  }

  // Auto-rollback
  steps.push(`❌ Gateway not healthy after ${autoRollbackSeconds}s — AUTO ROLLBACK`);
  const rbSteps = await doRollback(cfg);
  steps.push(...rbSteps);

  return { content: [{ type: "text" as const, text: steps.join("\n") }], details: { ok: false } };
}

async function deployRollback(cfg: DevOpsConfig) {
  const steps = await doRollback(cfg);
  const ok = steps.some((s) => s.includes("✅"));
  return {
    content: [{ type: "text" as const, text: steps.join("\n") }],
    details: { ok },
  };
}

async function doRollback(cfg: DevOpsConfig): Promise<string[]> {
  const steps: string[] = ["=== ROLLBACK ==="];
  const state = readDeployState();

  const rollbackTarget = state.previousDir;
  if (!rollbackTarget) {
    steps.push("❌ No previous build dir recorded in state — cannot auto-rollback.");
    steps.push("You can manually run: ln -sfn <old-dir> /usr/lib/node_modules/openclaw && systemctl restart openclaw-gateway");
    return steps;
  }

  steps.push(`Rolling back to: ${rollbackTarget}`);

  // Verify rollback target still exists and has dist
  const distCheck = await runShell(`ls ${rollbackTarget}/dist/entry.js`, { timeoutMs: 5000 });
  if (!distCheck.ok) {
    steps.push(`❌ Rollback target ${rollbackTarget} has no dist/entry.js`);
    return steps;
  }

  const { ok: swapOk, log: swapLog } = await atomicSwapSymlink(cfg, rollbackTarget);
  steps.push(swapLog);
  if (!swapOk) {
    return steps;
  }

  // Update state
  const currentActive = state.activeDir;
  writeDeployState({
    ...state,
    activeDir: rollbackTarget,
    previousDir: currentActive,
    updatedAt: Date.now(),
  });

  const restartResult = await runShell("systemctl restart openclaw-gateway", { timeoutMs: 15_000 });
  steps.push(restartResult.ok ? "✅ Gateway restarting..." : `Restart: ${restartResult.stderr.slice(0, 100)}`);

  const healthy = await waitForGateway(40_000);
  steps.push(healthy ? "✅ Rollback complete — gateway healthy!" : "⚠️ Gateway may still be starting, check manually.");

  return steps;
}

async function deployCleanup(cfg: DevOpsConfig) {
  await pruneOldBuilds(cfg, 3);
  const state = readDeployState();
  return {
    content: [{
      type: "text" as const,
      text: `Cleaned up old build dirs (kept last 3).\nActive: ${state.activeDir}\nPrevious: ${state.previousDir}`,
    }],
    details: { ok: true },
  };
}

async function deployTag(sourceRepo: string, tagName?: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const tag = tagName ?? `snapshot-${ts}`;
  const result = await runShell(`git tag ${tag}`, { cwd: sourceRepo, timeoutMs: 10_000 });
  return {
    content: [{
      type: "text" as const,
      text: result.ok ? `✅ Tagged source repo HEAD as '${tag}'` : `❌ Tagging failed\n${formatResult(result)}`,
    }],
    details: { ok: result.ok, tag },
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForGateway(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const logs = await runShell(
      "journalctl -u openclaw-gateway -n 5 --no-pager 2>/dev/null",
      { timeoutMs: 5000 },
    );
    if (logs.stdout.includes("listening on")) {
      return true;
    }
    const port = await runShell("ss -ltnp | grep 18789", { timeoutMs: 3000 });
    if (port.ok && port.stdout.includes("18789")) {
      return true;
    }
  }
  return false;
}

function errResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `devops_deploy error: ${message}` }],
    details: { ok: false, error: message },
  };
}
