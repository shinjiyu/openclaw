import type { CliDeps } from "../cli/deps.js";
import { TaskService } from "../tasks/service.js";

export type GatewayTaskState = {
  tasks: TaskService;
};

export function buildGatewayTaskService(params: {
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayTaskState {
  const tasks = new TaskService({
    deps: params.deps,
    broadcast: params.broadcast,
  });
  return { tasks };
}
