# Pattern Registry

> Append-only 模式注册表。记录所有已识别的 Agent 行为模式。

| PAT ID | 指纹 | 首次发现 | 出现次数 | 状态 | 落地文件 |
|--------|------|----------|----------|------|----------|
| PAT-001 | [流程] 缺少协议文档 → 客户端/服务端逐步试错对齐 | Round 001 | 2 | 已修复 | `.cursor/rules/protocol-doc-first.md` |
| PAT-002 | [技术] SSH 凭据明文 + 无批处理 + 后台进程管理 | Round 001 | 3 | 已修复 | `.cursor/rules/ssh-operations.md` |
| PAT-003 | [流程] 部署后缺少验证闭环 → 误判修复已生效 | Round 001 | 2 | 已修复 | `.cursor/rules/deploy-verification.md` |
| PAT-004 | [工具编排] WebFetch 对 SPA 失败后重复重试 | Round 001 | 2 | 已修复 | `.cursor/rules/spa-detection.md` |
| PAT-005 | [技术] 部署流程不理解 → scp 绕过 git 导致修复未生效 | Round 001 | 2 | 已修复 | `.cursor/rules/deploy-verification.md` |
| PAT-006 | [流程] 超长 session 包含多个独立任务 → 上下文窗口压力增加 | Round 001 | 2 | 待观察 | — |
| PAT-007 | [技术] Zod strict schema 与 TypeScript 类型不同步 → 配置验证失败 | Round 001 | 1 | 待观察 | — |
| PAT-008 | [认知能力] 新特性设计意图理解不完整 → 需用户多次澄清 | Round 001 | 1 | 待观察 | — |
| PAT-009 | [技术] 全局 config flag 泄漏到系统级 agent run → 递归行为 | Round 001 | 1 | 已修复(代码) | — |
| PAT-010 | [认知能力] API 错误后持续微调同一参数集 → 应转向搜索替代文档 | Round 001 | 1 | 已修复 | `.cursor/rules/protocol-doc-first.md` |
| PAT-011 | [流程] 确定性操作流程仅写 Rule 未脚本化 → Agent 每次仍手动重复执行 | Round 002 | 2 | 已修复 | `skill-mining/SKILL.md`, `skill-miner.md`, `skill-miner-enhanced.md` |
