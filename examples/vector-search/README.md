# Vector search profile

这是 V3—V7 能力阶段的安全整理版，不是任一历史版本的逐字副本。它保留 KV 原文、300 字符窗口与 100 字符重叠、Vectorize 语义检索和按 key 去重，但不需要 D1。

与历史版本相比，它只接受 Bearer 请求头、限制输入和结果长度、禁止无条件全库读取，并要求 `confirmKey` 后才删除。索引清单保存在 KV 的保留前缀下，用于过滤陈旧向量和清理删除项。

创建独立 KV 和 1024 维 cosine Vectorize index 后，复制本目录配置为 `wrangler.jsonc`，替换占位资源信息：

```bash
npx wrangler vectorize create personal-ai-memory-vector-example-index --dimensions=1024 --metric=cosine
npx wrangler secret put AUTH_TOKEN --config wrangler.jsonc
npx wrangler deploy --config wrangler.jsonc
```

这一档没有 D1 精确短语检索或管理员索引状态表。KV 写入成功但向量写入失败时会返回 `pending`；再次保存同一 key 可以重试索引。
