import { Type } from "@sinclair/typebox";
import {
  compileBuildDir,
  createBuildDir,
  installBuildDir,
  readDeployState,
  writeDeployState,
} from "./build-dir.js";
import { createLogger } from "./logger.js";
import { formatResult, runShell } from "./run.js";
import type { DevOpsConfig } from "./types.js";
import {
  SANDBOX_CONFIG_DIR_DEFAULT,
  SANDBOX_CONTAINER_NAME,
  SANDBOX_IMAGE_TAG,
  SANDBOX_PORT_DEFAULT,
} from "./types.js";

const log = createLogger("sandbox");

export function createSandboxTool(cfg: DevOpsConfig) {
  const sandboxPort = cfg.sandboxPort ?? SANDBOX_PORT_DEFAULT;
  const sandboxConfigDir = cfg.sandboxConfigDir ?? SANDBOX_CONFIG_DIR_DEFAULT;

  return {
    name: "devops_sandbox",
    label: "DevOps Sandbox",
    description: [
      "Manage an isolated build + Docker sandbox environment for testing code changes.",
      "SAFE: all modifications happen in a temp build dir, never touching the running production source.",
      "Actions:",
      "create — clone source repo into a fresh isolated build dir (returns buildDir path).",
      "build — build Docker sandbox image from a build dir (runs pnpm build inside Docker).",
      "start — run sandbox container on port 18790 (isolated config).",
      "health — wait for sandbox gateway to be ready.",
      "test — run pnpm test inside sandbox container.",
      "exec — run arbitrary command inside sandbox container.",
      "stop — destroy sandbox container.",
      "status — show current sandbox and deploy state.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "One of: create | build | start | health | test | exec | stop | status",
      }),
      buildDir: Type.Optional(Type.String({
        description: "Path to the isolated build dir (from action=create). Required for build/start.",
      })),
      label: Type.Optional(Type.String({
        description: "Short label for the build dir name (for action=create).",
      })),
      command: Type.Optional(Type.String({
        description: "Command to run inside container (for action=exec).",
      })),
      timeoutSeconds: Type.Optional(Type.Number({
        description: "Timeout override (default: 60, build: 600).",
      })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as {
        action: string;
        buildDir?: string;
        label?: string;
        command?: string;
        timeoutSeconds?: number;
      };

      log.info(`action=${p.action}`, { buildDir: p.buildDir });
      switch (p.action?.trim()) {
        case "create":
          return sandboxCreate(cfg, p.label, p.timeoutSeconds);
        case "build":
          return sandboxBuild(p.buildDir, p.timeoutSeconds);
        case "start":
          return sandboxStart(p.buildDir, sandboxPort, sandboxConfigDir, p.timeoutSeconds);
        case "health":
          return sandboxHealth(sandboxPort, p.timeoutSeconds);
        case "test":
          return sandboxTest(p.timeoutSeconds);
        case "exec":
          return sandboxExec(p.command ?? "", p.timeoutSeconds);
        case "stop":
          return sandboxStop(p.timeoutSeconds);
        case "status":
          return sandboxStatus(sandboxPort);
        default:
          return errResult(`Unknown action '${p.action}'. Use: create | build | start | health | test | exec | stop | status`);
      }
    },
  };
}

// ── actions ───────────────────────────────────────────────────────────────────

async function sandboxCreate(cfg: DevOpsConfig, label?: string, timeoutSeconds?: number) {
  const steps: string[] = [];

  steps.push("Step 1/3: Cloning source repo into isolated build dir...");
  const { ok: cloneOk, buildDir: dir, log: cloneLog } = await createBuildDir(cfg, label);
  steps.push(cloneLog);
  if (!cloneOk) {
    return errResult(steps.join("\n"));
  }

  steps.push(`\nStep 2/3: Installing dependencies in ${dir}...`);
  const { ok: installOk, log: installLog } = await installBuildDir(dir);
  steps.push(installLog);
  if (!installOk) {
    log.warn("dep install had issues", { dir });
    steps.push("⚠️ Dependency install had issues — may be non-fatal (optional native deps)");
  }

  // Save sandbox dir in deploy state so other actions can find it
  const state = readDeployState();
  writeDeployState({ ...state, sandboxDir: dir, updatedAt: Date.now() });

  steps.push(`\n✅ Isolated build dir ready: ${dir}`);
  steps.push(`\nNext steps:`);
  steps.push(`  1. Modify source files: shell_exec(cwd="${dir}/src/...")`);
  steps.push(`  2. Build Docker image: devops_sandbox(build, buildDir="${dir}")`);
  steps.push(`  3. Start sandbox:      devops_sandbox(start, buildDir="${dir}")`);
  steps.push(`  4. Health check:       devops_sandbox(health)`);
  steps.push(`  5. Run tests:          devops_sandbox(test)`);
  steps.push(`  6. Promote:            devops_deploy(promote, buildDir="${dir}")`);
  steps.push(`\nAll logs: devops_deploy(logs)`);

  return {
    content: [{ type: "text" as const, text: steps.join("\n") }],
    details: { ok: true, buildDir: dir },
  };
}

async function sandboxBuild(buildDirPath: string | undefined, timeoutSeconds?: number) {
  const dir = buildDirPath ?? readDeployState().sandboxDir;
  if (!dir) {
    return errResult("buildDir required (or run action=create first)");
  }
  const timeoutMs = (timeoutSeconds ?? 600) * 1000;
  const steps: string[] = [`Building from: ${dir}`];
  log.info("sandbox build start", { dir });

  // Step 1: TypeScript compile (pnpm build) inside the build dir
  steps.push("\nStep 1/2: TypeScript compile (pnpm build)...");
  const { ok: compileOk, log: compileLog } = await compileBuildDir(dir);
  steps.push(compileLog);
  if (!compileOk) {
    log.error("pnpm build failed", { dir });
    return {
      content: [{ type: "text" as const, text: `❌ TypeScript build failed\n${steps.join("\n")}` }],
      details: { ok: false, buildDir: dir },
    };
  }
  steps.push("✅ TypeScript build complete");

  // Step 2: Docker image build
  steps.push("\nStep 2/2: Docker image build...");
  const result = await runShell(
    `docker build -t ${SANDBOX_IMAGE_TAG} ${dir}`,
    { cwd: dir, timeoutMs },
  );
  steps.push(formatResult(result, "docker build").slice(0, 1500));

  if (!result.ok) {
    log.error("docker build failed", { dir, exitCode: result.exitCode });
  } else {
    log.info("sandbox image built", { dir, durationMs: result.durationMs });
  }

  return {
    content: [{
      type: "text" as const,
      text: result.ok
        ? `✅ Sandbox image built: ${SANDBOX_IMAGE_TAG}\n${steps.join("\n")}`
        : `❌ Docker build failed\n${steps.join("\n")}`,
    }],
    details: { ok: result.ok, buildDir: dir },
  };
}

async function sandboxStart(
  buildDirPath: string | undefined,
  sandboxPort: number,
  sandboxConfigDir: string,
  timeoutSeconds?: number,
) {
  const dir = buildDirPath ?? readDeployState().sandboxDir;
  if (!dir) {
    return errResult("buildDir required (or run action=create first)");
  }
  const timeoutMs = (timeoutSeconds ?? 60) * 1000;
  log.info("sandbox start", { dir, sandboxPort });

  await runShell(`mkdir -p ${sandboxConfigDir}`, { timeoutMs: 5000 });
  await runShell(`docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || true`, { timeoutMs: 10_000 });

  const runCmd = [
    "docker run -d",
    `--name ${SANDBOX_CONTAINER_NAME}`,
    "--env NODE_ENV=production",
    "--env OPENCLAW_SANDBOX=1",
    `-v ${sandboxConfigDir}:/root/.openclaw`,
    `-p 127.0.0.1:${sandboxPort}:18789`,
    SANDBOX_IMAGE_TAG,
    "node /app/dist/entry.js gateway run --port 18789 --bind loopback",
  ].join(" ");

  const result = await runShell(runCmd, { cwd: dir, timeoutMs });

  if (!result.ok) log.error("sandbox start failed", { exitCode: result.exitCode });
  else log.info("sandbox container started", { sandboxPort });

  return {
    content: [{
      type: "text" as const,
      text: result.ok
        ? `✅ Sandbox started on port ${sandboxPort} (source: ${dir})\nUse devops_sandbox(health) to wait for it to be ready.`
        : `❌ Failed to start sandbox\n${formatResult(result)}`,
    }],
    details: { ok: result.ok, sandboxPort, buildDir: dir },
  };
}

async function sandboxHealth(sandboxPort: number, timeoutSeconds?: number) {
  const maxWaitMs = (timeoutSeconds ?? 40) * 1000;
  const start = Date.now();
  log.info("health poll start", { sandboxPort, maxWaitSecs: maxWaitMs / 1000 });

  while (Date.now() - start < maxWaitMs) {
    const elapsed = Date.now() - start;
    const containerLogs = await runShell(
      `docker logs --tail 15 ${SANDBOX_CONTAINER_NAME} 2>&1`,
      { timeoutMs: 5000 },
    );
    if (containerLogs.stdout.includes("listening on")) {
      log.info("sandbox gateway ready", { waitedMs: elapsed });
      return {
        content: [{ type: "text" as const, text: `✅ Sandbox gateway ready on port ${sandboxPort} (${elapsed}ms)` }],
        details: { ok: true, waitedMs: elapsed },
      };
    }
    if (containerLogs.stdout.toLowerCase().includes("exited") || containerLogs.stdout.includes("Error:")) {
      log.error("sandbox container crashed", { logs: containerLogs.stdout.slice(-200) });
      return {
        content: [{ type: "text" as const, text: `❌ Sandbox container crashed:\n${containerLogs.stdout.slice(-500)}` }],
        details: { ok: false },
      };
    }
    log.debug(`health: not ready yet (${elapsed}ms elapsed)`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const finalLogs = await runShell(`docker logs --tail 25 ${SANDBOX_CONTAINER_NAME} 2>&1`, { timeoutMs: 5000 });
  log.warn("sandbox health timeout", { maxWaitMs });
  return {
    content: [{ type: "text" as const, text: `❌ Sandbox not ready after ${maxWaitMs / 1000}s\nLogs:\n${finalLogs.stdout}` }],
    details: { ok: false },
  };
}

async function sandboxTest(timeoutSeconds?: number) {
  const timeoutMs = (timeoutSeconds ?? 300) * 1000;
  const result = await runShell(
    `docker exec ${SANDBOX_CONTAINER_NAME} sh -c "cd /app && node node_modules/.bin/vitest run --reporter=verbose 2>&1"`,
    { timeoutMs },
  );
  return {
    content: [{
      type: "text" as const,
      text: result.ok
        ? `✅ Tests passed\n${result.stdout.slice(0, 3000)}`
        : `❌ Tests failed (exit ${result.exitCode})\n${result.stdout.slice(0, 2000)}\n${result.stderr.slice(0, 500)}`,
    }],
    details: { ok: result.ok, exitCode: result.exitCode },
  };
}

async function sandboxExec(command: string, timeoutSeconds?: number) {
  if (!command) {
    return errResult("command is required for action=exec");
  }
  const timeoutMs = (timeoutSeconds ?? 60) * 1000;
  const result = await runShell(
    `docker exec ${SANDBOX_CONTAINER_NAME} sh -c ${JSON.stringify(command)}`,
    { timeoutMs },
  );
  return {
    content: [{ type: "text" as const, text: formatResult(result, `exec: ${command.slice(0, 50)}`) }],
    details: { ok: result.ok, exitCode: result.exitCode },
  };
}

async function sandboxStop(timeoutSeconds?: number) {
  const timeoutMs = (timeoutSeconds ?? 30) * 1000;
  const result = await runShell(
    `docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || echo "container not running"`,
    { timeoutMs },
  );
  return {
    content: [{ type: "text" as const, text: `Sandbox stopped.\n${formatResult(result)}` }],
    details: { ok: true },
  };
}

async function sandboxStatus(sandboxPort: number) {
  const state = readDeployState();
  const [inspect, port] = await Promise.all([
    runShell(`docker inspect ${SANDBOX_CONTAINER_NAME} --format '{{.State.Status}} started={{.State.StartedAt}}'`, { timeoutMs: 10_000 }),
    runShell(`ss -ltnp 2>/dev/null | grep ${sandboxPort} || echo "port not listening"`, { timeoutMs: 5000 }),
  ]);

  return {
    content: [{
      type: "text" as const,
      text: [
        `Sandbox dir: ${state.sandboxDir ?? "(none — run action=create first)"}`,
        `Active production dir: ${state.activeDir ?? "(initial install — not yet managed)"}`,
        `Container: ${inspect.ok ? inspect.stdout : "not found"}`,
        `Port ${sandboxPort}: ${port.stdout}`,
      ].join("\n"),
    }],
    details: { ok: true, state },
  };
}

function errResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `devops_sandbox error: ${message}` }],
    details: { ok: false, error: message },
  };
}
