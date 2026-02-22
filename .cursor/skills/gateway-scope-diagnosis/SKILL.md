---
name: gateway-scope-diagnosis
description: OpenClaw gateway device scope 诊断：当 WS 连接出现 1008 "pairing required" 或权限错误时，按步骤查 journalctl scope-upgrade 日志 → 检查 paired.json → 检查 device-auth.json → 添加缺失 scope → 重启 gateway → 验证。
---

# Gateway Scope Diagnosis

## When to Use

- WS 连接返回 `1008 pairing required`
- API 调用返回 `403 operator.write required` / `scope insufficient`
- Device 完成配对后功能仍被拒绝（如 task 创建失败、agent 启动失败）

---

## Step 1：查 journalctl scope-upgrade 日志

```bash
journalctl -u openclaw-gateway --since "10 min ago" --no-pager | \
  grep -E "scope|scope-upgrade|security audit|operator\.|unauthorized"
```

**预期输出**（如果是 scope 问题）：
```
scope-upgrade required: operator.write for tasks_create
```

如果无相关输出，跳到 Step 2 检查配对状态。

---

## Step 2：检查 paired.json

```bash
cat ~/.openclaw/paired.json | jq '.devices[] | {id, name, scopes}'
```

确认目标 device 存在，并查看其 `scopes` 数组是否包含所需权限（如 `operator.write`、`agent.execute`）。

**scope 不足时的表现**：device 在列表中存在，但 scopes 数组中缺少特定权限。

---

## Step 3：检查 device-auth.json

```bash
cat ~/.openclaw/credentials/device-auth.json | jq '.[] | {deviceId, scopes, expiresAt}'
```

验证：
- `expiresAt` 未过期
- `scopes` 包含所需权限
- 若 `paired.json` 有 device 但 `device-auth.json` 中缺失，说明授权记录损坏

---

## Step 4：添加缺失 scope

通过 CLI 重新授权 device 并添加 scope：

```bash
# 列出当前 device 及 scope
openclaw devices list

# 更新 device scope（具体命令视版本而定）
openclaw devices auth --device <deviceId> --scope operator.write --scope agent.execute
```

或通过 Control UI（Web）：Settings → Devices → 选择 device → Edit Scopes。

---

## Step 5：重启 gateway

```bash
# systemd 管理的 gateway
sudo systemctl restart openclaw-gateway
sleep 3
systemctl status openclaw-gateway

# Mac app 管理的 gateway（通过脚本重启）
scripts/restart-mac.sh
```

---

## Step 6：验证 device-auth.json 自动更新

重启后，gateway 应自动刷新授权记录：

```bash
# 等待 5 秒让 gateway 完成初始化
sleep 5

# 验证新 scope 已写入
cat ~/.openclaw/credentials/device-auth.json | jq '.[] | select(.deviceId == "<deviceId>") | .scopes'

# 验证 WS 连接不再返回 1008
journalctl -u openclaw-gateway -n 20 --no-pager | grep -E "scope|pairing|authorized"
```

预期：无 `scope-upgrade required`，有 `device authorized` 日志。

---

## 快速参考：常见 scope 需求

| 功能 | 所需 scope |
|------|-----------|
| 创建任务 (`tasks_create`) | `operator.write` |
| 运行 Agent (`agent_run`) | `agent.execute` |
| 读取配置 | `operator.read` |
| 管理 channels | `channels.write` |

---

> **来源**：PAT-013，Round 004，待多项目验证。"pairing required" 根因定位延迟 50+ 消息，真正根因是 tasks_create 需要 operator.write scope，Agent 从外部网络层开始排查导致浪费大量轮次。
