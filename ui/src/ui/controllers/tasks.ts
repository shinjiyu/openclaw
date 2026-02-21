import type { GatewayBrowserClient } from "../gateway.ts";
import type { TasksStatusResult, UiTask } from "../views/tasks.ts";

export type TasksState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasksError: string | null;
  tasksStatus: TasksStatusResult | null;
  tasksList: UiTask[];
  tasksBusy: boolean;
  tasksCreateMessage: string;
  tasksCreateModel: string;
  tasksCreateThinking: string;
  tasksCreateOriginChannel: string;
  tasksCreateOriginTo: string;
};

export async function loadTasksStatus(state: TasksState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.tasksLoading = true;
  state.tasksError = null;
  try {
    const res = await state.client.request<TasksStatusResult>("tasks.status", {});
    state.tasksStatus = res;
    // Combine running + queued + recent for the full table.
    const seen = new Set<string>();
    const merged: UiTask[] = [];
    for (const t of [...(res.running ?? []), ...(res.queued ?? []), ...(res.recent ?? [])]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        merged.push(t as UiTask);
      }
    }
    state.tasksList = merged;
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksLoading = false;
  }
}

export async function createTask(state: TasksState) {
  if (!state.client || !state.connected || !state.tasksCreateMessage.trim()) {
    return;
  }
  state.tasksBusy = true;
  try {
    await state.client.request<{ task: UiTask }>("tasks.create", {
      message: state.tasksCreateMessage.trim(),
      model: state.tasksCreateModel.trim() || undefined,
      thinking: state.tasksCreateThinking || undefined,
      originChannel: state.tasksCreateOriginChannel.trim() || undefined,
      originTo: state.tasksCreateOriginTo.trim() || undefined,
    });
    // Clear form and refresh.
    state.tasksCreateMessage = "";
    state.tasksCreateModel = "";
    state.tasksCreateThinking = "";
    state.tasksCreateOriginChannel = "";
    state.tasksCreateOriginTo = "";
    await loadTasksStatus(state);
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksBusy = false;
  }
}

export async function cancelTask(state: TasksState, taskId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request<{ cancelled: boolean }>("tasks.cancel", { id: taskId });
    await loadTasksStatus(state);
  } catch (err) {
    state.tasksError = String(err);
  }
}

/** Handle a real-time `task` event pushed from the gateway. */
export function handleTaskEvent(
  state: TasksState,
  evt: { action: string; taskId: string; task?: UiTask; patch?: Partial<UiTask>; status?: string; result?: string; error?: string; totalTokens?: number },
) {
  if (evt.action === "created" && evt.task) {
    state.tasksList = [evt.task, ...state.tasksList];
    if (state.tasksStatus) {
      state.tasksStatus = {
        ...state.tasksStatus,
        queuedCount: state.tasksStatus.queuedCount + 1,
        queued: [evt.task, ...(state.tasksStatus.queued ?? [])],
      };
    }
    return;
  }

  const update = (fn: (t: UiTask) => UiTask) => {
    state.tasksList = state.tasksList.map((t) => (t.id === evt.taskId ? fn(t) : t));
  };

  if (evt.action === "started") {
    update((t) => ({ ...t, status: "running", startedAt: Date.now() }));
    if (state.tasksStatus) {
      state.tasksStatus = {
        ...state.tasksStatus,
        runningCount: (state.tasksStatus.runningCount ?? 0) + 1,
        queuedCount: Math.max(0, (state.tasksStatus.queuedCount ?? 0) - 1),
      };
    }
    return;
  }

  if (evt.action === "finished") {
    const finalStatus = (evt.status ?? "completed") as UiTask["status"];
    update((t) => ({
      ...t,
      status: finalStatus,
      completedAt: Date.now(),
      result: evt.result ?? t.result,
      error: evt.error ?? t.error,
      totalTokens: evt.totalTokens ?? t.totalTokens,
    }));
    if (state.tasksStatus) {
      state.tasksStatus = {
        ...state.tasksStatus,
        runningCount: Math.max(0, (state.tasksStatus.runningCount ?? 0) - 1),
        recentCount: (state.tasksStatus.recentCount ?? 0) + 1,
        totalTokens: (state.tasksStatus.totalTokens ?? 0) + (evt.totalTokens ?? 0),
      };
    }
    return;
  }
}
