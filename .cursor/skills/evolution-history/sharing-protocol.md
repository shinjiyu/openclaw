# 跨项目共享协议

本文件是 `evolution-history` 技能的补充参考，定义模式晋升、通用知识管理和多用户协作的详细规则。

---

## 模式晋升

### 晋升条件

一个项目级模式满足以下条件时，可晋升为通用模式：

| 条件 | 说明 |
|------|------|
| **跨项目验证** | 语义相同的指纹在 ≥2 个不同 `project_id` 的注册表中独立出现 |
| **状态有效** | 至少一个项目中该模式状态为「活跃」或「已解决」 |
| **非领域强绑定** | 模式不依赖特定业务逻辑（如"BigQuery 表名错误"不适合通用化，"SQL 注入预防"适合） |

### 晋升流程

```
1. 每轮结束时，扫描所有项目的 pattern-registry.md
2. 对每个活跃模式，在其他项目的 registry 中搜索语义匹配的指纹
3. 若找到匹配（≥2 个项目）→ 写入 shared/universal-patterns.md
4. 在来源项目的 registry 中标注「已晋升为通用」
5. git commit -m "[shared] Promote PAT-xxx to universal"
```

### 语义匹配规则

指纹不要求字面完全相同，满足以下任一即视为匹配：

| 匹配类型 | 示例 |
|----------|------|
| **完全相同** | 两个项目的指纹文本一致 |
| **同义替换** | `[错误预防] ESM/CJS 混用` ≈ `[错误预防] CommonJS 与 ES Module 不兼容` |
| **上位概括** | 具体指纹 `[领域知识] Vue3 ref 未 .value` 可被归纳为 `[错误预防] 响应式 API 取值遗漏` |

语义匹配由执行进化的 Agent 判断，低置信时标注「需人工确认」。

---

## Universal Patterns 模板

```markdown
# 通用模式库

> 已在多个项目中独立验证的通用模式。所有项目进化时应将这些模式纳入分析基线。

| ID | 指纹描述 | 类型 | 来源项目 | 验证项目数 | 建议落地形式 | 晋升日期 |
|----|----------|------|----------|------------|-------------|----------|
| UNI-001 | [错误预防] ESM/CJS 混用导致模块加载失败 | 错误预防 | proj-a, proj-b | 2 | Rule (alwaysApply) | 2025-03-15 |
| UNI-002 | [重复工作流] 创建组件后手动注册路由 | 重复工作流 | proj-a, proj-c | 2 | Skill (Workflow) | 2025-04-01 |
```

### Universal ID 格式

`UNI-{NNN}`：全局递增，与项目级 `PAT-{project}-{NNN}` 不同命名空间。

### 通用模式的消费方式

每轮开始时读取 `shared/universal-patterns.md`，作为分析基线：

1. 若本项目未出现过某通用模式 → **预防性检查**：在日志中主动搜索该模式的征兆
2. 若本项目已有该模式 → 将本地 PAT 与 UNI 关联，避免重复计数
3. 若本项目已解决该模式 → 可反哺 `shared/`，标注该项目的解决方案

---

## 多用户协作

### 并发写入场景

当多个用户/Agent 同时对 Evolution Store 执行进化轮次：

| 场景 | 发生概率 | 处理 |
|------|----------|------|
| 不同项目同时提交 | 高 | 无冲突（不同目录），正常 push |
| 同一项目不同用户同时提交 | 低 | `git pull --rebase` 自动合并（追加不同文件） |
| 同时修改同一文件（如 manifest） | 极低 | `git pull --rebase` 可能需手动解决，见下方 |

### 冲突解决策略

**原则**：进化历史是追加型数据，冲突极少。万一冲突，以下规则处理：

| 冲突文件 | 策略 |
|----------|------|
| `manifest.md` | 保留双方新增的行，按轮次号排序 |
| `pattern-registry.md` | 保留双方新增的条目，ID 不会碰撞（含项目前缀） |
| `round-NNN.md` | 不会冲突（每轮唯一文件名） |
| `shared/universal-patterns.md` | 保留双方新增，去重相同 UNI-ID |

### Push 失败重试

```bash
# 若 push 被拒绝（远程有新提交）
git pull --rebase --autostash
# rebase 成功 → 重新 push
git push
# rebase 冲突 → 按上述策略解决后
git add . && git rebase --continue && git push
```

---

## 淘汰规则

每轮结束时执行（在 commit 之前）：

| 规则 | 条件 | 动作 |
|------|------|------|
| Manifest 滚动 | 轮次索引 >5 行 | 移除最早行到 `archive/manifest-full.md` |
| 模式归档 | 已解决 + 3 轮无复现 | 从 `pattern-registry.md` 移入 `archive/patterns-archived.md` |
| Round Record 归档 | 超过 5 轮 | 从 `rounds/` 移入 `archive/rounds/` |

---

## 初始化 Evolution Store

### 团队首次创建

```bash
mkdir evolution-store && cd evolution-store
git init

# 创建基本结构
mkdir -p shared projects
cat > README.md << 'EOF'
# Evolution Store
跨项目 AI Agent 进化历史共享仓库。
由 cross-evolution 框架自动维护。
EOF

echo "# 通用模式库" > shared/universal-patterns.md

git add . && git commit -m "init: create evolution store"
git remote add origin <remote-url>
git push -u origin main
```

### 项目接入

项目接入无需手动操作。Agent 在首次执行交叉进化时会自动引导：

1. Agent 检测到 `.cursor/evolution-store.json` 不存在
2. 通过"用户交互协议"向用户询问 git remote 地址和 project_id
3. 自动创建配置文件、克隆仓库、初始化项目目录

详见 `SKILL.md` 中的"Store 发现与初始化"章节。

若需手动配置（如 CI/CD 环境）：

```bash
cat > <project>/.cursor/evolution-store.json << EOF
{
  "remote": "<团队的 git remote 地址>",
  "local_path": "<本地克隆路径>",
  "project_id": "<全局唯一的项目标识>"
}
EOF
```

**注意**：所有字段均由用户指定，Agent 不预设任何默认 git 地址。
