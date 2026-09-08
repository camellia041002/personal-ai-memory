# 安全生成 MEMORY_TOKEN

`MEMORY_TOKEN` 控制整个 Lite 记忆库的读写权限。它应当：

- 只用于这个记忆库；
- 至少包含 32 个随机字节；
- 使用 64 位随机字母数字串最省事；
- 不使用姓名、生日、手机号、常用密码、Cloudflare API Token 或其他服务密钥。

最简单的方法是用密码管理器生成 64 位随机密码，并只选择字母和数字。

也可以在自己的电脑上运行下面任一命令。生成结果只应粘贴到 Cloudflare 的 `MEMORY_TOKEN` Secret 输入框，不要发给 AI 或其他人。

PowerShell：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
```

macOS / Linux：

```bash
openssl rand -hex 32
```

如果怀疑 token 泄露，请立即在 Cloudflare Worker 的设置中替换 `MEMORY_TOKEN`，然后更新所有客户端。旧地址和旧 Bearer Token 随即失效。
