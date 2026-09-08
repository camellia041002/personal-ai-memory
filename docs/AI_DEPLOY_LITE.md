# 给 AI 部署 Lite 的提示词

把下面整段交给你信任的 AI 编程助手。优先让它引导你使用仓库首页的 Cloudflare 部署按钮；这条路线不需要把 Cloudflare API Token 发给 AI。

```text
请帮我把 personal-ai-memory Lite 部署到我自己的 Cloudflare 账号。

目标：只部署 lite 目录中的版本，只创建一个新的 Worker 和一个新的 KV namespace，获得 workers.dev 地址；不购买或绑定域名，不部署索引版或 Hybrid V8。

安全规则：
1. 先完整阅读仓库根 README、SECURITY.md、lite/README.md、lite/wrangler.jsonc 和 lite/worker.js。
2. 优先使用 README 的 Deploy to Cloudflare 按钮。不要要求我把 Cloudflare API Token、账号密码或 MEMORY_TOKEN 发到聊天里。
3. 只能创建全新的资源。不得连接、读取、修改、复用或删除我已有的 Worker、KV、D1、Vectorize、域名和数据。
4. MEMORY_TOKEN 由我在本机生成，并由我亲自在 Cloudflare 的 Secret 输入框中填写。你只能告诉我生成方法，不能要求我粘贴给你，也不能读取、打印、回显或记录它。
5. 不得把任何真实 Secret、完整秘密 MCP URL、资源 ID、真实记忆、日志或账号资料写入源码、配置、Git 提交、Issue、截图或回答。
6. 如果部署页要求连接 GitHub/GitLab，请解释 Cloudflare 会在我的账号中创建代码副本；这不等于我需要在本机安装或执行 Git。
7. 部署后先访问 workers.dev 根地址，确认只显示 Lite 正常运行提示且不显示密钥。测试 MCP 时只保存一条完全虚构、可立即删除的内容。

完成后只交付：
- Worker 名称和不含密钥的 workers.dev 根地址；
- KV binding 名 MEMORY，以及新建 KV 的名称；
- Bearer 连接模板和单 URL 连接模板，所有密钥位置保留为 <MEMORY_TOKEN>；
- 虚构 smoke test 的通过/失败结果；
- 资源删除或回滚位置。

不要在交付中输出真实 MEMORY_TOKEN、完整秘密 URL、Cloudflare API Token 或测试请求的敏感请求头。
```

如果 AI 建议改用 CLI，你可以拒绝；Lite 的默认路线就是部署按钮。如果按钮本身失败，先保存不含 Secret 的错误信息，再检查仓库是否已公开、子目录 URL 是否正确、Cloudflare 是否成功连接 GitHub/GitLab，以及 `MEMORY` KV 是否自动创建。
