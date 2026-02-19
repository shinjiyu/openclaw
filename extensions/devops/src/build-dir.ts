import fs from "node:fs";
import path from "node:path";
import { runShell } from "./run.js";
import { BUILDS_DIR_DEFAULT, DEPLOY_STATE_FILE, SOURCE_REPO_DEFAULT } from "./types.js";
import type { DevOpsConfig } from "./types.js";

export type DeployState = {
  activeDir: string | null;
  previousDir: string | null;
  sandboxDir: string | null;
  updatedAt: number;
};

export function readDeployState(): DeployState {
  try {
    const raw = fs.readFileSync(DEPLOY_STATE_FILE, "utf-8");
    return JSON.parse(raw) as DeployState;
  } catch {
    return { activeDir: null, previousDir: null, sandboxDir: null, updatedAt: 0 };
  }
}

export function writeDeployState(state: DeployState): void {
  fs.writeFileSync(DEPLOY_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Create a fresh isolated build directory by cloning the source repo locally.
 * Returns the path to the new build dir.
 */
export async function createBuildDir(cfg: DevOpsConfig, label?: string): Promise<{ ok: boolean; buildDir: string; log: string }> {
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const slug = label ? `-${label.replace(/[^a-z0-9]/gi, "-").slice(0, 20)}` : "";
  const buildDir = path.join(buildsDir, `${ts}${slug}`);

  // Ensure parent exists
  const mkResult = await runShell(`mkdir -p ${buildsDir}`, { timeoutMs: 5000 });
  if (!mkResult.ok) {
    return { ok: false, buildDir, log: `mkdir failed: ${mkResult.stderr}` };
  }

  // Clone from local source repo (fast, shares git objects)
  const cloneResult = await runShell(
    `git clone --local --no-hardlinks ${sourceRepo} ${buildDir}`,
    { cwd: buildsDir, timeoutMs: 60_000 },
  );
  if (!cloneResult.ok) {
    return { ok: false, buildDir, log: `git clone failed: ${cloneResult.stderr}` };
  }

  return { ok: true, buildDir, log: `Build dir created: ${buildDir}` };
}

/**
 * Install deps in the build dir (ignore-scripts to avoid native build failures).
 */
export async function installBuildDir(buildDir: string): Promise<{ ok: boolean; log: string }> {
  const result = await runShell(
    "pnpm install --frozen-lockfile --ignore-scripts",
    { cwd: buildDir, timeoutMs: 300_000 },
  );
  return { ok: result.ok, log: result.ok ? "deps installed" : result.stderr.slice(0, 500) };
}

/**
 * Build (compile TypeScript + UI) in the build dir.
 */
export async function buildDir(buildDir: string): Promise<{ ok: boolean; log: string }> {
  const result = await runShell("pnpm build", { cwd: buildDir, timeoutMs: 300_000 });
  return { ok: result.ok, log: result.ok ? "build complete" : `${result.stdout.slice(-500)}\n${result.stderr.slice(-500)}` };
}

/**
 * Atomically swap the global symlink to point to the new build dir.
 * Returns the old target for rollback.
 */
export async function atomicSwapSymlink(
  cfg: DevOpsConfig,
  newBuildDir: string,
): Promise<{ ok: boolean; oldTarget: string | null; log: string }> {
  const symlink = cfg.globalSymlink ?? "/usr/lib/node_modules/openclaw";

  // Read current target
  const readResult = await runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 });
  const oldTarget = readResult.ok ? readResult.stdout.trim() : null;

  // Atomic replace: ln -sfn creates new, replaces atomically
  const swapResult = await runShell(`ln -sfn ${newBuildDir} ${symlink}`, { timeoutMs: 5000 });
  if (!swapResult.ok) {
    return { ok: false, oldTarget, log: `symlink swap failed: ${swapResult.stderr}` };
  }

  // Verify
  const verifyResult = await runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 });
  const newTarget = verifyResult.stdout.trim();
  if (newTarget !== newBuildDir) {
    return { ok: false, oldTarget, log: `symlink verify failed: expected ${newBuildDir}, got ${newTarget}` };
  }

  return { ok: true, oldTarget, log: `Symlink swapped: ${oldTarget ?? "?"} → ${newBuildDir}` };
}

/**
 * Prune old build dirs, keeping only the last N.
 */
export async function pruneOldBuilds(cfg: DevOpsConfig, keepCount = 3): Promise<void> {
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;
  try {
    const entries = fs.readdirSync(buildsDir)
      .map((name) => path.join(buildsDir, name))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort(); // oldest first (timestamp prefix)

    const toDelete = entries.slice(0, Math.max(0, entries.length - keepCount));
    for (const dir of toDelete) {
      await runShell(`rm -rf ${dir}`, { timeoutMs: 30_000 });
    }
  } catch {
    // non-fatal
  }
}
