---
name: skill-mining
description: Skill/Rule 生成的标准流程与质量规范。skill-miner 执行日志模式挖掘、创建 Skill/Rule 时使用。
---

# Skill 挖掘输出规范

定义从 Agent 执行日志中提炼 Skill/Rule 的标准流程、质量检查清单和协作工作流。

## When to Use

- skill-miner 执行日志模式挖掘任务
- 需要创建或更新 Skill、Rule、Subagent
- 输入包含 log-analyzer 分析报告
- 需要确保输出与现有配置一致、可追溯

---

## 依赖与协作关系

本 Skill **定义标准流程与质量规范**，需要配合以下组件使用：

| 组件 | 路径 | 职责 | 必需 |
|------|------|------|------|
| `skill-miner-enhanced` Rule | `cross-evolution/rules/skill-miner-enhanced.md` | 定义**实施增强指引**（置信度标注、抽象层次、一致性检查、引用验证） | 是 |
| `evolution-history` Skill | `cross-evolution/skills/evolution-history/SKILL.md` | 进化轨迹追踪（项目进化用本地文件，自身进化用 git 仓库） | 是 |
| `log-analysis` Skill | `cross-evolution/skills/log-analysis/SKILL.md` | 上游输入：归纳 Agent 的标准化分析报告 | 可选 |

### 独立使用时的最小要求

若未加载 `skill-miner-enhanced` Rule，实施时需自行确保：
- 单日志来源标注 `待多项目验证`，多日志标注 `基于 N 次会话提炼`（Rule §1）
- 区分**领域特定**（→ Skill）与**可抽象通用**（→ Rule）的边界（Rule §2.2）
- 创建/更新前检查与已有 Rule/Skill 是否矛盾或重复（Rule §4）
- 引用现有组件前先搜索确认其存在（Rule §7）

---

## 标准流程

### Phase 0：历史咨询（前置步骤）

**必须**在正式分析前根据进化场景读取历史（详见 `evolution-history` Skill 的双模式设计）：

**项目进化模式**（改进目标项目的 Rule/Skill）：
1. 检查项目根目录 `evolution-history/` 是否存在
   - 不存在 → 首轮，跳过，直接进入 Phase 1
   - 存在 → 读取 `manifest.md` 和 `pattern-registry.md`（热区）
2. 执行循环检测

**自身进化模式**（改进 Agent 基础设施本身）：
1. 检查 `.cursor/evolution-store.json` 是否存在
   - 不存在 → 向用户询问 git 地址（不预设默认值）
   - `disabled: true` → 跳过，直接进入 Phase 1
   - 存在 → `git pull`，继续
2. 读取 `shared/universal-patterns.md`（跨项目通用知识）
3. 读取本项目 `projects/{project_id}/manifest.md` + `pattern-registry.md`（热区）
4. 执行循环检测

### Phase 1：收集与索引

1. 搜索 `**/agent-transcripts/*.txt`
2. 建立索引：会话主题、工具序列、涉及文件、领域关键词、最终结果
3. 若输入含 log-analyzer 报告，提取问题编号和建议清单

### Phase 2：模式识别与提案

1. 按 6 类模式识别：

   | 模式类型 | 判定标准 | 落地形式 |
   |----------|----------|----------|
   | **重复工作流** | 同一步骤序列在 ≥2 次会话中出现 | Skill（Workflow 模式） |
   | **领域知识** | 特定技术栈/业务的非通用知识（如 API 特性、配置陷阱） | Skill（Knowledge 章节） |
   | **专业角色** | Agent 需要特定人格/视角才能完成任务（如 Code Reviewer、DBA） | Subagent |
   | **错误预防** | 相同错误在 ≥2 次会话中重复出现，且有明确的预防规则 | Rule（alwaysApply 或 globs） |
   | **工具编排** | 多工具固定组合调用序列（如 Read→Grep→StrReplace 链式操作） | Skill（Workflow 模式）或 Rule |
   | **可脚本化操作** | 步骤确定性高、参数可配置化、人/Agent 重复手动执行（见下方判定标准） | Script（`.sh`/`.ts`，可选配套 Rule） |
2. **注册表比对**：将每个识别到的模式与 `pattern-registry.md` 中已有指纹比对
   - 匹配已有指纹 → 标注 `PAT-{XXX}`，状态按注册表规则更新
   - 无匹配 → 分配新 `PAT-{XXX}` ID，标记为「新发现」
3. 生成结构化提案：类型、动机、来源日志、出现频率、注册表 ID、实现方案、优先级
4. 引用 log-analyzer 问题编号（若适用）

#### 可脚本化操作判定标准

当一个模式同时满足以下 3 项或以上时，应优先建议固化为脚本而非仅写 Rule：

| # | 判定条件 | 说明 |
|---|----------|------|
| 1 | **步骤确定性** | 流程步骤固定，无需 Agent 判断或创意决策 |
| 2 | **参数可配置化** | 变化部分可提取为脚本顶部变量（如 host、路径、service 名） |
| 3 | **重复执行** | 在 ≥2 次会话中被人或 Agent 手动重复执行 |
| 4 | **可幂等** | 重复执行不产生副作用（或可检测并跳过） |
| 5 | **错误可恢复** | 每步失败可安全中止，不留半成品状态 |

**Script vs Rule 决策树：**

```
该模式是否涉及 Agent 认知/决策？
  ├─ 是 → Rule 或 Skill（Agent 行为指导）
  └─ 否 → 步骤是否可完全自动化？
        ├─ 是 → Script（优先）+ 可选配套 Rule（引导 Agent 使用脚本）
        └─ 否 → Rule（流程指导）+ 在 Rule 中标注「建议未来脚本化」
```

**脚本入库策略：**

| 场景 | 入库方式 |
|------|----------|
| 脚本含运营细节（服务器地址、密码、内部路径） | 不入库，加 `.gitignore`，可提供 `.example` 模板 |
| 脚本为通用开发工具（格式化、测试、lint） | 正常入库到 `scripts/` |
| 脚本为 CI/CD 流程 | 入库到 `.github/workflows/` 或 `scripts/` |

### Phase 3：实施前检查

1. **一致性检查**：对照 `skill-miner-enhanced` 的检查清单
2. **已有规则检索**：搜索 `.cursor/rules/`、`.cursor/skills/` 是否已有相关规则
3. **已有脚本检索**：搜索 `scripts/`、`package.json` scripts 是否已有相关脚本
4. **历史冲突检查**：对照注册表，若某模式曾被修复又复现，分析前次修复失效原因
5. **提案与实施映射**：建立提案 ID → 最终文件的对应表

### Phase 4：实施与验证

1. 创建 Skill/Rule/Subagent/Script，遵循对应格式规范
2. **Agent 文件结构合规检查**：增量更新 `.cursor/agents/*.md` 前，先 `Read` 全文检查是否存在重复 frontmatter（多段 `---` YAML 块）；若存在，本次编辑须一并合并/去重
3. 添加置信度标注
4. **脚本类产出**（适用于「可脚本化操作」类提案）：
   - 生成可执行脚本，含顶部配置区、幂等检查、`set -euo pipefail`、彩色日志输出
   - 根据入库策略决定是否加入 `.gitignore`
   - 若脚本不入库，可同时生成 `.example` 模板入库供参考
   - 可选生成配套 Rule 引导 Agent 使用脚本而非手动重复步骤
5. **编辑后自校验**（必须）：对声称修改的每个文件执行 `Read`，验证关键内容是否已持久化；若未落地，在实施报告中明确标注「需主流程补全」
6. 输出实施报告（含提案映射表、自校验结果、需主流程补全项）

### Phase 5：交叉验证

1. 检查新文件与现有配置是否冲突
2. 验证 frontmatter 格式正确
3. 输出最终报告

### Phase 6：历史更新（收尾步骤）

**项目进化模式**：
1. 分配 `PAT-{NNN}` ID，更新 `evolution-history/pattern-registry.md`
2. 创建 `evolution-history/rounds/round-{NNN}.md`
3. 更新 `evolution-history/manifest.md`
4. 执行淘汰

**自身进化模式**：
1. 分配 `PAT-{project_id}-{NNN}` ID，更新 Store 中的 `projects/{project_id}/pattern-registry.md`
2. 创建 `projects/{project_id}/rounds/round-{NNN}.md`
3. 更新 `projects/{project_id}/manifest.md`
4. 执行淘汰
5. 扫描是否有模式可晋升为通用知识（写入 `shared/universal-patterns.md`）
6. `git commit -m "[{project_id}] Round NNN: {摘要}" && git push`

---

## 质量检查清单

### 置信度

- [ ] Reference 中含 `基于 N 次会话提炼`
- [ ] 单日志来源时含 `待多项目验证`
- [ ] 含 `来源日志：<session-id>` 追溯

### 一致性

- [ ] 提案优先级与实施阶段一致，或已说明调整理由
- [ ] 与已有 Rule 无矛盾
- [ ] 与已有 Rule 无重复

### 可追溯性

- [ ] 提案清单含 log-analyzer 问题编号引用
- [ ] 实施报告含提案 ID → 最终文件映射表
- [ ] 实施报告含**本实例负责的归纳报告条目 ID**映射表（多实例并行时，标注 P-1/W-1/建议-1 等）
- [ ] 合并/未实施决策有说明

### 抽象层次

- [ ] 领域特定 vs 通用边界已明确
- [ ] 领域知识 → Skill，通用流程 → Rule

### 历史一致性

- [ ] 所有模式已与 pattern-registry 比对，标注 PAT-ID
- [ ] 复现模式已分析前次修复失效原因
- [ ] 本轮 Round Record 收敛指标已填写
- [ ] Manifest 轮次索引已更新

### Agent 文件结构合规

- [ ] 增量更新 agent 文件前已检查是否含重复 frontmatter
- [ ] 若有重复，本次编辑已一并合并/去重

### 脚本化落地

- [ ] 满足 ≥3 项脚本判定条件的模式已建议脚本化（非仅写 Rule）
- [ ] 脚本含配置区（变量化参数）、幂等检查、错误处理
- [ ] 含运营细节的脚本已建议 `.gitignore` 策略
- [ ] 脚本类提案在实施报告中标注「落地形式：Script」

### 实施报告自校验

- [ ] 对每个声称修改的文件已执行 `Read` 校验
- [ ] 报告含「自校验结果」：每个文件通过/未通过
- [ ] 若有未落地项，报告含「需主流程补全项」清单

---

## 实施报告输出模板

实施报告**必须**包含以下结构：

### 必填结构

```markdown
# 实施报告 — Round {N} [实例 {A|B}]（多实例并行时标注）

## 本实例负责的归纳报告条目 ID

| 归纳报告条目 ID | 对应实施任务 | 落地文件 |
|----------------|--------------|----------|
| P-1 | 增加编辑后自校验 | skill-miner.md |
| W-1 | ... | ... |

## 修改文件列表及改动摘要

| 文件 | 落地形式 | 改动摘要 | 入库策略 |
|------|----------|----------|----------|
| ... | Rule/Skill/Script/Subagent | ... | 入库 / .gitignore / .example |

## 自校验结果

| 文件 | 通过/未通过 | 备注 |
|------|-------------|------|
| ... | ... | ... |

## 需主流程补全项

（若自校验发现某文件未实际持久化，在此列出）
- 文件路径：预期改动摘要

## 提案 ID → 最终文件映射表

| 提案 ID | 最终文件 |
|---------|----------|
| ... | ... |
```

### 多实例并行时的命名约定

主流程应明确告知：本轮为 Round N，实例标识为 A/B；实施记录建议写入 `rounds/self-R00N-implementation-{A|B}.md`，PAT 编号按实例或主题区分，避免与轮次混淆（详见 `evolution-history` Skill 的并行写入策略）。

---

## 与归纳 Agent 协作工作流

```
log-analyzer 输出                     skill-miner 输入/输出
─────────────────────────────────────────────────────────────
P1–P3 严重问题     ──→  提炼为 Skill Known Issues 或 Rule
W1–W5 警告         ──→  提炼为 Rule 行为准则或 Skill 注意事项
优化建议           ──→  评估是否补充到 Skill「可选优化」章节
重复手动操作       ──→  评估是否固化为 Script（见脚本判定标准）
建议修复           ──→  若对应可复用模式，标注「建议 skill-miner 提炼」

skill-miner 提案   ──→  引用「来源：log-analyzer [P1]」形成双向追溯
```

### 重叠模式处理

| 场景 | 处理方式 |
|------|----------|
| 双方均识别同一模式 | 由单一真相源主导，另一方引用 |
| 归纳发现 + 进化提炼 | 进化的 Skill/Rule 中引用归纳的问题编号 |
