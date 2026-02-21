import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { appendAssistantMessageToSessionTranscript } from "../config/sessions/transcript.js";
import { resolveFreshSessionTotalTokens } from "../config/sessions/types.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveTaskStorePath } from "./paths.js";
import { createTask, getTask, listTasks, updateTask } from "./store.js";
import type { Task, TaskCreate, TaskEvent } from "./types.js";

const log = createSubsystemLogger("tasks/service");

/** How often the worker loop wakes up to check for queued tasks (ms). */
const WORKER_POLL_INTERVAL_MS = 3_000;

/** Max concurrent task executions. */
const MAX_CONCURRENT_TASKS = 3;

/**
 * Default timeout for background tasks when not specified by the caller (30 minutes).
 * Longer than the interactive agent default (10 min) because tasks run fully autonomously.
 */
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Watchdog: how much extra time beyond the task's own timeout before we force-fail it.
 * Guards against rare cases where the internal timeout fires but the promise stays alive.
 */
const WATCHDOG_GRACE_MS = 60_000;

/**
 * How many times to automatically retry a task that times out before marking it failed.
 */
const MAX_TASK_RETRIES = 2;

/**
 * Minimum task timeout enforced regardless of caller-specified timeoutSeconds.
 * Prevents overly aggressive timeouts (e.g. LLM choosing 60s for a complex task).
 */
const MIN_TASK_TIMEOUT_SECONDS = 120;

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
  /** Tasks whose abortController has already been triggered by the watchdog. */
  private abortTriggered = new Set<string>();
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
    // Recover tasks that were "running" when the gateway last shut down.
    // Re-queue them so they are picked up in the next tick.
    this.recoverStuckTasks();
    this.armTimer();
  }

  private recoverStuckTasks() {
    try {
      const cfg = loadConfig();
      const agentId = resolveDefaultAgentId(cfg);
      const storePath = resolveTaskStorePath(agentId);
      const stuck = listTasks(storePath, { status: "running" });
      for (const task of stuck) {
        // If we're not tracking it in memory (always true at startup), requeue.
        if (!this.running.has(task.id)) {
          log.warn("recovering stuck task: requeueing", { taskId: task.id });
          updateTask(storePath, task.id, { status: "queued", startedAt: undefined });
          this.emit({ action: "updated", taskId: task.id, originSessionKey: task.originSessionKey, patch: { status: "queued" } });
        }
      }
    } catch (err) {
      log.warn("failed to recover stuck tasks on startup", { err: String(err) });
    }
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
      this.emit({ action: "finished", taskId, status: "cancelled", originSessionKey: task.originSessionKey });
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

    // Periodic recovery: requeue any task that is "running" in the store but not in our
    // in-memory set (e.g. process was killed and restarted but recoverStuckTasks failed,
    // or store was left inconsistent). Prevents tasks from staying stuck "running" forever.
    this.recoverStuckTasks();

    // Watchdog: abort tasks that have been running longer than their timeout + grace period.
    const now = Date.now();
    for (const [taskId, entry] of this.running) {
      try {
        const task = getTask(entry.storePath, taskId);
        if (!task || !task.startedAt) {
          continue;
        }
        const timeoutMs =
          task.timeoutSeconds != null
            ? Math.max(task.timeoutSeconds * 1000, MIN_TASK_TIMEOUT_SECONDS * 1000)
            : DEFAULT_TASK_TIMEOUT_MS;
        const elapsed = now - task.startedAt;
        if (elapsed > timeoutMs + WATCHDOG_GRACE_MS && !this.abortTriggered.has(taskId)) {
          log.warn("watchdog: aborting task that exceeded timeout", {
            taskId,
            elapsed,
            timeoutMs,
          });
          this.abortTriggered.add(taskId);
          // Use TimeoutError name so attempt.ts onAbort classifies this as a timeout
          // (isTimeoutError checks for name === "TimeoutError").
          const watchdogErr = new Error("watchdog timeout exceeded");
          watchdogErr.name = "TimeoutError";
          entry.abortController.abort(watchdogErr);
        }
      } catch (err) {
        log.warn("watchdog check error", { taskId, err: String(err) });
      }
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
    this.emit({ action: "started", taskId: task.id, originSessionKey: task.originSessionKey });
    log.info("task started", { taskId: task.id, agentId: task.agentId });

    try {
      const fakeJob = buildFakeJob(task, DEFAULT_TASK_TIMEOUT_MS);
      const sessionKey = `task:${task.id}`;
      const result = await runCronIsolatedAgentTurn({
        cfg,
        deps: this.serviceDeps.deps,
        job: fakeJob,
        message: task.message,
        sessionKey,
        agentId: task.agentId,
        lane: "task",
        onAgentEvent: (evt) => {
          this.emit({ action: "progress", taskId: task.id, originSessionKey: task.originSessionKey, event: evt });
        },
        abortSignal: abortController.signal,
      });

      const durationMs = Date.now() - startedAt;

      // Read token usage from the isolated session.
      const tokenUsage = readSessionTokens(cfg, task.agentId, sessionKey);

      if (result.status === "error" && isRetriableError(result.error)) {
        if (shouldRetry(task)) {
          void this.requeueForRetry(task, storePath, result.error);
          return;
        }
      }

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
        originSessionKey: task.originSessionKey,
        result: patch.result,
        error: patch.error,
        durationMs,
        totalTokens: patch.totalTokens,
      });
      log.info("task finished", { taskId: task.id, status: finalStatus, durationMs });

      // Push completion summary back to the originating chat session.
      if (task.originSessionKey) {
        void this.pushTaskCompletionToChat(task, {
          status: finalStatus,
          result: patch.result,
          durationMs,
          totalTokens: patch.totalTokens,
        });
      }
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = String(err);

      if (isRetriableError(errorMsg) && shouldRetry(task)) {
        void this.requeueForRetry(task, storePath, errorMsg);
        return;
      }

      updateTask(storePath, task.id, {
        status: "failed",
        completedAt: Date.now(),
        error: errorMsg,
      });
      this.emit({
        action: "finished",
        taskId: task.id,
        status: "failed",
        originSessionKey: task.originSessionKey,
        error: errorMsg,
        durationMs,
      });
      log.error("task execution error", { taskId: task.id, err: errorMsg, durationMs });

      if (task.originSessionKey) {
        void this.pushTaskCompletionToChat(task, {
          status: "failed",
          error: errorMsg,
          durationMs,
        });
      }
    } finally {
      this.running.delete(task.id);
      this.abortTriggered.delete(task.id);
    }
  }

  /** Re-queue a task for retry after a retriable failure (e.g. timeout). */
  private async requeueForRetry(task: Task, storePath: string, error: string | undefined) {
    const retryCount = (task.retryCount ?? 0) + 1;
    log.info("task timed out — requeueing for retry", {
      taskId: task.id,
      attempt: retryCount,
      maxRetries: MAX_TASK_RETRIES,
      error,
    });
    updateTask(storePath, task.id, {
      status: "queued",
      startedAt: undefined,
      retryCount,
    });
    this.emit({
      action: "updated",
      taskId: task.id,
      originSessionKey: task.originSessionKey,
      patch: { status: "queued", retryCount },
    });
    // Wake the worker quickly so the retry is picked up without delay.
    this.armTimer(500);
  }

  private emit(evt: TaskEvent) {
    try {
      this.serviceDeps.broadcast("task", evt, { dropIfSlow: false });
    } catch {
      // broadcast errors are non-fatal
    }
  }

  /** Append a task completion/failure summary to the originating chat session transcript. */
  private async pushTaskCompletionToChat(
    task: Task,
    outcome: {
      status: "completed" | "failed";
      result?: string;
      error?: string;
      durationMs?: number;
      totalTokens?: number;
    },
  ): Promise<void> {
    if (!task.originSessionKey) {
      return;
    }
    try {
      const durationSec =
        outcome.durationMs !== undefined ? `${(outcome.durationMs / 1000).toFixed(1)}s` : undefined;
      const tokenInfo = outcome.totalTokens ? ` · ${outcome.totalTokens} tokens` : "";
      const durationInfo = durationSec ? ` · ${durationSec}` : "";

      let summaryText: string;
      if (outcome.status === "completed") {
        const resultSnippet = outcome.result
          ? `\n\n${outcome.result.slice(0, 500)}${outcome.result.length > 500 ? "…" : ""}`
          : "";
        summaryText = `[Task completed ✓${durationInfo}${tokenInfo}]${resultSnippet}`;
      } else {
        const errorSnippet = outcome.error
          ? `\n\nError: ${String(outcome.error).slice(0, 200)}`
          : "";
        summaryText = `[Task failed ✗${durationInfo}${tokenInfo}]${errorSnippet}`;
      }

      const pushResult = await appendAssistantMessageToSessionTranscript({
        sessionKey: task.originSessionKey,
        agentId: task.agentId,
        text: summaryText,
      });
      if (!pushResult.ok) {
        log.warn("task completion push failed", { taskId: task.id, reason: pushResult.reason });
      } else {
        log.info("task completion pushed to chat", {
          taskId: task.id,
          sessionKey: task.originSessionKey,
        });
      }
    } catch (err) {
      log.warn("task completion push error", { taskId: task.id, err: String(err) });
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when an error message indicates a transient failure that can be retried
 * (LLM timeout, watchdog abort, or network timeout).
 */
function isRetriableError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }
  const lower = error.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("watchdog") ||
    lower.includes("request timed out")
  );
}

/**
 * Returns true if the task has not yet exhausted its retry budget.
 */
function shouldRetry(task: Task): boolean {
  return (task.retryCount ?? 0) < MAX_TASK_RETRIES;
}

/** Build a minimal CronJob-shaped object that runCronIsolatedAgentTurn accepts. */
function buildFakeJob(task: Task, defaultTimeoutMs: number) {
  // Use task-specific timeout if set; fall back to the service-level default (longer than
  // the interactive agent default to accommodate autonomous long-running tasks).
  const resolvedTimeoutSeconds =
    task.timeoutSeconds != null && task.timeoutSeconds > 0
      ? Math.max(task.timeoutSeconds, MIN_TASK_TIMEOUT_SECONDS)
      : Math.round(defaultTimeoutMs / 1000);
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
      timeoutSeconds: resolvedTimeoutSeconds,
      deliver: Boolean(task.originChannel && task.originTo),
      channel: task.originChannel,
      to: task.originTo,
    },
    delivery:
      task.originChannel && task.originTo
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
