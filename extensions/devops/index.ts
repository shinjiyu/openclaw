import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createDeployTool } from "./src/deploy-tool.js";
import { createSandboxTool } from "./src/sandbox-tool.js";
import { createShellExecTool } from "./src/shell-exec-tool.js";
import type { DevOpsConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as DevOpsConfig;

  api.registerTool(createShellExecTool(cfg) as unknown as AnyAgentTool, { optional: true });
  api.registerTool(createSandboxTool(cfg) as unknown as AnyAgentTool, { optional: true });
  api.registerTool(createDeployTool(cfg) as unknown as AnyAgentTool, { optional: true });
}
