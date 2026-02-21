import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";

export type UiTask = {
  id: string;
  agentId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  message: string;
  model?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  result?: string;
  error?: string;
  originChannel?: string;
  originTo?: string;
};

export type TasksStatusResult = {
  activeCount: number;
  queuedCount: number;
  runningCount: number;
  recentCount: number;
  totalTokens: number;
  running: UiTask[];
  queued: UiTask[];
  recent: UiTask[];
};

export type TasksProps = {
  loading: boolean;
  error: string | null;
  status: TasksStatusResult | null;
  tasks: UiTask[];
  createMessage: string;
  createModel: string;
  createThinking: string;
  createOriginChannel: string;
  createOriginTo: string;
  busy: boolean;
  onRefresh: () => void;
  onCreateMessageChange: (v: string) => void;
  onCreateModelChange: (v: string) => void;
  onCreateThinkingChange: (v: string) => void;
  onCreateOriginChannelChange: (v: string) => void;
  onCreateOriginToChange: (v: string) => void;
  onCreateSubmit: () => void;
  onCancel: (taskId: string) => void;
};

function statusBadge(status: UiTask["status"]) {
  const colors: Record<UiTask["status"], string> = {
    queued: "color: var(--muted)",
    running: "color: var(--accent)",
    completed: "color: var(--success)",
    failed: "color: var(--error)",
    cancelled: "color: var(--muted)",
  };
  return html`<span style="font-weight:600;${colors[status]}">${status}</span>`;
}

function formatTokens(task: UiTask) {
  if (!task.totalTokens) return html`<span style="color:var(--muted)">—</span>`;
  const ktok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const detail = task.inputTokens || task.outputTokens
    ? ` (↑${ktok(task.inputTokens ?? 0)} ↓${ktok(task.outputTokens ?? 0)})`
    : "";
  return html`<span title="${task.inputTokens ?? 0} in + ${task.outputTokens ?? 0} out">${ktok(task.totalTokens)}${detail}</span>`;
}

function formatDuration(task: UiTask) {
  if (!task.startedAt) return nothing;
  const endMs = task.completedAt ?? Date.now();
  const dur = endMs - task.startedAt;
  if (dur < 1000) return html`<span class="muted">${dur}ms</span>`;
  return html`<span class="muted">${(dur / 1000).toFixed(1)}s</span>`;
}

function truncate(text: string, max = 80) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function renderTaskRow(task: UiTask, onCancel: (id: string) => void) {
  const canCancel = task.status === "queued" || task.status === "running";
  return html`
    <tr>
      <td style="font-family:monospace;font-size:11px;color:var(--muted)">${task.id.slice(0, 8)}</td>
      <td>${statusBadge(task.status)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${task.message}">${truncate(task.message)}</td>
      <td style="text-align:right">${formatTokens(task)}</td>
      <td>${formatDuration(task)}</td>
      <td style="color:var(--muted);font-size:11px">${formatRelativeTimestamp(task.createdAt)}</td>
      <td>
        ${canCancel
          ? html`<button class="btn btn-sm" @click=${() => onCancel(task.id)}>Cancel</button>`
          : nothing}
        ${task.error ? html`<span style="color:var(--error);font-size:11px" title="${task.error}">⚠ ${truncate(task.error, 40)}</span>` : nothing}
      </td>
    </tr>
  `;
}

export function renderTasks(props: TasksProps) {
  const allTasks = props.tasks;
  const status = props.status;
  const totalToday = status?.totalTokens ?? allTasks.reduce((s, t) => s + (t.totalTokens ?? 0), 0);

  return html`
    <section class="grid grid-cols-2">
      <!-- Stats card -->
      <div class="card">
        <div class="card-title">Task Monitor</div>
        <div class="card-sub">Asynchronous background task execution status.</div>
        <div class="stat-grid" style="margin-top:16px">
          <div class="stat">
            <div class="stat-label">Running</div>
            <div class="stat-value" style="color:${(status?.runningCount ?? 0) > 0 ? "var(--accent)" : "inherit"}">${status?.runningCount ?? "—"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Queued</div>
            <div class="stat-value">${status?.queuedCount ?? "—"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Completed</div>
            <div class="stat-value">${status?.recentCount ?? "—"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total Tokens</div>
            <div class="stat-value" title="${totalToday} tokens total">${totalToday >= 1000 ? `${(totalToday / 1000).toFixed(1)}k` : totalToday}</div>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
          ${props.error ? html`<span class="muted" style="margin-left:8px">${props.error}</span>` : nothing}
        </div>
      </div>

      <!-- Create task card -->
      <div class="card">
        <div class="card-title">New Task</div>
        <div class="card-sub">Submit a background agent task. Returns immediately.</div>
        <div class="form-grid" style="margin-top:16px">
          <label class="field" style="grid-column:1/-1">
            <span>Message</span>
            <textarea
              rows="3"
              style="resize:vertical"
              .value=${props.createMessage}
              @input=${(e: Event) => props.onCreateMessageChange((e.target as HTMLTextAreaElement).value)}
              placeholder="What should the agent do?"
            ></textarea>
          </label>
          <label class="field">
            <span>Model</span>
            <input
              .value=${props.createModel}
              @input=${(e: Event) => props.onCreateModelChange((e.target as HTMLInputElement).value)}
              placeholder="default"
            />
          </label>
          <label class="field">
            <span>Thinking</span>
            <select
              .value=${props.createThinking}
              @change=${(e: Event) => props.onCreateThinkingChange((e.target as HTMLSelectElement).value)}
            >
              <option value="">default</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label class="field">
            <span>Notify Channel</span>
            <input
              .value=${props.createOriginChannel}
              @input=${(e: Event) => props.onCreateOriginChannelChange((e.target as HTMLInputElement).value)}
              placeholder="feishu / telegram / …"
            />
          </label>
          <label class="field">
            <span>Notify To</span>
            <input
              .value=${props.createOriginTo}
              @input=${(e: Event) => props.onCreateOriginToChange((e.target as HTMLInputElement).value)}
              placeholder="user-id or phone"
            />
          </label>
        </div>
        <div class="row" style="margin-top:12px">
          <button
            class="btn btn-primary"
            ?disabled=${props.busy || !props.createMessage.trim()}
            @click=${props.onCreateSubmit}
          >
            ${props.busy ? "Submitting…" : "Submit Task"}
          </button>
        </div>
      </div>
    </section>

    <!-- Tasks table -->
    <div class="card" style="margin-top:16px">
      <div class="card-title">All Tasks</div>
      ${allTasks.length === 0
        ? html`<div class="muted" style="margin-top:12px">No tasks yet. Submit one above or ask the agent to use the <code>tasks_create</code> tool.</div>`
        : html`
          <div style="overflow-x:auto;margin-top:12px">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="border-bottom:1px solid var(--border)">
                  <th style="text-align:left;padding:4px 8px">ID</th>
                  <th style="text-align:left;padding:4px 8px">Status</th>
                  <th style="text-align:left;padding:4px 8px">Message</th>
                  <th style="text-align:right;padding:4px 8px">Tokens</th>
                  <th style="text-align:left;padding:4px 8px">Duration</th>
                  <th style="text-align:left;padding:4px 8px">Created</th>
                  <th style="text-align:left;padding:4px 8px"></th>
                </tr>
              </thead>
              <tbody>
                ${allTasks.map((t) => renderTaskRow(t, props.onCancel))}
              </tbody>
            </table>
          </div>
        `}
    </div>
  `;
}
