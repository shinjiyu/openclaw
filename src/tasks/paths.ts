import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

export const DEFAULT_TASKS_DIR = path.join(CONFIG_DIR, "tasks");
export const DEFAULT_TASKS_STORE_PATH = path.join(DEFAULT_TASKS_DIR, "tasks.json");

/** Per-agent task store: ~/.openclaw/agents/{agentId}/tasks/tasks.json */
export function resolveTaskStorePath(agentId?: string): string {
  if (!agentId) {
    return DEFAULT_TASKS_STORE_PATH;
  }
  return path.join(CONFIG_DIR, "agents", agentId, "tasks", "tasks.json");
}
