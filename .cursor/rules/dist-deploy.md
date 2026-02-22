---
description: 部署构建产物时必须 rsync 整个 dist/ 目录，禁止只同步单个 entry 文件。
globs:
alwaysApply: true
---

# Dist Deploy — 完整目录同步

现代打包工具（Vite、esbuild、webpack）会将代码切割为多个 chunk 文件（`dist/index.js`、`dist/chunk-*.js`、`dist/assets/*` 等）。**entry 文件只是入口，运行时还需要 chunk 文件。**

## 禁止

```bash
# ❌ 只同步入口文件 → chunk 缺失 → 运行时 crash
rsync -av dist/index.js remote:/app/dist/
scp dist/entry.js remote:/app/dist/
```

## 正确做法

```bash
# ✅ 同步整个 dist/ 目录（保持目录结构）
rsync -av --delete dist/ remote:/app/dist/

# ✅ 如果用 scp
scp -r dist/ remote:/app/dist/
```

- `--delete` 清理远端残留旧 chunk（避免引用过期文件）
- 同步后用 `ls -lh remote:/app/dist/` 确认文件数量与本地 `ls dist/` 一致

## 根因

单文件 rsync 是误以为构建产物是单文件。实际上：
- Vite/esbuild 默认 code-splitting，chunk 数量 ≥ 2
- entry 文件通过动态 `import('./chunk-xxx')` 加载 chunk，chunk 缺失时 gateway crash

> **来源**：PAT-012，Round 004，待多项目验证。rsync 只同步 entry.js → chunk 缺失 → gateway crash。
