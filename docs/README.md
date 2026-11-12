# 文档导航

[返回项目首页](../README.md)

这里收录公开、可复现的 Lite 与 Hybrid V8 文档。私人 V9 研究、生产资源和真实记忆不属于公开仓库内容。

## 第一次使用

1. [项目首页与四步部署](../README.md)
2. [安全生成 `MEMORY_TOKEN`](GENERATE_TOKEN.md)
3. [连接 ChatGPT、Claude、Codex 和通用客户端](../CLIENTS.md)
4. [完整安全边界](../SECURITY.md)

## 选择部署版本

- [Lite](../lite/README.md)：一个 Worker、一个 KV、一个 `MEMORY_TOKEN`，适合第一次使用。
- [Hybrid V8](../v8/README.md)：增加 D1、Vectorize 与 Workers AI，适合混合检索和索引恢复。
- [进阶版本总览](ADVANCED.md)：比较索引版与 Hybrid V8，并提供对应代码入口。
- [Cloudflare 部署边界](CLOUDFLARE_DEPLOYMENT.md)：资源、最小权限、交付清单与秘密禁区。

## 理解设计

- [架构说明](../ARCHITECTURE.md)：Lite/V8 组件、读写、搜索和恢复路径。
- [V1 至 V8 演进](EVOLUTION.md)：为什么逐步增加分页、切片、恢复和权限分离。
- [完整版本记录](../CHANGELOG.md)：公开版本的具体变化。
- [公开源码审计](../AUDIT_REPORT.md)：哪些历史材料可以公开、需要脱敏或不得公开。

## 让 AI 协助部署

- [Lite 部署提示词](AI_DEPLOY_LITE.md)
- [索引版 / Hybrid V8 部署提示词](AI_DEPLOY_INDEXED.md)

## 示例配置

- [KV-only 示例](../examples/kv-only/README.md)
- [Vector search 示例](../examples/vector-search/README.md)
