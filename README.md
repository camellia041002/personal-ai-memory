# personal-ai-memory

**给你的 AI 接上一块由你自己控制的外置长期记忆。**

它是一个通过 MCP 连接的外置记忆系统。只用一个 AI 就可以使用；以后如果换客户端或同时使用多个 AI，也可以让它们连接同一份记忆。它不绑定某个 AI，只有客户端调用保存、读取或搜索工具时，相关内容才会进入这个系统。

基础版部署在**你自己的 Cloudflare 账号**中：不用买服务器，不用买域名，也不用在电脑上安装开发工具。准备一个 GitHub 账号和一个 Cloudflare 账号，跟着下面四步即可。

## 四步完成

### 1. 注册或登录 Cloudflare

打开 [Cloudflare](https://dash.cloudflare.com/sign-up)，使用免费账号即可开始。你还需要登录自己的 GitHub；部署过程中 Cloudflare 会在你的 GitHub 账号里创建一份代码副本。

### 2. 点击部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camellia041002/personal-ai-memory/tree/main/lite)

在 Cloudflare 页面接受新建项目和存储空间即可，不需要自己创建或绑定资源。

### 3. 填入 `MEMORY_TOKEN`

在部署页面找到 `MEMORY_TOKEN`，填入一个专门为这个记忆库生成的 64 位随机字母数字串。可以直接用密码管理器的“生成密码”功能。

> **`MEMORY_TOKEN` 就是你家钥匙。拿到它的人可以读写你的记忆。不要发到群里，不要截图，不要提交到代码，也不要使用 Cloudflare API Token 或账号密码代替它。**

[没有密码管理器时，查看安全生成方法](docs/GENERATE_TOKEN.md)。

### 4. 复制地址，贴进 AI 客户端

部署完成后，Cloudflare 会给你一个类似下面的地址：

```text
https://你的项目名.你的子域名.workers.dev
```

如果 AI 客户端只让你粘贴一个地址，就填：

```text
https://你的项目名.你的子域名.workers.dev/mcp/你的MEMORY_TOKEN
```

如果客户端支持单独填写 Bearer Token，使用根地址加 `/mcp`，并把 `MEMORY_TOKEN` 填到 Bearer Token 输入框。这种方式更不容易把钥匙留在网址记录里。

[查看 ChatGPT、Claude、Codex 和通用客户端连接示例](CLIENTS.md)。并非每个客户端或账号套餐都支持远程 MCP，请以客户端当前功能为准。

## 怎么知道成功了

先在浏览器打开 Cloudflare 给出的、不含 token 的根地址。看到 `personal-ai-memory Lite is running` 就表示服务已启动。

把连接地址添加到 AI 客户端后，可以对 AI 说：

```text
请把“我喜欢用深色模式”保存为一条测试记忆，然后读取它给我看，最后删除这条测试记忆。
```

能完成保存、读取和删除，基本流程就通了。

## 它能做什么

- 保存一条你主动提供的记忆；
- 用完整名称读取记忆；
- 按名称或前缀查找少量记忆；
- 在再次确认名称后删除记忆；
- 给一个支持远程 MCP 的 AI 增加长期记忆；
- 需要时，让多个 AI 客户端连接同一份记忆。

如果多个 AI 共用，可以用 key 前缀整理来源或用途，例如 `shared_`、`chatgpt_`、`claude_`。前缀只是分类，不是权限隔离：连接同一地址和钥匙的客户端，原则上都能访问这份记忆。需要真正隔离时，应分别部署记忆库或使用不同的访问控制。

## 它不是什么

- 不会自动读取所有聊天记录；
- 不会自动理解和整理你的一切；
- 不是聊天记录同步或完整备份工具；
- 没有多人账号、审计日志或端到端加密；
- 基础版不会按“意思相近”搜索正文。

第一次使用先确认“保存和读取”是否真的对你有用。

## Lite 和完整 V8

| 版本 | 适合谁 | 部署 |
| --- | --- | --- |
| Lite | 第一次使用；按完整 key 或前缀查找 | 使用上面的默认按钮 |
| V8 | 需要按意思搜索、日期记录、混合检索和索引恢复 | [打开 V8 部署说明](v8/README.md) |

V8 现在有独立的 Deploy to Cloudflare 按钮，代码入口就是 [`v8`](v8)。受 Cloudflare 当前部署页限制，它还需要额外填写 Vectorize 的 `1024` 和 `cosine` 两个固定值；本地配置和 dry-run 可以验证，但在完成一次全新资源端到端测试前，不把它标成“已验证的一键部署”。详细区别见[进阶版本](docs/ADVANCED.md)。

## 数据在哪里

服务代码和存储空间位于使用者自己的 Cloudflare 账号中，不在项目作者的服务器里。项目作者不会因为你部署了这个仓库，就自动获得你的地址、密钥或记忆。

但这不代表数据绝不经过第三方：Cloudflare 负责运行和存储；当 AI 调用工具时，AI 客户端和模型会看到本次请求及返回的记忆。请只保存你愿意交给这些服务处理的内容。

## 费用

按 Cloudflare 当前免费额度，Lite 使用的 KV 在一个账号中共有 **1 GB** 存储，每天包含 **100,000 次读取、1,000 次写入和 1,000 次列表请求**；Worker 本身每天包含 **100,000 次请求**。日常个人记忆通常够用，但不是“永久无限免费”的承诺。

粗略换算：如果每条记忆连同 key 平均约 2 KB，1 GB 大约能放 50 万条；平均约 10 KB，大约能放 10 万条。实际数量会受 UTF-8 编码、key、元数据和同账号其他 KV 数据影响，所以这只是量级估算，不是容量保证。

额度会调整，请以 Cloudflare 的 [KV 限制](https://developers.cloudflare.com/kv/platform/limits/)、[KV 定价](https://developers.cloudflare.com/kv/platform/pricing/)和 [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)为准。V8 还会使用语义索引和模型额度，具体见[进阶版本](docs/ADVANCED.md)。

## 想让 AI 帮你部署

把[这段 Lite 部署提示词](docs/AI_DEPLOY_LITE.md)交给你信任的 AI 助手。它会要求 AI 只创建新资源、使用虚构内容测试，并且绝不读取或打印你的密钥。

完整安全说明见 [SECURITY.md](SECURITY.md)。项目采用 [MIT License](LICENSE)。
