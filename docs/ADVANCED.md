# 进阶版本

首页 Lite 只需要 Worker + KV，适合第一次部署。下面两档面向已经确认需要更强检索或恢复能力的使用者，技术内容不放在首页。

| 档位 | Cloudflare 资源 | 适合场景 | 代码入口 |
| --- | --- | --- | --- |
| 索引版 | Worker、KV、Workers AI、Vectorize | 希望按语义搜索记忆正文 | [`examples/vector-search`](../examples/vector-search) |
| Hybrid V8 | Worker、KV、D1、Workers AI、Vectorize | 需要精确短语与语义混合检索、索引状态和管理员恢复 | [`src`](../src) |

这两档目前属于 AI/CLI 辅助部署路线，不应宣传成已经通过干净账号验证的一键部署。

- [索引版 / Hybrid V8 的 AI 部署提示词](AI_DEPLOY_INDEXED.md)
- [Cloudflare 资源、最小权限、交付和秘密禁区](CLOUDFLARE_DEPLOYMENT.md)
- [架构说明](../ARCHITECTURE.md)
- [版本演进](../CHANGELOG.md)
- [公开安全审计](../AUDIT_REPORT.md)
