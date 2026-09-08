# personal-ai-memory Lite

This is the standalone one-click deployment package. It uses one Cloudflare Worker and one KV namespace.

Cloudflare creates the Worker and KV namespace in the deployer's own account. The deployer supplies one private `MEMORY_TOKEN`; the project author does not receive that token or the stored memories.

After deployment, connect with either:

- `https://<worker>.<subdomain>.workers.dev/mcp` and `Authorization: Bearer <MEMORY_TOKEN>`; or
- `https://<worker>.<subdomain>.workers.dev/mcp/<MEMORY_TOKEN>` for a client that accepts only one URL.

The full URL contains a secret and must be protected like a password. See the main repository for the Chinese guide, security boundaries, AI deployment prompts, and indexed profiles.
