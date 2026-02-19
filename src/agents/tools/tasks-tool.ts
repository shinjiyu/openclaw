import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGatewayTool } from "./gateway.js";

/**
 * Build the tasks_create tool.
 * @param originSessionKey When set (chat mode), automatically recorded so the task can push
 *   its completion summary back to this session transcript without the LLM needing to specify it.
 */
function buildTasksCreateTool(originSessionKey?: string): AnyAgentTool {
  return {
    name: "tasks_create",
    label: "Create Background Task",
    description: [
      "Create an asynchronous background task that runs an agent turn independently.",
      "Returns immediately with a task id. The task executes in its own isolated session.",
      "Results are automatically delivered back to this conversation when the task completes.",
      "Use tasks_status to poll for progress before the result arrives.",
    ].join(" "),
    parameters: Type.Object({
      message: Type.String({
        description: "The instruction or prompt to run as a background task.",
      }),
      model: Type.Optional(
        Type.String({ description: "Model override (e.g. anthropic/claude-opus-4-6)." }),
      ),
      thinking: Type.Optional(
        Type.String({ description: "Thinking level override (low/medium/high)." }),
      ),
      timeoutSeconds: Type.Optional(Type.Number({ description: "Max execution time in seconds." })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const p = params as {
        message: string;
        model?: string;
        thinking?: string;
        timeoutSeconds?: number;
      };
      const payload = {
        ...p,
        ...(originSessionKey ? { originSessionKey } : {}),
      };
      const result = await callGatewayTool<{ task: { id: string; status: string } }>(
        "tasks.create",
        {},
        payload,
      );
      const task = result?.task;
      if (!task) {
        throw new Error("tasks.create returned no task");
      }
      return {
        content: [
          { type: "text" as const, text: `Task created: id=${task.id} status=${task.status}` },
        ],
        details: { taskId: task.id, status: task.status },
      };
    },
  };
}

/** Default tasks_create tool (no auto-injected originSessionKey). */
const tasksCreateTool: AnyAgentTool = buildTasksCreateTool();

/** Agent tool: list recent tasks with their status and token usage. */
const tasksListTool: AnyAgentTool = {
  name: "tasks_list",
  label: "List Tasks",
  description: "List background tasks with their current status, token usage, and results.",
  parameters: Type.Object({
    status: Type.Optional(
      Type.String({
        description:
          "Filter by status: queued | running | completed | failed | cancelled. Omit for all.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max number of tasks to return (default 20)." }),
    ),
  }),
  execute: async (_toolCallId: string, params: unknown) => {
    const p = params as { status?: string; limit?: number };
    const result = await callGatewayTool<{
      tasks: Array<Record<string, unknown>>;
      activeCount: number;
    }>("tasks.list", {}, { status: p.status, limit: p.limit ?? 20 });
    const tasks = result?.tasks ?? [];
    const lines = tasks.map((t) => {
      const toStr = (v: unknown, max?: number): string => {
        const s =
          typeof v === "string" ? v : typeof v === "number" ? String(v) : (JSON.stringify(v) ?? "");
        return max ? s.slice(0, max) : s;
      };
      const tokens = t.totalTokens ? ` tokens=${toStr(t.totalTokens)}` : "";
      const errMsg = t.error ? ` error=${toStr(t.error, 60)}` : "";
      const resultText = t.result ? ` result=${toStr(t.result, 80)}` : "";
      return `[${toStr(t.status)}] id=${toStr(t.id)}${tokens}${errMsg}${resultText}`;
    });
    return {
      content: [
        {
          type: "text" as const,
          text:
            lines.length > 0
              ? `Active: ${result?.activeCount ?? 0}\n${lines.join("\n")}`
              : `No tasks found. Active: ${result?.activeCount ?? 0}`,
        },
      ],
      details: { tasks, activeCount: result?.activeCount },
    };
  },
};

/** Agent tool: get status of a specific task. */
const tasksStatusTool: AnyAgentTool = {
  name: "tasks_status",
  label: "Task Status",
  description: "Get detailed status of a specific background task by id.",
  parameters: Type.Object({
    id: Type.String({ description: "The task id returned by tasks_create." }),
  }),
  execute: async (_toolCallId: string, params: unknown) => {
    const p = params as { id: string };
    const result = await callGatewayTool<{ task: Record<string, unknown> }>(
      "tasks.get",
      {},
      { id: p.id },
    );
    const task = result?.task;
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Task ${p.id} not found.` }],
        details: {},
      };
    }
    const toStr = (v: unknown, max?: number): string => {
      const s =
        typeof v === "string" ? v : typeof v === "number" ? String(v) : (JSON.stringify(v) ?? "");
      return max ? s.slice(0, max) : s;
    };
    const lines = [
      `id: ${toStr(task.id)}`,
      `status: ${toStr(task.status)}`,
      `created: ${new Date(task.createdAt as number).toISOString()}`,
      task.startedAt ? `started: ${new Date(task.startedAt as number).toISOString()}` : null,
      task.completedAt ? `completed: ${new Date(task.completedAt as number).toISOString()}` : null,
      task.totalTokens
        ? `tokens: ${toStr(task.totalTokens)} (in=${toStr(task.inputTokens ?? 0)} out=${toStr(task.outputTokens ?? 0)})`
        : null,
      task.result ? `result: ${toStr(task.result, 200)}` : null,
      task.error ? `error: ${toStr(task.error)}` : null,
    ].filter(Boolean);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { task },
    };
  },
};

export const taskTools: AnyAgentTool[] = [tasksCreateTool, tasksListTool, tasksStatusTool];

/**
 * Build task tools for chat mode. The tasks_create tool is pre-configured with the chat
 * session key so task completions are automatically pushed back to the originating session.
 */
export function buildChatModeTaskTools(originSessionKey?: string): AnyAgentTool[] {
  return [buildTasksCreateTool(originSessionKey), tasksListTool, tasksStatusTool];
}
