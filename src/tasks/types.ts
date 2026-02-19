export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type Task = {
  id: string;
  agentId: string;
  status: TaskStatus;
  /** Natural-language message to execute. */
  message: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
  /** Session key that originated this task (for reply routing). */
  originSessionKey?: string;
  /** Channel to deliver result back to (e.g. "feishu", "telegram"). */
  originChannel?: string;
  /** Recipient address on the origin channel. */
  originTo?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Accumulated input tokens for this task's isolated session. */
  inputTokens?: number;
  /** Accumulated output tokens. */
  outputTokens?: number;
  /** inputTokens + outputTokens */
  totalTokens?: number;
  /** Last non-empty text output from the agent. */
  result?: string;
  error?: string;
};

export type TaskCreate = Pick<
  Task,
  | "agentId"
  | "message"
  | "model"
  | "thinking"
  | "timeoutSeconds"
  | "originSessionKey"
  | "originChannel"
  | "originTo"
>;

export type TaskStoreFile = {
  version: 1;
  tasks: Task[];
};

/** Fine-grained progress event from a running task's agent execution. */
export type TaskProgressEvent = {
  /** Agent event stream name (e.g. "tool", "lifecycle", "assistant"). */
  stream: string;
  data: Record<string, unknown>;
};

export type TaskEvent =
  | { action: "created"; taskId: string; task: Task }
  | { action: "started"; taskId: string }
  | {
      action: "finished";
      taskId: string;
      status: "completed" | "failed" | "cancelled";
      result?: string;
      error?: string;
      durationMs?: number;
      totalTokens?: number;
    }
  | { action: "updated"; taskId: string; patch: Partial<Task> }
  /** Granular progress events (LLM call lifecycle, tool call start/end with timing). */
  | { action: "progress"; taskId: string; event: TaskProgressEvent };
