import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Task, TaskCreate, TaskStoreFile } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("tasks/store");

/** Keep at most this many completed/failed tasks in the store. */
const MAX_FINISHED_TASKS = 200;

/** Prune finished tasks older than 7 days. */
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readStore(storePath: string): TaskStoreFile {
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      return {
        version: 1,
        tasks: Array.isArray(rec.tasks) ? (rec.tasks as Task[]) : [],
      };
    }
    return { version: 1, tasks: [] };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return { version: 1, tasks: [] };
    }
    log.warn("tasks: failed to read store, returning empty", { err: String(err), storePath });
    return { version: 1, tasks: [] };
  }
}

function writeStore(storePath: string, store: TaskStoreFile) {
  ensureDir(storePath);
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

function pruneStore(store: TaskStoreFile): void {
  const now = Date.now();
  const cutoff = now - PRUNE_AGE_MS;
  const finished = (t: Task) => t.status === "completed" || t.status === "failed" || t.status === "cancelled";

  // Remove very old finished tasks first.
  store.tasks = store.tasks.filter((t) => !(finished(t) && (t.completedAt ?? t.createdAt) < cutoff));

  // Cap finished task count.
  const finishedTasks = store.tasks.filter(finished).sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
  if (finishedTasks.length > MAX_FINISHED_TASKS) {
    const toRemove = new Set(finishedTasks.slice(MAX_FINISHED_TASKS).map((t) => t.id));
    store.tasks = store.tasks.filter((t) => !toRemove.has(t.id));
  }
}

// ── exported API ─────────────────────────────────────────────────────────────

export function loadTasks(storePath: string): Task[] {
  return readStore(storePath).tasks;
}

export function createTask(storePath: string, input: TaskCreate): Task {
  const store = readStore(storePath);
  const now = Date.now();
  const task: Task = {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: now,
    ...input,
  };
  store.tasks.push(task);
  pruneStore(store);
  writeStore(storePath, store);
  return task;
}

export function updateTask(
  storePath: string,
  taskId: string,
  patch: Partial<Omit<Task, "id" | "agentId" | "createdAt">>,
): Task | undefined {
  const store = readStore(storePath);
  const idx = store.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    return undefined;
  }
  const updated = { ...store.tasks[idx], ...patch } as Task;
  store.tasks[idx] = updated;
  writeStore(storePath, store);
  return updated;
}

export function getTask(storePath: string, taskId: string): Task | undefined {
  return readStore(storePath).tasks.find((t) => t.id === taskId);
}

export function listTasks(
  storePath: string,
  opts?: {
    status?: Task["status"] | Task["status"][];
    limit?: number;
    agentId?: string;
  },
): Task[] {
  const store = readStore(storePath);
  let tasks = store.tasks;

  if (opts?.agentId) {
    tasks = tasks.filter((t) => t.agentId === opts.agentId);
  }
  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    tasks = tasks.filter((t) => statuses.includes(t.status));
  }

  // Most-recent first.
  tasks = tasks.slice().sort((a, b) => b.createdAt - a.createdAt);

  if (opts?.limit && opts.limit > 0) {
    tasks = tasks.slice(0, opts.limit);
  }

  return tasks;
}

export function countActiveTasks(storePath: string): number {
  const store = readStore(storePath);
  return store.tasks.filter((t) => t.status === "queued" || t.status === "running").length;
}
