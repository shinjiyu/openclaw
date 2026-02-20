---
description: SSH 远程操作规范：凭据安全、命令批处理、后台进程管理。
globs:
alwaysApply: true
---

# SSH Operations

## 凭据安全

- **禁止**在 shell 命令中明文嵌入密码（`sshpass -p 'xxx'` 会泄漏到 ps、history、transcript）
- 首次访问远程服务器时，优先设置 SSH key 认证（`ssh-copy-id`）或使用 `~/.ssh/config` 配置
- 如果用户提供了密码且 `sshpass` 是唯一选项，**先警告安全风险**再执行，并在第一次连接后建议配置 key

## 命令批处理

- 将逻辑相关的操作合并到**单次 SSH 调用**，用 `&&` 或 `bash -c '...'` 连接
- 避免每个小步骤一个独立 SSH 连接（每次 roundtrip 增加 2-5s 延迟 + 可能耗尽连接数）

```bash
# 差：6 次 SSH 调用
ssh server 'ls /dir'
ssh server 'git pull'
ssh server 'pnpm build'
ssh server 'systemctl restart svc'
ssh server 'systemctl status svc'
ssh server 'journalctl -u svc -n 10'

# 好：1 次 SSH 调用
ssh server 'cd /dir && git pull && pnpm build 2>&1 | tail -5 && systemctl restart svc && sleep 2 && systemctl status svc && journalctl -u svc -n 10 --no-pager'
```

## 后台进程

- 使用 `systemd` 管理长驻进程，不要用 `nohup ... & disown`
- 如果必须用 nohup：`nohup cmd </dev/null >log 2>&1 & disown`

## 前置检查

首次 SSH 到服务器时，先执行环境扫描（一次调用）：

```bash
ssh server 'which target-binary && readlink -f $(which target-binary) && systemctl cat target-service 2>/dev/null | head -20 && ls ~/.ssh/*.pub 2>/dev/null'
```

> **来源**：基于 3 次会话提炼。明文密码出现 131/78 次（5d2d6076, eb5ac669）、SSH 连接耗尽（eb5ac669）、后台进程管理失败（5d2d6076）。
