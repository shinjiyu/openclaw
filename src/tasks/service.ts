import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/config.js";
import type { Task, TaskCreate, TaskEvent } from "./types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { resolveFreshSessionTotalTokens } from "../config/sessions/types.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  countActiveTasks,
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "./store.js";
import { resolveTaskStorePath } from "./paths.js";

const log = createSubsystemLogger("tasks/service");

/** How often the worker loop wakes up to check for queued tasks (ms). */
const WORKER_POLL_INTERVAL_MS = 3_000;

/** Max concurrent task executions. */
const MAX_CONCURRENT_TASKS = 3;

export type TaskServiceDeps = {
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
};

type RunningEntry = {
  taskId: string;
  storePath: string;
  abortController: AbortController;
};

export class TaskService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = new Map<string, RunningEntry>();
  private stopped = false;
  private serviceDeps: TaskServiceDeps;

  constructor(deps: TaskServiceDeps) {
    this.serviceDeps = deps;
  }

  // ── public lifecycle ───────────────────────────────────────────────────────

  start() {
    if (this.stopped) {
      return;
    }
    log.info("task service starting");
    this.armTimer();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info("task service stopped");
  }

  // ── public task management ─────────────────────────────────────────────────

  createTask(input: TaskCreate & { agentId?: string }): Task {
    const cfg = loadConfig();
    const agentId = input.agentId?.trim() || resolveDefaultAgentId(cfg);
    const storePath = resolveTaskStorePath(agentId);
    const task = createTask(storePath, { ...input, agentId });
    this.emit({ action: "created", taskId: task.id, task });
    log.info("task created", { taskId: task.id, agentId });
    // Wake the worker immediately.
    this.armTimer(100);
    return task;
  }

  listTasks(opts?: {
    status?: Task["status"] | Task["status"][];
    limit?: number;
    agentId?: string;
  }): Task[] {
    const cfg = loadConfig();
    const agentId = opts?.agentId ?? resolveDefaultAgentId(cfg);
    const storePath = resolveTaskStorePath(agentId);
    return listTasks(storePath, { ...opts, agentId });
  }

  getTask(taskId: string, agentId?: string): Task | undefined {
    const cfg = loadConfig();
    const resolvedAgentId = agentId ?? resolveDefaultAgentId(cfg);
    const storePath = resolveTaskStorePath(resolvedAgentId);
    return getTask(storePath, taskId);
  }

  cancelTask(taskId: string, agentId?: string): boolean {
    const cfg = loadConfig();
    const resolvedAgentId = agentId ?? resolveDefaultAgentId(cfg);
    const storePath = resolveTaskStorePath(resolvedAgentId);
    const task = getTask(storePath, taskId);
    if (!task) {
      return false;
    }
    if (task.status === "queued") {
      updateTask(storePath, taskId, { status: "cancelled", completedAt: Date.now() });
      this.emit({ action: "finished", taskId, status: "cancelled" });
      return true;
    }
    if (task.status === "running") {
      const entry = this.running.get(taskId);
      entry?.abortController.abort();
      return true;
    }
    return false;
  }

  getActiveCount(): number {
    return this.running.size;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private armTimer(delayMs = WORKER_POLL_INTERVAL_MS) {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        log.error("task worker tick error", { err: String(err) });
      }
    }, delayMs);
  }

  private async tick() {
    if (this.stopped) {
      return;
    }
    const available = MAX_CONCURRENT_TASKS - this.running.size;
    if (available <= 0) {
      this.armTimer();
      return;
    }

    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const storePath = resolveTaskStorePath(agentId);

    const queued = listTasks(storePath, { status: "queued", limit: available });
    for (const task of queued) {
      if (this.running.size >= MAX_CONCURRENT_TASKS) {
        break;
      }
      void this.executeTask(task, cfg, storePath);
    }

    this.armTimer();
  }

  private async executeTask(task: Task, cfg: OpenClawConfig, storePath: string) {
    const startedAt = Date.now();
    const abortController = new AbortController();
    this.running.set(task.id, { taskId: task.id, storePath, abortController });

    // Mark running.
    updateTask(storePath, task.id, { status: "running", startedAt });
    this.emit({ action: "started", taskId: task.id });
    log.info("task started", { taskId: task.id, agentId: task.agentId });

    try {
      const fakeJob = buildFakeJob(task);
      const sessionKey = `task:${task.id}`;
      const result = await runCronIsolatedAgentTurn({
        cfg,
        deps: this.serviceDeps.deps,
        job: fakeJob,
        message: task.message,
        sessionKey,
        agentId: task.agentId,
        lane: "task",
      });

      const durationMs = Date.now() - startedAt;

      // Read token usage from the isolated session.
      const tokenUsage = readSessionTokens(cfg, task.agentId, sessionKey);

      const finalStatus = result.status === "ok" ? "completed" : "failed";
      const patch: Partial<Task> = {
        status: finalStatus,
        completedAt: Date.now(),
        result: result.outputText ?? result.summary,
        error: result.error,
        ...tokenUsage,
      };
      updateTask(storePath, task.id, patch);
      this.emit({
        action: "finished",
        taskId: task.id,
        status: finalStatus,
        result: patch.result,
        error: patch.error,
        durationMs,
        totalTokens: patch.totalTokens,
      });
      log.info("task finished", { taskId: task.id, status: finalStatus, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = String(err);
      updateTask(storePath, task.id, {
        status: "failed",
        completedAt: Date.now(),
        error: errorMsg,
      });
      this.emit({
        action: "finished",
        taskId: task.id,
        status: "failed",
        error: errorMsg,
        durationMs,
      });
      log.error("task execution error", { taskId: task.id, err: errorMsg, durationMs });
    } finally {
      this.running.delete(task.id);
    }
  }

  private emit(evt: TaskEvent) {
    try {
      this.serviceDeps.broadcast("task", evt, { dropIfSlow: false });
    } catch {
      // broadcast errors are non-fatal
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal CronJob-shaped object that runCronIsolatedAgentTurn accepts. */
function buildFakeJob(task: Task) {
  return {
    id: task.id,
    agentId: task.agentId,
    name: `task:${task.id}`,
    enabled: true,
    createdAtMs: task.createdAt,
    updatedAtMs: task.createdAt,
    schedule: { kind: "at" as const, at: new Date(task.createdAt).toISOString() },
    sessionTarget: "isolated" as const,
    wakeMode: "now" as const,
    payload: {
      kind: "agentTurn" as const,
      message: task.message,
      model: task.model,
      thinking: task.thinking,
      timeoutSeconds: task.timeoutSeconds,
      deliver: Boolean(task.originChannel && task.originTo),
      channel: task.originChannel,
      to: task.originTo,
    },
    delivery: task.originChannel && task.originTo
      ? {
          mode: "announce" as const,
          channel: task.originChannel as import("../cron/types.js").CronMessageChannel,
          to: task.originTo,
          bestEffort: true,
        }
      : undefined,
    state: {},
  };
}

/** Read token usage from the isolated session created for this task. */
function readSessionTokens(
  cfg: OpenClawConfig,
  agentId: string,
  sessionKey: string,
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } {
  try {
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    const entry = store[`agent:${agentId}:${sessionKey}`] ?? store[sessionKey];
    if (!entry) {
      return {};
    }
    const total = resolveFreshSessionTotalTokens(entry);
    return {
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: total ?? entry.totalTokens,
    };
  } catch {
    return {};
  }
}
