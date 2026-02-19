import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGatewayTool } from "./gateway.js";

/** Agent tool: create a background task and return its id immediately. */
const tasksCreateTool: AnyAgentTool = {
  name: "tasks_create",
  label: "Create Background Task",
  description: [
    "Create an asynchronous background task that runs an agent turn independently.",
    "Returns immediately with a task id. The task executes in its own isolated session.",
    "Use tasks_status to check progress. Results are delivered to originChannel/originTo if specified.",
  ].join(" "),
  parameters: Type.Object({
    message: Type.String({ description: "The instruction or prompt to run as a background task." }),
    model: Type.Optional(Type.String({ description: "Model override (e.g. anthropic/claude-opus-4-6)." })),
    thinking: Type.Optional(Type.String({ description: "Thinking level override (low/medium/high)." })),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Max execution time in seconds." })),
    originChannel: Type.Optional(Type.String({ description: "Channel to send result back to (e.g. feishu, telegram)." })),
    originTo: Type.Optional(Type.String({ description: "Recipient address on originChannel." })),
  }),
  execute: async (_toolCallId: string, params: unknown) => {
    const p = params as { message: string; model?: string; thinking?: string; timeoutSeconds?: number; originChannel?: string; originTo?: string };
    const result = await callGatewayTool<{ task: { id: string; status: string } }>("tasks.create", {}, p);
    const task = result?.task;
    if (!task) {
      throw new Error("tasks.create returned no task");
    }
    return {
      content: [{ type: "text" as const, text: `Task created: id=${task.id} status=${task.status}` }],
      details: { taskId: task.id, status: task.status },
    };
  },
};

/** Agent tool: list recent tasks with their status and token usage. */
const tasksListTool: AnyAgentTool = {
  name: "tasks_list",
  label: "List Tasks",
  description: "List background tasks with their current status, token usage, and results.",
  parameters: Type.Object({
    status: Type.Optional(
      Type.String({
        description: "Filter by status: queued | running | completed | failed | cancelled. Omit for all.",
      }),
    ),
    limit: Type.Optional(Type.Number({ description: "Max number of tasks to return (default 20)." })),
  }),
  execute: async (_toolCallId: string, params: unknown) => {
    const p = params as { status?: string; limit?: number };
    const result = await callGatewayTool<{ tasks: Array<Record<string, unknown>>; activeCount: number }>(
      "tasks.list",
      {},
      { status: p.status, limit: p.limit ?? 20 },
    );
    const tasks = result?.tasks ?? [];
    const lines = tasks.map((t) => {
      const tokens = t.totalTokens ? ` tokens=${t.totalTokens}` : "";
      const errMsg = t.error ? ` error=${String(t.error).slice(0, 60)}` : "";
      const resultText = t.result ? ` result=${String(t.result).slice(0, 80)}` : "";
      return `[${t.status}] id=${t.id}${tokens}${errMsg}${resultText}`;
    });
    return {
      content: [
        {
          type: "text" as const,
          text: lines.length > 0 ? `Active: ${result?.activeCount ?? 0}\n${lines.join("\n")}` : `No tasks found. Active: ${result?.activeCount ?? 0}`,
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
    const result = await callGatewayTool<{ task: Record<string, unknown> }>("tasks.get", {}, { id: p.id });
    const task = result?.task;
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Task ${p.id} not found.` }],
        details: {},
      };
    }
    const lines = [
      `id: ${task.id}`,
      `status: ${task.status}`,
      `created: ${new Date(task.createdAt as number).toISOString()}`,
      task.startedAt ? `started: ${new Date(task.startedAt as number).toISOString()}` : null,
      task.completedAt ? `completed: ${new Date(task.completedAt as number).toISOString()}` : null,
      task.totalTokens ? `tokens: ${task.totalTokens} (in=${task.inputTokens ?? 0} out=${task.outputTokens ?? 0})` : null,
      task.result ? `result: ${String(task.result).slice(0, 200)}` : null,
      task.error ? `error: ${task.error}` : null,
    ].filter(Boolean);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { task },
    };
  },
};

export const taskTools: AnyAgentTool[] = [tasksCreateTool, tasksListTool, tasksStatusTool];
