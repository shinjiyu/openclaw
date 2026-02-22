---
description: systemd PrivateTmp 服务的日志不在宿主机 /tmp，必须用 journalctl 而非直接访问 /tmp 路径。
globs:
alwaysApply: true
---

# systemd PrivateTmp — 日志路径陷阱

启用了 `PrivateTmp=yes` 的 systemd 服务运行在独立 `/tmp` 命名空间中。**宿主机的 `/tmp/openclaw-*.log` 对该服务不可见，反之亦然。**

## 禁止

```bash
# ❌ 直接访问宿主机 /tmp — 该文件不存在或是旧文件
tail -f /tmp/openclaw-gateway.log
cat /tmp/openclaw-*.log
ls /tmp/ | grep openclaw
```

## 正确做法

```bash
# ✅ 通过 journalctl 读取 systemd 服务日志
journalctl -u openclaw-gateway -n 50 --no-pager
journalctl -u openclaw-gateway --since "5 min ago" -f

# ✅ 若确实需要访问服务私有 /tmp，通过 nsenter（需 root）
nsenter -t $(systemctl show -p MainPID --value openclaw-gateway) --mount -- ls /tmp/
```

## 诊断：如何判断服务是否启用 PrivateTmp

```bash
systemctl cat openclaw-gateway | grep PrivateTmp
# 若输出 PrivateTmp=yes，则 /tmp 是私有命名空间
```

## 适用范围

所有通过 `systemctl` 管理、且 unit file 中含 `PrivateTmp=yes` 的服务：
- `openclaw-gateway`
- 任何带有 `PrivateTmp` 的第三方服务

> **来源**：PAT-014，Round 004，待多项目验证。systemd PrivateTmp 导致 Agent 多次找错日志路径，误判"无日志"。
