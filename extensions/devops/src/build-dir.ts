import fs from "node:fs";
import path from "node:path";
import { DEVOPS_DEPLOY_STATE_FILE, createLogger } from "./logger.js";
import { runShell } from "./run.js";
import { BUILDS_DIR_DEFAULT, SOURCE_REPO_DEFAULT } from "./types.js";
import type { DevOpsConfig } from "./types.js";

const log = createLogger("build-dir");

export type DeployState = {
  activeDir: string | null;
  previousDir: string | null;
  sandboxDir: string | null;
  updatedAt: number;
};

export function readDeployState(): DeployState {
  try {
    const raw = fs.readFileSync(DEVOPS_DEPLOY_STATE_FILE, "utf-8");
    return JSON.parse(raw) as DeployState;
  } catch {
    return { activeDir: null, previousDir: null, sandboxDir: null, updatedAt: 0 };
  }
}

export function writeDeployState(state: DeployState): void {
  fs.mkdirSync(path.dirname(DEVOPS_DEPLOY_STATE_FILE), { recursive: true });
  fs.writeFileSync(DEVOPS_DEPLOY_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  log.debug("deploy state saved", { activeDir: state.activeDir, previousDir: state.previousDir });
}

/**
 * Create a fresh isolated build directory by cloning the source repo locally.
 * Never modifies the running production source.
 */
export async function createBuildDir(
  cfg: DevOpsConfig,
  label?: string,
): Promise<{ ok: boolean; buildDir: string; log: string }> {
  const sourceRepo = cfg.sourceRepo ?? SOURCE_REPO_DEFAULT;
  const buildsDir = cfg.buildsDir ?? BUILDS_DIR_DEFAULT;

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const slug = label ? `-${label.replace(/[^a-z0-9]/gi, "-").slice(0, 20)}` : "";
  const buildDir = path.join(buildsDir, `${ts}${slug}`);

  log.info("creating build dir", { sourceRepo, buildDir });

  const mkResult = await runShell(`mkdir -p ${buildsDir}`, { timeoutMs: 5000 });
  if (!mkResult.ok) {
    const msg = `mkdir failed: ${mkResult.stderr}`;
    log.error(msg);
    return { ok: false, buildDir, log: msg };
  }

  // Clone locally (fast — shares git objects, no network needed)
  const cloneResult = await runShell(
    `git clone --local --no-hardlinks ${sourceRepo} ${buildDir}`,
    { cwd: buildsDir, timeoutMs: 60_000 },
  );
  if (!cloneResult.ok) {
    const msg = `git clone failed: ${cloneResult.stderr.slice(0, 300)}`;
    log.error(msg);
    return { ok: false, buildDir, log: msg };
  }

  log.info("build dir created", { buildDir, durationMs: cloneResult.durationMs });
  return { ok: true, buildDir, log: `Build dir created: ${buildDir} (${cloneResult.durationMs}ms)` };
}

/**
 * Install dependencies inside a build dir.
 * Uses --ignore-scripts to avoid native build failures (llama-cpp etc.).
 */
export async function installBuildDir(buildDir: string): Promise<{ ok: boolean; log: string }> {
  log.info("installing deps", { buildDir });
  const result = await runShell(
    "pnpm install --frozen-lockfile --ignore-scripts",
    { cwd: buildDir, timeoutMs: 300_000 },
  );
  if (result.ok) {
    log.info("deps installed", { buildDir, durationMs: result.durationMs });
    return { ok: true, log: `deps installed (${result.durationMs}ms)` };
  }
  log.warn("dep install issues (may be non-fatal)", { stderr: result.stderr.slice(0, 200) });
  return { ok: false, log: result.stderr.slice(0, 500) };
}

/**
 * Build TypeScript + UI inside a build dir.
 */
export async function compileBuildDir(buildDir: string): Promise<{ ok: boolean; log: string }> {
  log.info("building", { buildDir });
  const result = await runShell("pnpm build", { cwd: buildDir, timeoutMs: 300_000 });
  if (result.ok) {
    log.info("build complete", { buildDir, durationMs: result.durationMs });
    return { ok: true, log: `build complete (${result.durationMs}ms)` };
  }
  const errLog = `${result.stdout.slice(-400)}\n${result.stderr.slice(-400)}`;
  log.error("build failed", { buildDir, exitCode: result.exitCode });
  return { ok: false, log: errLog };
}

/**
 * Atomically swap the global npm symlink to point to a new build dir.
 * Returns the old target so callers can persist it for rollback.
 */
export async function atomicSwapSymlink(
  cfg: DevOpsConfig,
  newBuildDir: string,
): Promise<{ ok: boolean; oldTarget: string | null; log: string }> {
  const symlink = cfg.globalSymlink ?? "/usr/lib/node_modules/openclaw";

  const readResult = await runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 });
  const oldTarget = readResult.ok ? readResult.stdout.trim() : null;

  log.info("swapping symlink", { symlink, from: oldTarget, to: newBuildDir });

  // ln -sfn is atomic on Linux (rename(2) under the hood)
  const swapResult = await runShell(`ln -sfn ${newBuildDir} ${symlink}`, { timeoutMs: 5000 });
  if (!swapResult.ok) {
    const msg = `symlink swap failed: ${swapResult.stderr}`;
    log.error(msg);
    return { ok: false, oldTarget, log: msg };
  }

  // Verify
  const verifyResult = await runShell(`readlink -f ${symlink}`, { timeoutMs: 5000 });
  const newTarget = verifyResult.stdout.trim();
  if (newTarget !== newBuildDir) {
    const msg = `symlink verify mismatch: expected ${newBuildDir}, got ${newTarget}`;
    log.error(msg);
    return { ok: false, oldTarget, log: msg };
  }

  const msg = `Symlink: ${oldTarget ?? "?"} → ${newBuildDir}`;
  log.info("symlink swapped", { symlink, oldTarget, newBuildDir });
  return { ok: true, oldTarget, log: msg };
}
