---
name: evolution-history
description: 进化历史追踪与循环检测。cross-evolution 框架执行时使用，支持两种模式：项目进化（本地文件）和自身进化（独立 git 仓库 + 跨项目共享）。
---

# 进化历史追踪

## 核心问题

交叉检查解决了"谁来分析自己"的自指问题，但缺少**时间维度的记忆**。没有轨迹，系统会陷入重发现循环、振荡和浅层收敛。

## 两种进化场景

进化有两个本质不同的场景，**不能混为一谈**：

| | 项目进化 | 自身进化 |
|---|---|---|
| **目的** | 改进某个目标项目的 Rule/Skill | 改进 Agent 基础设施本身（meta skill/rule） |
| **分析对象** | 目标项目的 agent-transcripts | 多个项目中 Agent 的行为模式 |
| **受益范围** | 仅当前项目 | 所有使用该 Agent 的项目 |
| **历史存储** | **项目本地文件** | **独立 git 仓库** |
| **是否共享** | 不需要 | 需要，多项目/多用户贡献 |
| **Pattern ID** | `PAT-{NNN}` | `PAT-{project_id}-{NNN}` |

### 判定规则

Agent 根据当前任务性质自动判定模式：

- **项目进化**：用户要求"分析这个项目的日志并改进 Rule/Skill" → 本地模式
- **自身进化**：用户要求"对 Agent 自身进行交叉进化" / "启动 cross-evolution" → git 模式

---

## 模式 A：项目进化（本地文件）

### 存储结构

在目标项目**根目录**维护（与 `agent-transcripts/` 同级）：

```
{project-root}/
├── agent-transcripts/          # Agent 执行日志（已有）
├── evolution-history/          # 进化历史（本地文件，不需要 git）
│   ├── manifest.md             # 总览（热区，≤50 行）
│   ├── pattern-registry.md     # 活跃模式（热区，≤30 条）
│   ├── rounds/                 # 近期 5 轮记录（热区）
│   └── archive/                # 冷区
│       ├── rounds/
│       └── patterns-archived.md
└── .cursor/                    # 静态配置（不放状态数据）
```

### 执行协议

**每轮开始时**：
1. 检查 `evolution-history/` 是否存在
   - 不存在 → 首轮，创建目录结构，跳过历史咨询
   - 存在 → 读取 `manifest.md` 和 `pattern-registry.md`（热区），执行循环检测
2. 进入交叉分析

**每轮结束时**：
1. 分配 `PAT-{NNN}` ID，更新注册表
2. 写入本轮 Round Record
3. 更新 manifest 和收敛趋势
4. 执行淘汰（manifest 滚动 5 轮、归档模式、旧 round records 移入 `archive/`）

**无 git 操作，无用户交互，无共享。简单直接。**

---

## 模式 B：自身进化（独立 git 仓库）

### 何时使用

当 Agent 对**自身基础设施**（meta skill、meta rule、cross-evolution 框架本身）进行进化迭代时：
- 进化产物是跨项目通用的（所有使用该 Agent 的项目受益）
- 需要多个项目的日志作为输入来提炼通用模式
- 需要多用户协作贡献进化知识

### 存储结构（Evolution Store）

独立 git 仓库，不嵌入任何业务项目：

```
evolution-store/                          # 独立 git 仓库
├── shared/                               # 跨项目共享知识
│   └── universal-patterns.md             # ≥2 项目验证的通用模式
└── projects/                             # 项目隔离区
    └── {project-id}/                     # 各项目的进化记录
        ├── manifest.md                   # 热区
        ├── pattern-registry.md           # 热区
        ├── rounds/                       # 热区
        └── archive/                      # 冷区
```

### Store 发现与用户交互

**当配置文件 `.cursor/evolution-store.json` 不存在时**，Agent 必须主动询问用户：

使用 AskQuestion 工具（若可用）或对话方式：

**问题 1**：是否启用 Evolution Store？

| 选项 | 后续动作 |
|------|----------|
| **已有仓库，提供 git 地址** | 问 git remote → 问 project_id → 克隆 → 写配置 |
| **没有，帮我新建一个** | 问 project_id → 本地 init → 写配置 → 提示用户自行 push |
| **本次跳过** | 不写配置，本轮不使用历史，下次再问 |
| **永久跳过** | 写 `{ "disabled": true }`，不再询问 |

**禁止**硬编码任何默认 git 地址。所有地址由用户提供。

### 配置文件

`.cursor/evolution-store.json`：

```json
{
  "remote": "<用户提供>",
  "local_path": "<用户指定>",
  "project_id": "<用户提供>"
}
```

### 执行协议

**每轮开始时**：
1. 检查 `.cursor/evolution-store.json`
   - 不存在 → 执行用户交互
   - `disabled: true` → 跳过，直接进入分析
   - 存在 → 继续
2. `git pull --rebase --autostash`
3. 读取 `shared/universal-patterns.md`（跨项目通用知识）
4. 读取本项目 `projects/{project_id}/manifest.md` + `pattern-registry.md`
5. 执行循环检测
6. 进入交叉分析

**每轮结束时**：
1. 分配 `PAT-{project_id}-{NNN}` ID，更新注册表
2. 写入 Round Record，更新 manifest
3. 执行淘汰
4. 扫描是否有模式可晋升为通用知识
5. `git commit -m "[{project_id}] Round NNN: {摘要}" && git push`

### 跨项目共享

详见 [sharing-protocol.md](sharing-protocol.md)。核心规则：
- 同一指纹在 ≥2 个 project_id 中独立出现 → 晋升至 `shared/universal-patterns.md`
- 每轮开始时读取 `shared/`，将通用模式纳入分析基线

---

## 共享协议（两种模式通用）

以下模板、规则和检测协议**两种模式完全共用**，仅 Pattern ID 格式和存储路径有差异。

### Manifest 模板

```markdown
# 进化总览

## 元信息

| 字段 | 值 |
|------|-----|
| 首轮日期 | {date} |
| 最近轮次 | Round {N}, {date} |
| 总轮次 | {N} |
| 活跃模式数 | {N} |

## 最近轮次（滚动窗口，保留 5 轮）

| 轮次 | 日期 | 新发现 | 已解决 | 复现 | 净变化 |
|------|------|--------|--------|------|--------|

> 更早轮次见 archive/

## 收敛趋势（基于最近 3 轮）

| 指标 | 最近 3 轮 | 趋势 |
|------|-----------|------|
```

### Pattern Registry 模板

热区文件，仅含 活跃/已缓释/复现/已解决 状态的模式：

```markdown
# 模式注册表（活跃）

> 已归档模式见 archive/patterns-archived.md

| ID | 指纹描述 | 类型 | 首现 | 末现 | 次数 | 状态 | 关联文件 |
|----|----------|------|------|------|------|------|----------|
```

### 状态生命周期

```
新发现 → 活跃 → 已缓释 → 已解决 → 归档
                    ↑          │
                    └── 复现 ←─┘
```

| 状态 | 转换条件 | 位置 |
|------|----------|------|
| **活跃** | 首次发现 | 热区 |
| **已缓释** | 有 workaround | 热区 |
| **已解决** | 修复后 1 轮未复现 | 热区 |
| **复现** | 已解决后再次出现 | 热区 |
| **归档** | 已解决 + 3 轮无复现 | 冷区 |

### 指纹编写规范

1. **格式**：`[类型] 动词 + 对象 + 条件`
2. **示例**：`[错误预防] ESM/CJS 混用导致模块加载失败`
3. **粒度**：一个指纹 = 一个可独立修复的问题

### 淘汰规则

| 规则 | 条件 | 动作 |
|------|------|------|
| Manifest 滚动 | >5 轮 | 最早行移入 `archive/` |
| 模式归档 | 已解决 + 3 轮无复现 | 从 registry 移入 `archive/patterns-archived.md` |
| Round Record 归档 | 超过 5 轮 | 从 `rounds/` 移入 `archive/rounds/` |

---

## 多实例并行约定

当主流程同时启动多个 skill-miner 实例（如 Round N 的实例 A、B）时：

### 轮次与实例编号约定

| 概念 | 约定 |
|------|------|
| **轮次** | Round 编号由主流程统一分配，所有并行实例同属同一轮（如 Round 001） |
| **实例标识** | 主流程在 prompt 中明确告知「本轮为 Round N，你为并行实例 N-A / N-B」 |
| **实施记录命名** | 建议 `rounds/self-R00N-implementation-A.md` / `-B.md`，避免两实例写入同名文件 |
| **PAT 编号** | 按实例或主题域区分（如实例 A 用 PAT-001～006，实例 B 用 PAT-007～014），在 pattern-registry 中注明所属实例，避免与「轮次」混淆 |

### 并行写入策略

共享文件（`manifest.md`、`pattern-registry.md`）由多实例并发更新时存在竞态风险。可选策略：

| 策略 | 适用场景 | 规则 |
|------|----------|------|
| **主流程统一写入** | 推荐 | 各 skill-miner 实例仅产出实施报告；主流程汇总后，由主流程统一写入 manifest 与 pattern-registry |
| **合并规则** | 若必须由实例写入 | 仅追加/合并，不覆盖：manifest 追加新轮次行、pattern-registry 追加新 PAT 行；禁止 `Write` 全文件覆盖；写入前 `Read` 当前内容，增量合并后 `Write` |

主流程应在分配任务时明确采用何种策略；若未明确，skill-miner 默认仅写入本实例的 round record，不直接修改 manifest/pattern-registry。

---

## 循环检测协议（两种模式通用）

每轮读取历史之后、分析之前执行：

### 1. 复现检测

扫描 registry：若某模式状态为「已解决」但本轮再次出现 → 改为「复现」，分析修复失效原因。

### 2. 振荡检测

对比最近 2 轮进化动作：若同一文件被连续做矛盾修改 → 标记「振荡」，冻结该文件。

### 3. 停滞检测

最近 3 轮收敛指标：净未解决连续不变 → 「停滞」。新发现连续 3 轮为 0 且净未解决为 0 → 「已收敛」。

### 4. 升级阈值

| 条件 | 动作 |
|------|------|
| 模式出现 ≥3 次未解决 | 升级 P0 |
| 振荡 ≥2 次 | 冻结文件，人工介入 |
| 停滞 ≥3 轮 | 暂停进化或重评估 |
