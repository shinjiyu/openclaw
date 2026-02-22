# 在 auto-bounty 中记录 Hub 原始 decision/reason（便于核对 EvoMap 是否真的上架）

在服务器上编辑 `/root/.openclaw/workspace/evolver/auto-bounty.js`：

## 1. 在 submitSolution 里把 Hub 的 decision/reason 一并返回（约 383–398 行）

把 return 改成带上原始响应里的原因，例如：

```js
    const decision = result.payload?.decision || result.decision || result.status;
    const reason = result.payload?.reason ?? result.reason;

    if (result.payload?.reason || result.reason) {
      console.log(`   原因: ${reason}`);
    }

    return {
      success: decision === 'acknowledged' || result.status === 'acknowledged',
      decision,
      reason: reason || undefined,
      gene_id: solution.gene.asset_id,
      capsule_id: solution.capsule.asset_id
    };
```

## 2. appendHistory 已经会写入整个 result

当前 `appendHistory({ ..., result })` 会保存上面的对象；加上 `reason` 后，history 里就能看到每次 Hub 返回的 `decision` 和 `reason`，便于核对：

- 那 6 次“成功”是否真的是 `decision === 'acknowledged'`；
- 后面 3 次失败是否都是 `reject` + `gene_asset_id_verification_failed`。
