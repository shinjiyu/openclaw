import { TaskService } from "../../tasks/service.js";
import type { GatewayRequestHandlers } from "./types.js";

/**
 * Gateway RPC handlers for the task system.
 * All methods require the `tasks` property on the request context, which is
 * injected by `buildGatewayTaskService` in `server.impl.ts`.
 */
export const tasksHandlers: GatewayRequestHandlers = {
  /** List tasks (optionally filtered by status/limit/agentId). */
  "tasks.list": ({ params, respond, context }) => {
    const svc = getTaskService(context);
    if (!svc) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "task service not available" });
      return;
    }
    const p = params as {
      status?: string | string[];
      limit?: number;
      agentId?: string;
    };
    const validStatuses = new Set(["queued", "running", "completed", "failed", "cancelled"]);
    const rawStatus = p.status;
    const status =
      rawStatus === undefined
        ? undefined
        : (Array.isArray(rawStatus) ? rawStatus : [rawStatus]).filter(
            (s): s is import("../../tasks/types.js").TaskStatus => validStatuses.has(s),
          );
    const tasks = svc.listTasks({
      status,
      limit: typeof p.limit === "number" ? p.limit : 100,
      agentId: typeof p.agentId === "string" ? p.agentId : undefined,
    });
    respond(true, { tasks, activeCount: svc.getActiveCount() }, undefined);
  },

  /** Get a single task by id. */
  "tasks.get": ({ params, respond, context }) => {
    const svc = getTaskService(context);
    if (!svc) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "task service not available" });
      return;
    }
    const p = params as { id?: string; agentId?: string };
    if (typeof p.id !== "string" || !p.id.trim()) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "id is required" });
      return;
    }
    const task = svc.getTask(p.id, p.agentId);
    if (!task) {
      respond(false, undefined, { code: "NOT_FOUND", message: `task ${p.id} not found` });
      return;
    }
    respond(true, { task }, undefined);
  },

  /** Create a new task (agent turn executed asynchronously). */
  "tasks.create": ({ params, respond, context }) => {
    const svc = getTaskService(context);
    if (!svc) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "task service not available" });
      return;
    }
    const p = params as {
      message?: string;
      agentId?: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      originSessionKey?: string;
      originChannel?: string;
      originTo?: string;
    };
    if (typeof p.message !== "string" || !p.message.trim()) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "message is required" });
      return;
    }
    const task = svc.createTask({
      message: p.message.trim(),
      agentId: typeof p.agentId === "string" ? p.agentId : undefined,
      model: p.model,
      thinking: p.thinking,
      timeoutSeconds: typeof p.timeoutSeconds === "number" ? p.timeoutSeconds : undefined,
      originSessionKey: p.originSessionKey,
      originChannel: p.originChannel,
      originTo: p.originTo,
    });
    respond(true, { task }, undefined);
  },

  /** Cancel a queued or running task. */
  "tasks.cancel": ({ params, respond, context }) => {
    const svc = getTaskService(context);
    if (!svc) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "task service not available" });
      return;
    }
    const p = params as { id?: string; agentId?: string };
    if (typeof p.id !== "string" || !p.id.trim()) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "id is required" });
      return;
    }
    const ok = svc.cancelTask(p.id, p.agentId);
    respond(
      ok,
      { cancelled: ok },
      ok ? undefined : { code: "NOT_FOUND", message: `task ${p.id} not found or not cancellable` },
    );
  },

  /** Return active task count and a summary of recent tasks.
   *
   * `result` and `error` fields are intentionally omitted from the response to
   * keep polling payloads small.  Callers that need the full outcome should
   * subscribe to the `task` WebSocket event (which carries result/error on
   * "finished") or call `tasks.get` for a specific task.
   */
  "tasks.status": ({ params: _params, respond, context }) => {
    const svc = getTaskService(context);
    if (!svc) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "task service not available" });
      return;
    }
    const running = svc.listTasks({ status: "running", limit: 50 });
    const queued = svc.listTasks({ status: "queued", limit: 50 });
    const recent = svc.listTasks({ status: ["completed", "failed", "cancelled"], limit: 20 });
    const totalTokens = [...running, ...recent].reduce((sum, t) => sum + (t.totalTokens ?? 0), 0);
    // Strip large text fields; callers receive result/error via the "task" WS event.
    const slim = (tasks: typeof running) =>
      tasks.map(({ result: _r, error: _e, ...rest }) => rest);
    respond(
      true,
      {
        activeCount: svc.getActiveCount(),
        queuedCount: queued.length,
        runningCount: running.length,
        recentCount: recent.length,
        totalTokens,
        running: slim(running),
        queued: slim(queued),
        recent: slim(recent),
      },
      undefined,
    );
  },
};

// ── helper ────────────────────────────────────────────────────────────────────

function getTaskService(context: Record<string, unknown>): TaskService | undefined {
  const svc = (context as { tasks?: TaskService }).tasks;
  return svc instanceof TaskService ? svc : undefined;
}
