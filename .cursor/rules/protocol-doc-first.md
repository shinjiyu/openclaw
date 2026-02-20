---
description: 当同时编写 server 和 client 代码时，先生成协议文档再实现，避免逐步试错对齐。
globs:
alwaysApply: true
---

# Protocol-Doc-First

当任务需要同时编写 **server 端和 client 端** 通信代码（WebSocket、REST API、RPC 等）时：

## 必须

1. **先梳理已有协议**：用 Grep/Read 扫描服务端的 schema 定义（message types、frame format、connect params、event types、response shape）
2. **生成协议文档**：将完整协议整理成结构化文档，包括请求/响应格式、事件类型、错误码、认证流程
3. **对照文档实现**：client 代码一次性对齐协议文档，而非逐步部署-测试-修复

## 禁止

- 在不了解服务端协议的情况下凭猜测编写客户端代码
- 每修一个字段就部署一次到服务器验证（试错循环）

## 同样适用于

- 调用第三方 API 时：先完整阅读 API 文档/SDK/示例代码，再编写调用代码
- API 连续 2 次返回相同错误码时：停止参数微调，转向搜索替代文档源（changelog、SDK、example 代码）

> **来源**：基于 3 次会话提炼。协议试错导致 8 轮部署循环（e913c157）、API 格式猜测 5 次失败（eb05a315）。
