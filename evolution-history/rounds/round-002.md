# Round 002 — 进化框架自身进化（脚本化落地能力）

**日期**：2026-02-20
**输入**：`evolver_history` 仓库（creatures 项目 self-R001）+ 本项目 Round 001 实践反馈

## 背景

Round 001 产出 4 条 Rule（protocol-doc-first、ssh-operations、deploy-verification、spa-detection），均为 Agent 行为指导文档。但实际使用中发现：`deploy-verification.md` Rule 虽然告诉 Agent "部署后要验证"，但 Agent 每次仍需手动执行 SSH → git pull → build → restart → verify 的完整流程，直到用户主动要求脚本化（`scripts/deploy-local.sh`）才解决。

这暴露了进化框架的盲区：**只能产出 Rule/Skill/Subagent，无法识别"适合固化为脚本"的模式**。

## 归纳阶段

### 新发现模式

| PAT ID | 指纹 | 证据 |
|--------|------|------|
| PAT-011 | [流程] 确定性操作流程仅写 Rule 未脚本化 → Agent 每次仍手动重复执行 | deploy-verification Rule 存在但部署仍手动（Round 001 → deploy-local.sh）；evolver_history 中 creatures 项目亦仅产出 Rule/Skill，无脚本类产出 |

### 跨项目验证

| 项目 | 证据 |
|------|------|
| openclaw | PAT-003 deploy-verification 为 Rule，实际被脚本化为 deploy-local.sh |
| creatures (evolver_history) | self-R001 产出 11 个缓释项，全部为 Rule/Skill 修改，无脚本类产出 |

## 进化阶段

### 修改文件

| 文件 | 落地形式 | 改动摘要 |
|------|----------|----------|
| `.cursor/agents/skill-miner.md` | Agent 定义 | Phase 2 模式类型从 5 类扩展为 6 类（新增「可脚本化操作」）；Phase 4 新增脚本生成步骤；元技能表新增 Script 行 |
| `.cursor/skills/skill-mining/SKILL.md` | Skill 规范 | Phase 2 新增第 6 类模式及判定标准（5 条判定条件 + 决策树 + 入库策略）；Phase 3 新增已有脚本检索；Phase 4 新增脚本类产出指引；质量清单新增「脚本化落地」检查项；协作工作流图新增「重复手动操作 → Script」路径；实施报告模板新增「落地形式」和「入库策略」列 |
| `.cursor/rules/skill-miner-enhanced.md` | Rule 增强 | 新增 §5 脚本化落地判定（含反模式说明）；后续章节重编号 §6→§9 |
| `.cursor/rules/log-analyzer-enhanced.md` | Rule 增强 | 新增 §4.4 可脚本化模式标注（归纳阶段即识别并标注，供 skill-miner 消费） |

### 验证

- PAT-011 回溯验证：Round 001 的 PAT-003（deploy-verification）若在新框架下分析，满足脚本化判定的 5/5 条件（步骤确定、参数可配置、重复执行 ≥2 次、可幂等、错误可恢复），应被建议固化为 Script
