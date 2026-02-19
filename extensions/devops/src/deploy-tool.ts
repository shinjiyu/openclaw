import { Type } from "@sinclair/typebox";
import { formatResult, runShell } from "./run.js";
import type { DevOpsConfig } from "./types.js";
import {
  AUTO_ROLLBACK_SECONDS_DEFAULT,
  PRODUCTION_PATH_DEFAULT,
  SANDBOX_CONTAINER_NAME,
} from "./types.js";

export function createDeployTool(cfg: DevOpsConfig) {
  const productionPath = cfg.productionPath ?? PRODUCTION_PATH_DEFAULT;
  const autoRollbackSeconds = cfg.autoRollbackSeconds ?? AUTO_ROLLBACK_SECONDS_DEFAULT;

  return {
    name: "devops_deploy",
    label: "DevOps Deploy",
    description: [
      "Promote sandbox changes to production or rollback to previous version.",
      "Actions:",
      "status — show current git HEAD, last deployed tag, and gateway health.",
      "promote — merge current branch into main, rebuild production, restart gateway with watchdog.",
      "rollback — revert to last deployed-* git tag and restart gateway.",
      "tag — create a git tag at current HEAD (use before manual changes).",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "One of: status | promote | rollback | tag",
      }),
      branch: Type.Optional(Type.String({
        description: "Branch to merge from (for promote). Defaults to current HEAD branch.",
      })),
      tagName: Type.Optional(Type.String({
        description: "Tag name (for action=tag). Auto-generated if omitted.",
      })),
      force: Type.Optional(Type.Boolean({
        description: "Skip health-check confirmation for promote (not recommended).",
      })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as { action: string; branch?: string; tagName?: string; force?: boolean };
      const action = p.action?.trim();

      switch (action) {
        case "status":
          return deployStatus(productionPath);
        case "promote":
          return deployPromote(productionPath, p.branch, autoRollbackSeconds, p.force ?? false);
        case "rollback":
          return deployRollback(productionPath);
        case "tag":
          return deployTag(productionPath, p.tagName);
        default:
          return errResult(`Unknown action '${action}'. Use: status | promote | rollback | tag`);
      }
    },
  };
}

// ── actions ───────────────────────────────────────────────────────────────────

async function deployStatus(productionPath: string) {
  const [gitLog, lastTag, gwHealth, gwPid] = await Promise.all([
    runShell("git log --oneline -5", { cwd: productionPath, timeoutMs: 10_000 }),
    runShell("git tag --sort=-creatordate | grep deployed- | head -3", { cwd: productionPath, timeoutMs: 5000 }),
    runShell("curl -sf --max-time 3 http://127.0.0.1:18789/health 2>&1 || echo 'health endpoint not available'", { timeoutMs: 8000 }),
    runShell("ss -ltnp | grep 18789 | head -3", { timeoutMs: 5000 }),
  ]);

  return {
    content: [{
      type: "text" as const,
      text: [
        "=== Production Status ===",
        `Git log:\n${gitLog.stdout || gitLog.stderr}`,
        `Last deployed tags:\n${lastTag.stdout || "(none)"}`,
        `Gateway port 18789:\n${gwPid.stdout || "not listening"}`,
        `Health check:\n${gwHealth.stdout}`,
      ].join("\n\n"),
    }],
    details: { ok: true },
  };
}

async function deployTag(productionPath: string, tagName?: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tag = tagName ?? `deployed-${ts}`;
  const result = await runShell(`git tag ${tag}`, { cwd: productionPath, timeoutMs: 10_000 });
  return {
    content: [{
      type: "text" as const,
      text: result.ok ? `✅ Tagged current HEAD as '${tag}'` : `❌ Tagging failed\n${formatResult(result)}`,
    }],
    details: { ok: result.ok, tag },
  };
}

async function deployPromote(
  productionPath: string,
  branch: string | undefined,
  autoRollbackSeconds: number,
  force: boolean,
) {
  const steps: string[] = [];

  // 1. Determine branch to merge
  const branchResult = await runShell(
    branch ? `echo ${branch}` : "git rev-parse --abbrev-ref HEAD",
    { cwd: productionPath, timeoutMs: 5000 },
  );
  const sourceBranch = branch ?? branchResult.stdout.trim();
  steps.push(`Promoting branch: ${sourceBranch}`);

  // 2. Tag current HEAD as rollback point
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rollbackTag = `deployed-${ts}`;
  const tagResult = await runShell(`git tag ${rollbackTag}`, { cwd: productionPath, timeoutMs: 5000 });
  steps.push(tagResult.ok ? `✅ Rollback tag created: ${rollbackTag}` : `⚠️ Tag failed (continuing): ${tagResult.stderr}`);

  // 3. If we're not already on main, merge the branch
  const currentBranch = await runShell("git rev-parse --abbrev-ref HEAD", { cwd: productionPath, timeoutMs: 5000 });
  if (currentBranch.stdout.trim() !== "main" || (sourceBranch !== "HEAD" && sourceBranch !== "main")) {
    const mergeResult = await runShell(
      `git checkout main && git merge --no-ff ${sourceBranch} -m "deploy: merge ${sourceBranch}"`,
      { cwd: productionPath, timeoutMs: 30_000 },
    );
    if (!mergeResult.ok) {
      return errResult(`Git merge failed. Rolling back to ${rollbackTag}.\n${formatResult(mergeResult)}`);
    }
    steps.push(`✅ Merged ${sourceBranch} → main`);
  }

  // 4. Build production
  steps.push("Building production...");
  const buildResult = await runShell("pnpm build", { cwd: productionPath, timeoutMs: 300_000 });
  if (!buildResult.ok) {
    // Rollback git
    await runShell(`git reset --hard ${rollbackTag}`, { cwd: productionPath, timeoutMs: 15_000 });
    return errResult(`Build failed. Reverted to ${rollbackTag}.\n${formatResult(buildResult)}`);
  }
  steps.push("✅ Build complete");

  // 5. Restart gateway
  const restartResult = await runShell("systemctl restart openclaw-gateway", { timeoutMs: 15_000 });
  steps.push(restartResult.ok ? "✅ Gateway restarting..." : `⚠️ Restart command result: ${restartResult.stderr}`);

  if (force) {
    steps.push("⚠️ Skipping health check (force=true)");
    return {
      content: [{ type: "text" as const, text: steps.join("\n") }],
      details: { ok: true, tag: rollbackTag },
    };
  }

  // 6. Watchdog: wait for gateway to come up
  steps.push(`Waiting up to ${autoRollbackSeconds}s for gateway health...`);
  const healthy = await waitForGatewayHealth(autoRollbackSeconds * 1000);

  if (healthy) {
    // 7. Clean up sandbox container if it was running
    await runShell(`docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || true`, { timeoutMs: 10_000 });
    steps.push("✅ Gateway is healthy — deploy complete!");
    steps.push(`Sandbox container cleaned up.`);
    return {
      content: [{ type: "text" as const, text: steps.join("\n") }],
      details: { ok: true, tag: rollbackTag },
    };
  }

  // 8. Auto-rollback
  steps.push(`❌ Gateway not healthy after ${autoRollbackSeconds}s — auto-rolling back to ${rollbackTag}`);
  const rbResult = await runShell(
    `git reset --hard ${rollbackTag} && pnpm build`,
    { cwd: productionPath, timeoutMs: 300_000 },
  );
  await runShell("systemctl restart openclaw-gateway", { timeoutMs: 15_000 });
  steps.push(rbResult.ok ? `✅ Rolled back to ${rollbackTag}` : `⚠️ Rollback build also had issues: ${rbResult.stderr.slice(0, 200)}`);

  return {
    content: [{ type: "text" as const, text: steps.join("\n") }],
    details: { ok: false, rolledBackTo: rollbackTag },
  };
}

async function deployRollback(productionPath: string) {
  const steps: string[] = [];

  // Find last deployed tag
  const tagResult = await runShell(
    "git tag --sort=-creatordate | grep deployed- | head -1",
    { cwd: productionPath, timeoutMs: 5000 },
  );
  const tag = tagResult.stdout.trim();
  if (!tag) {
    return errResult("No deployed-* tag found. Cannot rollback.");
  }
  steps.push(`Rolling back to: ${tag}`);

  // Reset to tag
  const resetResult = await runShell(`git reset --hard ${tag}`, { cwd: productionPath, timeoutMs: 15_000 });
  if (!resetResult.ok) {
    return errResult(`git reset failed\n${formatResult(resetResult)}`);
  }
  steps.push(`✅ Reset to ${tag}`);

  // Rebuild
  const buildResult = await runShell("pnpm build", { cwd: productionPath, timeoutMs: 300_000 });
  if (!buildResult.ok) {
    steps.push(`❌ Build failed\n${buildResult.stderr.slice(0, 300)}`);
    return {
      content: [{ type: "text" as const, text: steps.join("\n") }],
      details: { ok: false },
    };
  }
  steps.push("✅ Build complete");

  // Restart
  await runShell("systemctl restart openclaw-gateway", { timeoutMs: 15_000 });
  steps.push("✅ Gateway restarting...");

  const healthy = await waitForGatewayHealth(40_000);
  steps.push(healthy ? "✅ Gateway healthy — rollback complete!" : "⚠️ Gateway may still be starting, check manually.");

  return {
    content: [{ type: "text" as const, text: steps.join("\n") }],
    details: { ok: healthy, rolledBackTo: tag },
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForGatewayHealth(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const result = await runShell("ss -ltnp | grep 18789", { timeoutMs: 5000 });
    if (result.ok && result.stdout.includes("18789")) {
      return true;
    }
    // Also check journal for "listening on"
    const logs = await runShell("journalctl -u openclaw-gateway -n 5 --no-pager 2>/dev/null", { timeoutMs: 5000 });
    if (logs.stdout.includes("listening on")) {
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
