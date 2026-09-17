# npm 发布指南（npm-publish-guide.md）

本仓库 `agent-foreman-mcp` 的发布流程。**发布动作需要 npm 凭据，由维护者执行**；本文档记录完整步骤与核验口径，确保任一次发布都可复现。

## 0. 前置门禁（缺一不可）

发布前必须在目标提交上跑通全部本地门禁：

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run check:stdio      # stdout 只允许 MCP 协议消息
npm run pack:check       # 产物内容核对
```

并且该提交在 CI 上三平台（ubuntu / windows / macOS × Node 20/22/24）全绿——`release.yml` 会强制要求**同一提交存在成功 CI**，否则拒绝发布。

## 1. 版本号

发布版本以 `package.json` 的 `version` 为**单一事实来源**，三处必须一致：

| 位置 | 说明 |
|---|---|
| `package.json` | 手工修改 |
| `package-lock.json` | `npm install --package-lock-only` 刷新 |
| `src/version.generated.ts` | **勿手改**，`npm run build` 时由 `scripts/sync-version.mjs` 自动生成 |

## 2. 凭据（二选一）

### 方式 A：命令行登录

```bash
npm login --registry=https://registry.npmjs.org
```

按提示输入用户名 / 密码 / 邮箱 + 一次性验证码，成功后 `~/.npmrc` 写入 `_authToken`。

> 若本机 `~/.npmrc` 指向镜像 registry（如 npmmirror），`npm login --registry` 会把登录写入 npmjs 段、互不冲突。**但发布时必须显式带 `--registry=https://registry.npmjs.org`**（镜像只读）。

### 方式 B：Granular Access Token

1. https://www.npmjs.com → 头像 → **Access Tokens** → **Generate New Token**。
2. 类型选 **Granular** 或 **Publish**（仅发布权限足够）。
3. 使用（不落盘）：

```bash
export NODE_AUTH_TOKEN=npm_xxxx          # Windows PowerShell: $env:NODE_AUTH_TOKEN="npm_xxxx"
npm publish --registry=https://registry.npmjs.org --access public
```

## 3. 发布

```bash
npm publish --registry=https://registry.npmjs.org --access public
```

## 4. 发布后核验（必须逐条留存）

```bash
# ① registry 能查到该版本
npm view agent-foreman-mcp version --registry=https://registry.npmjs.org

# ② 全新临时目录用 npx 拉起，做协议冒烟（应能看到 11 个工具）
mkdir -p /tmp/npx-smoke && cd /tmp/npx-smoke
npx -y agent-foreman-mcp

# ③ tarball 可下载且指向正确
npm view agent-foreman-mcp dist.tarball --registry=https://registry.npmjs.org
```

## 5. GitHub Release

推送 `v<version>` tag 触发 `.github/workflows/release.yml`：

1. 校验 tag / 输入版本与 `package.json` 一致；
2. `npm pack` 并对产物做内容断言与干净消费者 stdio 检查；
3. 要求该提交有成功 CI；
4. 用 `scripts/release-body.mjs` 合成正文——**正文取自 `docs/release-v<version>.md` 与 `.en.md`，缺文档会直接失败**（避免产出只有 Full Changelog 的空壳）；
5. 创建 Release 并附上 `agent-foreman-mcp-<version>.tgz`。

> **首次发版（1.0.0）说明**：仓库此前无 tag，`git describe` 找不到上一版本，Full Changelog 会回退为 `commits/v1.0.0` 链接。这属预期行为，不是缺陷；从 v1.0.1 起恢复 `compare/v1.0.0...v1.0.1` 形式。

## 6. 常见问题

| 问题 | 处理 |
|---|---|
| `ENEEDAUTH` / `401` | token 未生效：`npm whoami --registry=https://registry.npmjs.org` 应返回用户名 |
| 想用镜像加速但发到 npmjs | 镜像只读；发布必须走 `--registry=https://registry.npmjs.org` |
| `release.yml` 报缺发布说明 | 先写 `docs/release-v<version>.md` 与 `.en.md` 再推 tag |
| `release.yml` 报「目标提交尚无成功 CI」 | 等该提交的 CI 跑绿，或先修 CI |
| 包名被占 | 本包名已确认可用；若将来失效，需改名并同步 `package.json` / README / 文档 / CI |

## 7. 不发布旧包

历史上的 `tianshu-mcp` 是**另一个独立项目**。本仓库**不发布、不 deprecate、不触碰**它的 npm 包，其继续独立维护。本项目的发布只针对 `agent-foreman-mcp`。
