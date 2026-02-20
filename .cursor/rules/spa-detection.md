---
description: WebFetch 返回空内容时立即切换浏览器工具，不重复尝试。
globs:
alwaysApply: false
---

# SPA Detection

当使用 `WebFetch` 抓取网页内容时：

- 如果返回内容 **少于 200 字符** 或仅包含 `<noscript>`、空白 HTML 骨架，说明目标是 SPA（Single Page Application），需要 JS 渲染
- **最多重试 1 次**（换路径，如 `/about`、`/docs`），第 2 次仍为空则**立即切换到 `browser_navigate`**
- 不要在 WebFetch 上继续尝试 3+ 次

## GitHub 仓库特殊处理

分析 GitHub 仓库时，优先使用 `raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}` 获取源文件，避免抓取 GitHub UI 页面（导航栏、footer 等噪声占 ~60% token）。

> **来源**：基于 2 次会话提炼。WebFetch 对 SPA 重复试错 4 轮（eb05a315）、GitHub 页面噪声占用上下文（94bace39）。
