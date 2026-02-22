---
description: WS 连接返回 1008 "pairing required" 时，立即查看 journalctl scope-upgrade 日志，不从网络层开始排查。
globs:
alwaysApply: true
---

# Gateway Scope Debug — Permission-First 排查

当 WebSocket 连接被拒绝并返回 `1008 pairing required` 或类似权限错误时，**根因通常在 token scope 层，而非网络或配置层**。

## 立即执行（第一步）

```bash
# 查看 scope-upgrade 和权限审计日志
journalctl -u openclaw-gateway --since "10 min ago" | grep -E "scope|scope-upgrade|security audit|unauthorized|permission"
```

如果看到 `scope-upgrade required` 或 `operator.write` 之类的条目，这就是根因，**直接跳到 scope 修复**，不要继续排查 nginx/token/reconnection。

## 排查优先级（从内到外）

| 顺序 | 层 | 检查内容 |
|------|----|----------|
| 1 | **Scope/权限** | `journalctl` 中的 `scope-upgrade`、`security audit` |
| 2 | **Device 配对** | `paired.json` 是否包含目标 device |
| 3 | **Token 有效性** | token 过期或格式错误 |
| 4 | **连接层** | nginx proxy、reconnection loop |
| 5 | **网络层** | 端口、防火墙 |

## 禁止

- 看到 1008 错误后直接开始检查 nginx 配置
- 在不知道根因时反复刷新连接期望自动恢复
- 跳过 journalctl 直接怀疑 token 格式问题

## 常见 scope 缺失场景

- `tasks_create` 需要 `operator.write` scope
- `agent_run` 需要 `agent.execute` scope
- device 完成初次配对但 scope 列表未包含新增权限 → 需重新授权

> **来源**：PAT-013，Round 004，待多项目验证。"pairing required" 根因定位延迟 50+ 消息，真正根因是 tasks_create 需要 operator.write scope。
