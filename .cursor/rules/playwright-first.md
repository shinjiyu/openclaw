---
description: WS 连接或 SPA 行为异常时，1 轮代码排查无效后立即启动 Playwright，不等用户要求。
globs:
alwaysApply: false
---

# Playwright First — WS/SPA 诊断

WebSocket 行为和 SPA 渲染问题**无法仅靠静态代码阅读诊断**，需要运行时观察。

## 触发条件（满足任意一项）

- WS 连接异常（1008/1006/1001/4xxx 错误码）且代码审查 1 轮后未定位根因
- SPA 页面状态与预期不符（按钮不响应、订阅未触发、UI 未更新）
- WebFetch 返回空内容，已确认为 SPA（见 `spa-detection` Rule）
- 用户描述"前端没反应"或"连接断了"类问题

## 立即执行

**不要等用户要求**——在满足触发条件时主动启动 Playwright：

```
1. browser_navigate 到目标页面
2. browser_snapshot 获取当前 DOM 结构
3. 打开 browser console 观察 WS 握手日志
4. 重现用户描述的操作步骤
5. 捕获 WS frame 内容和 JS 错误
```

## 与 spa-detection Rule 的分工

| Rule | 场景 | 触发 |
|------|------|------|
| `spa-detection` | WebFetch 内容为空时切换工具 | 被动检测 |
| `playwright-first` | WS/SPA 行为异常时主动诊断 | 主动介入 |

## 禁止

- 反复阅读 WS 握手代码但不实际连接验证
- 等用户说"能不能用 Playwright 看一下"才启动
- 用 `curl` 代替浏览器验证 WS 行为（curl 不能做 WS upgrade）

> **来源**：PAT-015，Round 004，待多项目验证。浏览器/WS 问题过度依赖代码阅读，Playwright 使用延迟导致诊断效率低。
