import { Type } from "@sinclair/typebox";
import { formatResult, runShell } from "./run.js";
import type { DevOpsConfig } from "./types.js";
import {
  PRODUCTION_PATH_DEFAULT,
  SANDBOX_CONFIG_DIR_DEFAULT,
  SANDBOX_CONTAINER_NAME,
  SANDBOX_IMAGE_TAG,
  SANDBOX_PORT_DEFAULT,
} from "./types.js";

export function createSandboxTool(cfg: DevOpsConfig) {
  const productionPath = cfg.productionPath ?? PRODUCTION_PATH_DEFAULT;
  const sandboxPort = cfg.sandboxPort ?? SANDBOX_PORT_DEFAULT;
  const sandboxConfigDir = cfg.sandboxConfigDir ?? SANDBOX_CONFIG_DIR_DEFAULT;

  return {
    name: "devops_sandbox",
    label: "DevOps Sandbox",
    description: [
      "Manage the Docker sandbox environment for testing openclaw code changes.",
      "Actions: build (build sandbox image from current source), start (run sandbox container on port sandboxPort),",
      "test (run pnpm test inside sandbox), health (check sandbox gateway is responding),",
      "exec (run a command inside sandbox container), stop (destroy sandbox container), status (inspect sandbox state).",
    ].join(" "),
    parameters: Type.Object({
      action: Type.String({
        description: "One of: build | start | stop | status | health | test | exec",
      }),
      command: Type.Optional(Type.String({
        description: "Command to run inside container (only for action=exec).",
      })),
      timeoutSeconds: Type.Optional(Type.Number({
        description: "Timeout for this operation. Default: 60 (build: 600).",
      })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as { action: string; command?: string; timeoutSeconds?: number };
      const action = p.action?.trim();

      switch (action) {
        case "build":
          return sandboxBuild(productionPath, p.timeoutSeconds);
        case "start":
          return sandboxStart(productionPath, sandboxPort, sandboxConfigDir, p.timeoutSeconds);
        case "stop":
          return sandboxStop(p.timeoutSeconds);
        case "status":
          return sandboxStatus(sandboxPort);
        case "health":
          return sandboxHealth(sandboxPort, p.timeoutSeconds);
        case "test":
          return sandboxTest(p.timeoutSeconds);
        case "exec":
          return sandboxExec(p.command ?? "", p.timeoutSeconds);
        default:
          return errResult(`Unknown action '${action}'. Use: build | start | stop | status | health | test | exec`);
      }
    },
  };
}

// ── actions ───────────────────────────────────────────────────────────────────

async function sandboxBuild(productionPath: string, timeoutSeconds?: number) {
  const timeoutMs = (timeoutSeconds ?? 600) * 1000;
  const result = await runShell(
    `docker build -t ${SANDBOX_IMAGE_TAG} .`,
    { cwd: productionPath, timeoutMs },
  );
  const text = formatResult(result, "docker build");
  return {
    content: [{ type: "text" as const, text: result.ok ? `✅ Sandbox image built: ${SANDBOX_IMAGE_TAG}\n${text}` : `❌ Build failed\n${text}` }],
    details: { ok: result.ok, exitCode: result.exitCode },
  };
}

async function sandboxStart(
  productionPath: string,
  sandboxPort: number,
  sandboxConfigDir: string,
  timeoutSeconds?: number,
) {
  const timeoutMs = (timeoutSeconds ?? 60) * 1000;

  // Ensure sandbox config dir exists
  await runShell(`mkdir -p ${sandboxConfigDir}`, { timeoutMs: 5000 });

  // Remove any existing sandbox container
  await runShell(`docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || true`, { timeoutMs: 10_000 });

  const runCmd = [
    "docker run -d",
    `--name ${SANDBOX_CONTAINER_NAME}`,
    `--env NODE_ENV=production`,
    `--env OPENCLAW_SANDBOX=1`,
    // Mount isolated config dir
    `-v ${sandboxConfigDir}:/root/.openclaw`,
    // Mount source read-only so we don't need to copy files each time
    `-v ${productionPath}:/app:ro`,
    // Expose gateway port on host
    `-p 127.0.0.1:${sandboxPort}:18789`,
    SANDBOX_IMAGE_TAG,
    "node /app/dist/entry.js gateway run --port 18789 --bind loopback",
  ].join(" ");

  const result = await runShell(runCmd, { cwd: productionPath, timeoutMs });
  const text = formatResult(result, "docker run");
  return {
    content: [{
      type: "text" as const,
      text: result.ok
        ? `✅ Sandbox container started on port ${sandboxPort}\n${text}\nUse devops_sandbox(health) to wait for it to be ready.`
        : `❌ Failed to start sandbox\n${text}`,
    }],
    details: { ok: result.ok, sandboxPort, containerName: SANDBOX_CONTAINER_NAME },
  };
}

async function sandboxStop(timeoutSeconds?: number) {
  const timeoutMs = (timeoutSeconds ?? 30) * 1000;
  const result = await runShell(
    `docker rm -f ${SANDBOX_CONTAINER_NAME} 2>/dev/null || echo "container not running"`,
    { timeoutMs },
  );
  return {
    content: [{ type: "text" as const, text: `Sandbox stopped.\n${formatResult(result, "docker rm")}` }],
    details: { ok: true },
  };
}

async function sandboxStatus(sandboxPort: number) {
  const [inspect, port] = await Promise.all([
    runShell(`docker inspect ${SANDBOX_CONTAINER_NAME} --format '{{.State.Status}} {{.State.StartedAt}}'`, { timeoutMs: 10_000 }),
    runShell(`ss -ltnp 2>/dev/null | grep ${sandboxPort} || echo "port not listening"`, { timeoutMs: 5000 }),
  ]);

  const status = inspect.ok ? inspect.stdout : "container not found";
  const portStatus = port.stdout;
  return {
    content: [{
      type: "text" as const,
      text: `Sandbox container: ${status}\nPort ${sandboxPort}: ${portStatus}`,
    }],
    details: { containerStatus: status, portStatus },
  };
}

async function sandboxHealth(sandboxPort: number, timeoutSeconds?: number) {
  const maxWaitMs = (timeoutSeconds ?? 30) * 1000;
  const start = Date.now();
  const interval = 3000;

  let lastError = "";
  while (Date.now() - start < maxWaitMs) {
    const result = await runShell(
      `curl -sf --max-time 3 http://127.0.0.1:${sandboxPort}/health 2>&1 || curl -sf --max-time 3 http://127.0.0.1:${sandboxPort}/ 2>&1`,
      { timeoutMs: 10_000 },
    );
    if (result.exitCode === 0 || result.stdout.includes("openclaw") || result.stdout.includes("gateway")) {
      return {
        content: [{ type: "text" as const, text: `✅ Sandbox gateway is healthy on port ${sandboxPort} (waited ${Date.now() - start}ms)` }],
        details: { ok: true, waitedMs: Date.now() - start },
      };
    }
    // Also check if container logs show "listening"
    const logs = await runShell(`docker logs --tail 10 ${SANDBOX_CONTAINER_NAME} 2>&1`, { timeoutMs: 5000 });
    if (logs.stdout.includes("listening on")) {
      return {
        content: [{ type: "text" as const, text: `✅ Sandbox gateway started (listening) on port ${sandboxPort}` }],
        details: { ok: true, waitedMs: Date.now() - start },
      };
    }
    lastError = result.stderr || result.stdout || "no response";
    await new Promise((r) => setTimeout(r, interval));
  }

  return {
    content: [{ type: "text" as const, text: `❌ Sandbox not healthy after ${maxWaitMs / 1000}s. Last error: ${lastError}` }],
    details: { ok: false, lastError },
  };
}

async function sandboxTest(timeoutSeconds?: number) {
  const timeoutMs = (timeoutSeconds ?? 300) * 1000;
  // Run tests inside the container (mounts source as /app)
  const result = await runShell(
    `docker exec ${SANDBOX_CONTAINER_NAME} sh -c "cd /app && node node_modules/.bin/vitest run --reporter=verbose 2>&1"`,
    { timeoutMs },
  );
  const passed = result.ok;
  return {
    content: [{
      type: "text" as const,
      text: passed
        ? `✅ Tests passed\n${result.stdout.slice(0, 3000)}`
        : `❌ Tests failed (exit ${result.exitCode})\n${result.stdout.slice(0, 2000)}\n${result.stderr.slice(0, 1000)}`,
    }],
    details: { ok: passed, exitCode: result.exitCode },
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

function errResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `devops_sandbox error: ${message}` }],
    details: { ok: false, error: message },
  };
}
