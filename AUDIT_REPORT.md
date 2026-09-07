# Source audit report

## Scope and method

审计对象为私人目录中保存的四个 DOCX 归档：一份包含 V1—V5，另外三份分别包含 V6、V7、V8。审计以只读方式提取正文、表格、页眉页脚、文档属性、外部关系、评论和嵌入部件，并对各版本代码逐段比较。原始文件未被修改，V1—V7 源码未复制到本仓库。

自动扫描之外，还人工检查了每版鉴权路由、工具列表、KV 遍历、删除逻辑、索引写入与 V8 归档中的部署信息。

## Version findings

| 版本 | 可证明的演进 | 主要公开风险 |
| --- | --- | --- |
| V1 | KV MCP 原型与五个基础工具 | 伪 OAuth 直接返回服务 Token；开放重定向风险；查询参数 Token；全量导出/读取；无确认删除；KV 列表未分页 |
| V2 | JSON-RPC/SSE 整理、KV 游标分页、最近日记 | 路径 Token；普通工具全量枚举与读取；无确认删除 |
| V3 | Vectorize、固定切片、语义搜索、全库重建 | 继承 V2 权限问题；向量 ID 直接拼接 key；全库重建无权限分离 |
| V4 | 重叠切片、完整 chunk、按 key 去重 | 继承 V3 权限问题；索引写入失败会让调用失败但 KV 可能已写入 |
| V5 | 重建确认字段、旧向量清理、重建节流 | 继承路径 Token/全量读取/无确认删除；固定尝试 100 个向量 ID；必填 schema 造成客户端兼容问题 |
| V6 | 容错保存、1024 维模型、移除重建确认 | 索引失败不抛错但返回值不能明确表达 pending；普通权限仍可全库重建与读取 |
| V7 | 可选重建确认兼容不同客户端 | 与 V6 的权限边界基本相同；`confirm` 只兼容 schema，不作为强制安全确认 |
| V8 | KV/D1/Vectorize 混合检索、索引状态、管理员端点、删除确认 | 私人归档含生产资源标识和个人化 key 规则；仍保留路径 Token 兼容；未设置 key/value/query 硬上限；项目分类只认 `proj_` |

## Publication classification

### 可公开

- 脱敏并修正安全边界后的 V8 参考实现。
- 只描述经源码或归档说明证明的 V1—V8 演进记录。
- 通用的 D1 schema、架构说明、安全说明、测试和完全虚构的样例数据。
- Cloudflare 产品、绑定类型和公开模型名称等技术依赖说明。

### 需脱敏或修改后公开

- V8 Worker 源码：必须删除路径 Token 兼容、生产资源名称与个人化 owner/key 规则，并增加输入限制。
- V8 部署信息表：只能描述绑定角色，不得保留真实 Worker 名称、部署版本 ID、资源名或归档源码哈希。
- DOCX 文档属性：归档包含本机作者/最后修改者元数据，不能复制进公开产物。
- CORS 与示例配置：必须使用显式示例 origin、占位资源 ID 和独立示例资源。

### 不应公开

- V1—V7 完整原始源码。它们包含已经废弃的不安全接口，也可能暴露私人命名和历史设计细节。
- 任何真实记忆、Token、密钥、OAuth 信息、MCP 私密 URL、邮箱、域名、Cloudflare Account ID、KV Namespace ID、D1 ID、Vectorize ID、日志、备份、数据库或生产配置。
- 原始 DOCX 文件及其元数据。

## Sensitive-data result

- V8 归档明确包含生产 Worker/数据库/Vectorize 资源名称和部署版本标识；这些值没有进入公开版。
- V8 源码包含个人化 owner 与人物 key 前缀；公开版已泛化。
- 四个 DOCX 未发现外部超链接关系、评论或嵌入附件。
- 正文扫描未发现写死的真实 Bearer Token、API key、邮箱或完整生产 URL。环境变量名如 `AUTH_TOKEN`、`ADMIN_TOKEN` 属于配置接口名，不是凭据值。
- 原始 DOCX 的作者元数据包含个人设备上的作者标识；公开版没有复制文档或属性。

## Third-party and license conclusion

归档正文、关系和代码注释中未发现第三方仓库链接、版权声明、作者署名、许可证头或明确的复制来源。源码表现为围绕该项目需求逐版生成和修改的单文件 Worker，实现调用 Cloudflare 的公开运行时 API，但不包含 Cloudflare SDK 源码。

基于现有材料，没有需要继承的第三方许可证声明。公开版因此采用宽松的 MIT License，并暂以 `personal-ai-memory contributors` 为权利人标识。公开前维护者仍应确认希望展示的版权主体名称；本结论是代码来源审计结果，不是法律意见。

## Public-edition verification target

公开目录必须满足：无私人 DOCX、无 V1—V7 原码、无路径/查询参数 Token、无全量读取工具、无无确认删除、无生产标识、无真实样例、无 `.env`/`.dev.vars`/真实 Wrangler 配置，并且 Git 历史仅包含审计后的公开文件。
