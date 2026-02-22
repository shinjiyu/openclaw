# 日志分析报告 Round 004

## 必填元数据

| 字段 | 值 |
|------|-----|
| 来源日志 | `e913c157-93e5-4aa9-bad3-8c663f19b80f.jsonl` |
| 会话主题 | 调试 OpenClaw WebChat Portal "gateway 连不上" 问题 / chatMode bug fix / 服务器部署 |
| 分析视角 | 技术 + 流程 联合 |
| 分析日期 | 2026-02-22 |
| 进化轮次 | Round 004 |

## 历史咨询（循环检测）

已读取 `evolution-history/pattern-registry.md`（11 条活跃模式）。本轮发现与已有模式比对结果：

- **PAT-001**（缺少协议文档 → 试错）：本轮复现
- **PAT-003**（部署后缺少验证闭环）：本轮复现
- **PAT-005**（scp 绕过 git）：本轮复现
- **新发现**：rsync 部分文件导致 chunk 缺失、"pairing required" 根因定位延迟（调用链追踪失败）、systemd private tmp 日志路径盲区、Playwright 测试时机策略

---

## 概要

> 本表在所有问题条目完成后统计填入。

| 指标 | 数值 |
|------|------|
| 分析日志数量 | 1 |
| 严重问题（P / P-已缓释） | 3 |
| 警告（W） | 3 |
| 优化建议 | 1 |
| 跨会话复现模式 | 3 个（PAT-001、PAT-003、PAT-005） |

---

## 问题条目

---

### 1. rsync 只同步 entry.js → chunk 文件缺失 → gateway crash

| 字段 | 内容 |
|------|------|
| 表面症状 | Agent 在本地修改代码并 `pnpm build` 后，仅通过 rsync 把 `entry.js` 上传到服务器，重启后 gateway 立即 crash。 |
| 深层根因 | tsdown（rollup）构建产物是多个哈希命名的 chunk 文件（如 `run-main-CK7_17sX.js`），`entry.js` 通过动态 import 引用这些 chunk。只传 `entry.js`，服务器端缺少对应 chunk，导致运行时 `Cannot find module` crash。Agent 的内心模型假设 `entry.js` 是单文件产物，忽视了分包构建架构。 |
| 日志位置 | `e913c157:456`（LINE 456 assistant 消息） |
| 证据 | LINE 456: `"The problem is that I rebuilt the entry.js locally, but the tsdown build creates chunk files that are referenced by entry.js. The chunk run-main-CK7_17sX.js doesn't exist on the server because we only uploaded entry.js. The full dist needs to be synced."` |
| 严重性 | P |
| 置信度 | 高 |
| 建议修复 | 1. 部署时始终 rsync 整个 `dist/` 目录而非单个文件。2. 在 `deploy-local.sh` 脚本中强制 `rsync dist/ root@server:/path/dist/`，禁止按需选择子路径。3. 次生风险：全量 rsync 可能覆盖服务器上热补丁（但对于 git 管理的项目此风险可忽略）。 |
| 模式指纹 | [技术] rsync 部分构建产物 → 运行时 chunk 缺失 → gateway crash |
| 注册表关联 | 新发现 |

---

### 2. WS 协议分段试错而非先读规范（复现 PAT-001）

| 字段 | 内容 |
|------|------|
| 表面症状 | Portal WebSocket 连接先后出现 7 个以上协议不匹配错误（`type:"req"` 缺失、错误的 `protocol` 字段名、非法 `clientId`、缺 `operator.write` scope、缺 `sessionKey`、事件名不匹配等），每个错误对应一次部署-测试循环。 |
| 深层根因 | Agent 自己编写了 gateway WS server 和 Portal client 两端代码，但在开发 client 时没有先从 server 源码提炼协议规范文档，而是直接写 client 代码，遇错再修。每轮修复只解决当前可见的错误，导致连锁式问题暴露。用户在 LINE 134 明确反映效率问题才触发 Agent 补写协议文档。PAT-001 规则（`protocol-doc-first.md`）已存在但未被遵循。 |
| 日志位置 | `e913c157:85-148`（LINE 85 至 LINE 148 的 assistant 消息链） |
| 证据 | LINE 85: type 缺失 → LINE 97: 协议版本字段 → LINE 99: clientId/mode → LINE 109: operator.write → LINE 114: sessionKey → LINE 121-130: 事件名混乱 → LINE 134 用户: `"服务端和client都是你自己写的，为什么要一边调试一边对齐协议，直接先生成协议文档"` → LINE 135 Agent 承认: `"你说得完全对。我之前的做法太低效了"` |
| 严重性 | P-已缓释 |
| 置信度 | 高 |
| 建议修复 | 1. 将 `protocol-doc-first` 规则升级为强制触发器：同一会话中同时写 server + client 代码时，在写第一行 client 代码前 **必须** 先产出协议文档。2. 进化 Agent 可在 rule 中添加 checklist 形式的门控。3. 次生风险：协议文档可能滞后于代码变更，需要在每次修改协议端时同步更新文档。 |
| 模式指纹 | [流程] 同会话同时编写 server+client → 未先生成协议文档 → 分段试错对齐协议 |
| 注册表关联 | 复现 PAT-001 |

---

### 3. "pairing required" 根因定位延迟（调用链追踪失败）

| 字段 | 内容 |
|------|------|
| 表面症状 | 用户发消息后收到 "gateway 连不上" 回复，Agent 经过 50+ 消息轮次才定位到根本原因（gateway-client 设备缺少 `operator.write` scope）。 |
| 深层根因 | 错误信息 `"gateway closed (1008): pairing required"` 出现在 **portal 前端**，Agent 误判为 "portal→gateway WS 连接失败"，随即围绕 nginx 配置、token 过期、重连循环、portal 服务进程等表面现象展开调查。实际调用链是：`chat.send` → `dispatchInboundMessage` → `runEmbeddedPiAgent` → `tasks_create` tool → `callGatewayTool` → `callGateway()` → **新建 WS 连接以 device 身份连 gateway** → device 缺 `operator.write` → WS 1008 close → agent 报错 → portal 展示错误信息。Agent 没有优先追踪"谁在内部调用 gateway WS"，而是从外部网络层开始排查。 |
| 日志位置 | `e913c157:346-411`（LINE 346 至 LINE 411） |
| 证据 | LINE 405: `"security audit: device access upgrade requested reason=scope-upgrade scopesFrom=operator.admin,operator.approvals,operator.pairing,operator.read scopesTo=operator.write"` + `"[tools] tasks_create failed: gateway closed (1008): pairing required"` — 这是最终定位到根因的日志条目。此前 LINE 347-404 均是外部网络层的错误假设链。 |
| 严重性 | P-已缓释 |
| 置信度 | 高 |
| 建议修复 | 1. 诊断 WS 错误时，优先检索 server 端日志中与该错误对应的完整调用上下文（不仅是 WS 握手日志，还要看 tool 调用日志）。2. "pairing required" / `1008` 错误，应立即检查：(a) 调用了哪个 gateway tool，(b) 发起该调用的 device 的当前 scope 列表。3. 可在 deploy-verification rule 或调试 Skill 中增加 scope 诊断快捷命令：`openclaw channels status --probe` + 设备 scope 列表检查。 |
| 模式指纹 | [认知能力] WS 错误从外部网络层开始排查 → 忽略内部 tool 调用链 → 根因定位延迟 |
| 注册表关联 | 新发现 |

---

### 4. 使用 scp/rsync 绕过 git 工作流（复现 PAT-005）

| 字段 | 内容 |
|------|------|
| 表面症状 | Agent 在多处使用 `scp` 直接推送源码文件到服务器，而非通过 git push → 服务器 git pull 的标准工作流。 |
| 深层根因 | Agent 对服务器部署架构的心智模型不准确：未意识到服务器 `/root/openclaw-fork` 与本地 repo 共享同一 git remote，正确部署路径是 commit → push → 服务器 git pull。PAT-005 规则（`deploy-verification.md`）已存在，`deploy-local.sh` 脚本已创建，但在 chatMode 修复阶段 Agent 仍首先采用了 scp。用户在 LINE 209/269 明确纠正才切换到 git 工作流。 |
| 日志位置 | `e913c157:49-64`（scp 阶段），`e913c157:209`（用户纠正） |
| 证据 | LINE 49: `"文件已上传。现在在服务器上重建并重启"` (scp 完成)；LINE 209: 用户 `"是不是你对我们的部署方式不太理解。理论上我们应该通过git共享代码"` |
| 严重性 | W |
| 置信度 | 高 |
| 建议修复 | 1. 将 `deploy-local.sh` 的 git 工作流作为唯一合法部署路径，并在脚本中显式拒绝在 "uncommitted changes" 时部署（当前脚本已部分实现）。2. 在 `ssh-operations.md` Rule 中补充：**禁止** 以 scp/rsync 推送源码文件作为首选部署方式；只有在 git pull 失败需要 hotfix 时，才允许用 scp 推送已构建的 dist 文件（需全目录）。 |
| 模式指纹 | [流程] 直接 scp 推送源码文件 → 绕过 git 共享工作流 → 部署状态不可追踪 |
| 注册表关联 | 复现 PAT-005 |

---

### 5. 部署验证闭环缺失（复现 PAT-003）

| 字段 | 内容 |
|------|------|
| 表面症状 | Agent 多次宣告"修复已部署"后，问题依然复现（tasks 仍在无限创建，heartbeat 仍在触发任务），导致后续 3-4 轮额外调试。 |
| 深层根因 | Agent 在 build + restart 后缺少有效的二次验证——没有在重启后等待并检查 journalctl 日志中的关键行为指标（如心跳后是否产生新任务、isBackgroundTask 过滤器是否真正生效）。Agent 依赖"源码包含修复"和"grep dist 找到了关键字"来推断"修复生效"，但没有通过 runtime evidence 闭环。LINE 197 中 Agent 甚至因 rollup 变量名混淆（`heartbeatCfg` 被 inline）而错误地认为修复不在 dist 中，后来又认为在 dist 中，始终处于不确定状态。 |
| 日志位置 | `e913c157:185-228`（LINE 185 至 LINE 228） |
| 证据 | LINE 185: `"心跳还在产生任务。PID 3647546 是我新部署的代码"`；LINE 215: `"还在创建！"`；LINE 228: `"340个任务，其中91个queued、47个running！清掉所有积压任务再观察"` — 问题在清空队列后才真正验证修复是否生效（LINE 229: 心跳不再创建新任务）。 |
| 严重性 | W |
| 置信度 | 高 |
| 建议修复 | 1. 部署后验证标准：等待至少 1 个完整心跳周期（约 60-120s），观察 journalctl 中无新任务创建，才可宣告修复生效。2. 在 `deploy-verification.md` Rule 中补充"task 无限创建"场景的验证步骤：先清空积压队列，再等 1 轮心跳验证零新增。3. grep dist 验证变量名时，rollup 会内联变量名；改为 grep 特征字符串（注释文本、特定字面量）而非变量名。 |
| 模式指纹 | [流程] build+restart 后未等待 runtime 行为验证 → 误判修复已生效 → 额外调试轮次 |
| 注册表关联 | 复现 PAT-003 |

---

### 6. systemd private tmp 日志路径盲区

| 字段 | 内容 |
|------|------|
| 表面症状 | Agent 在多个时间点找不到 gateway 日志，不知道当前运行实例的日志写在哪里。 |
| 深层根因 | gateway 由 systemd 管理，且 service 配置了 `PrivateTmp=yes`（systemd 私有 tmp），导致 gateway 日志文件实际路径是 `/tmp/systemd-private-<hash>/tmp/openclaw/openclaw-YYYY-MM-DD.log` 而非 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`。Agent 多次读错路径或读到旧进程的日志。LINE 430 末尾发现新网关（02:13 启动）没有写入任何 log file —— 这是正常的：该进程的 log 在其专属 private tmp 命名空间内，`ls /tmp/openclaw/` 看不到。 |
| 日志位置 | `e913c157:10`（LINE 10），`e913c157:23`（LINE 23），`e913c157:430`（LINE 430） |
| 证据 | LINE 10: `"stdout/stderr going to a socket... There's a log at /tmp/systemd-private-.../tmp/openclaw/"`；LINE 23: `"The daily log from today hasn't been updated since the restart because the systemd private tmp creates a separate namespace"`；LINE 430: `"The new gateway (PID 762255) has NOT written to any log file!"` — 实际上已写入，只是路径不同。 |
| 严重性 | W |
| 置信度 | 高 |
| 建议修复 | 1. 在 `ssh-operations.md` Rule 或新建 `systemd-log-access.md` Rule 中记录：**systemd private tmp 服务的日志通过 `journalctl -u <service> -f` 读取，不要直接读 /tmp/openclaw/ 文件**。2. 对于 openclaw-gateway.service，标准日志查看命令：`journalctl -u openclaw-gateway.service -n 200 --no-pager`（或 `scripts/clawlog.sh`）。3. 永远不要以"文件不存在"来判断新进程没有日志；改用 journalctl 作为唯一可靠来源。 |
| 模式指纹 | [技术] systemd PrivateTmp 服务读错日志路径 → 误判"无日志"→ 调试信息缺失 |
| 注册表关联 | 新发现 |

---

### 7. Playwright 测试时机过晚（应在 WS 行为不符合预期时立即启用）

| 字段 | 内容 |
|------|------|
| 表面症状 | 用户在 LINE 95/265 明确要求 "你自己用 Playwright 连上去试试" 后，Agent 才开始使用 Playwright，此前依赖 WebFetch + 代码阅读 + 人工复现。 |
| 深层根因 | Agent 的工具选择策略倾向于先读代码、然后 WebFetch，把 Playwright 视为"人工测试替代"而非"第一诊断工具"。但对于 WebSocket、浏览器 JS 运行时、动态登录态等场景，Playwright 能在几十秒内给出 runtime truth，而代码阅读可能产生错误假设并需要多次部署验证循环。LINE 104 使用 Playwright 后立即发现 WS 握手已成功，比之前多轮代码-部署-猜测效率提升明显。 |
| 日志位置 | `e913c157:95`（用户首次要求），`e913c157:104-105`（Playwright 立即有效） |
| 证据 | LINE 95: 用户 `"还是有问题，你自己用playwright连上去试试"`；LINE 104: `"服务器已经在提供新版 HTML（包含 minProtocol 和 maxProtocol）"`；LINE 105: `"好进展！WebSocket 握手终于成功了（不再报错）"` — 一次 Playwright 运行解决了之前 3-4 轮部署未能确认的问题。 |
| 严重性 | 建议 |
| 置信度 | 高 |
| 建议修复 | 1. 在 `spa-detection.md` Rule 或新建 `browser-debug-first.md` Rule 中增加触发器：凡涉及 **WebSocket 连接行为、浏览器登录态、SPA 动态内容** 的问题，在第一次确认"问题不可由代码阅读直接定位"时，**立即** 切换到 Playwright 测试，不等用户要求。2. 推荐决策树：`代码阅读 → 1 次部署验证 → 仍不确定 → Playwright`。 |
| 模式指纹 | [流程] 浏览器/WS 行为问题过度依赖代码阅读 → Playwright 使用延迟 → 诊断效率低 |
| 注册表关联 | 新发现 |

---

## 建议进化 Agent 关注

| 发现 | 预期落地形式 | 优先级 |
|------|--------------|--------|
| rsync 只传 entry.js → chunk 缺失崩溃 | 更新 `deploy-local.sh` 强制全量 dist rsync；在 `deploy-verification.md` 中补充 dist 同步要求 | P0 |
| WS "pairing required" = device 缺 scope，应先看 tool 调用链 | 新建 `scope-diagnosis.md` Rule 或扩展 `deploy-verification.md`；添加 scope 快速诊断命令 | P0 |
| systemd private tmp 导致日志路径混乱 | 在 `ssh-operations.md` 中补充 journalctl 标准用法；禁止从 `/tmp/openclaw/` 直接读日志 | P1 |
| Playwright 应作为 WS/SPA 问题的第一诊断工具 | 扩展 `spa-detection.md` 或新建 `browser-debug-first.md`，添加触发条件和决策树 | P1 |
| scp 部署 + 无验证闭环（PAT-001/003/005 三次复现） | 考虑将 deploy Rule 升级为 Skill + 脚本一体，强制 gate 检查 | P2 |

---

## 分析局限

- **大型日志策略（>100KB）**：采用 Grep 关键词 + 分段 Read 策略。覆盖关键词：`operator.write`、`tasks_create`、`paired.json`、`device-auth`、`nginx`、`websocket`、`WS`、`/ws`；分段 Read 覆盖 LINE 1–462 全部消息摘要（通过 Python 解析器提取 role + content 前 500 字符）。实际覆盖率估计 >95%。
- **低置信结论**：无（所有 7 条均有精确日志位置）。
- **未覆盖**：本报告为单会话分析，无跨会话对比。
- **建议人工复核**：Issue 3（pairing required 根因定位延迟）的调用链描述基于代码阅读推断，应与实际 `callGateway` 实现对照验证。
