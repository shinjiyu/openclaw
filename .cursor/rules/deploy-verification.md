---
description: 远程部署后必须执行验证清单，确认修复真正生效。
globs:
alwaysApply: true
---

# Deploy Verification

代码部署到远程服务器后，**必须验证修复已生效**，不能假设"推了就好了"。

## 部署流程（git-based 项目）

1. 本地 commit → push
2. 服务器 `git pull` （确认 Fast-forward，无冲突）
3. 服务器 `pnpm build`（或项目对应的构建命令）
4. 重启服务（`systemctl restart`）
5. **验证清单**（下方）

## 验证清单

| 步骤 | 命令示例 | 目的 |
|------|----------|------|
| 确认构建包含修改 | `grep -r "关键变量或注释" dist/` | 排除 build cache 或 tree-shaking 导致修改丢失 |
| 确认 service 使用正确路径 | `readlink -f $(which binary)` | 排除全局安装 vs 本地 fork 混淆 |
| 确认 service 正常运行 | `systemctl status svc` | 确认未 crash loop |
| 观察行为 | `journalctl -u svc --since "1 min ago"` | 确认修复后的预期行为出现 |

## 禁止

- 使用 `scp` 直传源码文件绕过 git（会导致服务器 unstaged changes，后续 `git pull` 冲突）
- 部署后不验证就宣布"已修复"
- 在 build 产物中搜索被 minifier 改名的变量（用注释字符串或逻辑模式代替）

> **来源**：基于 2 次会话提炼。scp 绕过 git 导致修复未生效 + 5 轮假修复（e913c157）、plugin 注册未验证（5d2d6076）。
