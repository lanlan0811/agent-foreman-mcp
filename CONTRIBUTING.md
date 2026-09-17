# 贡献指南（CONTRIBUTING）

感谢你有兴趣为 `agent-foreman-mcp` 做贡献。本文说明开发环境、工程规范与提交流程。

英文版：[CONTRIBUTING.en.md](CONTRIBUTING.en.md)

---

## 1. 前置要求

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20（CI 覆盖 20 / 22 / 24） |
| 包管理器 | npm（仓库含 `package-lock.json`） |
| 操作系统 | Windows / macOS / Linux（CI 三平台矩阵） |
| Git | 用于基线分析与提交 |

## 2. 本地开发

```bash
git clone https://github.com/lanlan0811/agent-foreman-mcp.git
cd agent-foreman-mcp
npm ci                # 按 lockfile 安装
npm run build         # sync-version + tsc → dist/
npm test              # vitest（单元 + 集成 + 协议）
```

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm run build` | 同步版本号（`scripts/sync-version.mjs`）并编译到 `dist/` |
| `npm run dev` | 用 `tsx` 直接运行 `src/index.ts`（stdio 服务） |
| `npm test` | 全量测试（vitest run；真实浏览器用例默认跳过） |
| `npm run test:watch` | 监听模式 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm run lint` | ESLint，`--max-warnings 0`（零容忍） |
| `npm run check:stdio` | 严格 stdio 协议检查（构建后跑 `dist`） |
| `npm run check:stdio:src` | 同上，但直接以 `tsx` 跑源码入口（免构建） |
| `npm run format` | Prettier 格式化 `src` 与 `test` |
| `npm run pack:check` | `npm pack --dry-run`，确认发布内容 |

**真实浏览器用例**默认被跳过（`AGENT_FOREMAN_VISUAL_BROWSER_TEST !== "1"`）。要本地复算视觉验收：

```bash
AGENT_FOREMAN_VISUAL_BROWSER_TEST=1 npx vitest run visual --maxWorkers=1
```

## 3. 提交前必须通过（与 CI 一致）

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run check:stdio
```

`check:stdio` 用真实子进程捕获完整 stdout/stderr 字节流，逐个场景校验：
stdout 只允许有换行分隔的合法 MCP JSON-RPC 消息（官方 schema 校验请求/响应 ID），
空行、非 JSON 行、parser error、退出残留片段任意一条即失败。覆盖首次启动、已有技能再次启动、
`--no-skill-install`、损坏 config.json、stub 任务运行期日志、正常 EOF 关闭六个场景。

CI 额外校验两条，请本地也注意：

1. **构建后工作树无意外改动**：`npm run build` 会重写 `src/version.generated.ts`；
   改版本号时该文件必须与 `package.json` 一并提交，否则 CI 的「No unexpected tracked diff after build」会失败。
2. **tarball 内容与安装包协议**：CI 会把本次生成的 tarball 安装到干净消费者目录，
   动态读取已安装 bin 并复用 `scripts/check-stdio.mjs` 做协议验证（消费者不装开发依赖）。

## 4. 工程规范

- **语言**：代码注释、日志、错误文案、文档均为中文；对外文档需**中英双语、分两个文件**
  （`X.md` 与 `X.en.md`）。
- **不写硬编码**：机器路径、用户名、端口等一律走 profile / 配置或占位符（如 `{LOCALAPPDATA}`、`{HOME}`），
  代码只提供探测规则与默认值。
- **双系统兼容**：涉及路径/进程/信号的地方必须同时考虑 Windows 与 POSIX（CI 三平台矩阵会验证）。
- **图标用 SVG**：**禁止使用 emoji 作为图标**（状态标记同理，改用文字）。
- **stdout 只走 MCP 协议**：`src/**` 运行时代码禁止 `console.log/info/debug`，日志一律经
  `src/util/log.ts` 写 stderr（`console.error`）；ESLint `no-console` 已强制此约束，
  新增输出由 `npm run check:stdio` 的真实进程测试兜底。
- **返回契约只增不改**：工具结果同时提供文本 meta 块与 `structuredContent`，字段名**稳定、只增不改不换名**。
  新增 meta 字段必须同步登记 `src/mcp/formatter.ts` 的 `META_BLOCK_FIELDS`（协议测试会断言无未登记字段）。
- **零 lint 警告**：`npm run lint` 为 `--max-warnings 0`。
- **测试**：新功能/缺陷修复应带测试；纯函数优先做单元测试，涉及编排/协议走集成或协议测试。
- **外部输入**：一律经 zod 校验（`src/config/schema.ts`）。

## 5. 代码结构导览

```text
src/
├── index.ts              入口（stdio / visual CLI 分流）
├── server.ts             组装：配置/日志/管理器/引擎/注册表/工具注册/技能自检安装
├── config/               zod schema 与数据目录读写（热加载）
├── mcp/                  工具注册表、handler、上下文、结果格式化（双轨：文本 meta 块 + structuredContent）
├── tasks/                任务状态机、队列、并发闸、事件流落盘
├── loop/                 单任务编排（返修循环）与修复计划生成
├── agents/               adapter 抽象、registry、spawn 封装、内置 profiles、GUI 实例生命周期
│   ├── codex/            Codex 桌面端 GUI（MSIX 发现/COM 激活/CDP/选择器/运行检测/项目登记）
│   ├── zcode/            ZCode GUI（发现/CDP/项目绑定/模型/恢复/引用）
│   └── traework/         TraeWork GUI（CDP 客户端/选择器/UI/受限 computer-use）
├── verify/               验收引擎（命令检查 + 代码分析 + git 基线 + 报告）
├── visual/               视觉验收（捕获/比对/基准两阶段/规则冻结/内容校验/CLI）
└── util/                 日志、路径、文件、超时等
```

测试分层：

| 层级 | 位置 | 说明 |
|---|---|---|
| 单元 | `test/unit/` | 纯函数与组件逻辑（含技能自装的隔离验证） |
| 集成 | `test/integration/` | stub-agent 三剧本跑完整任务闭环，覆盖派活/验收/返修/取消/超时 |
| 协议 | `test/protocol/` | 官方 SDK in-memory 客户端断言工具面、双轨返回契约与参数校验 |
| 真实浏览器 | `test/integration/visual-*.test.ts` | 需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`，默认跳过；CI 的 `visual-browser` job 全跑 |
| 真实进程 | `scripts/check-stdio.mjs` | 严格 stdio 门禁：真实子进程字节流，stdout 只允许合法 MCP 消息 |
| 真机探针 | `scripts/probe-{codex,zcode,traework}.mjs` | 需真实桌面应用，**不入 CI** |

> **改项目级目录约定时**，`test/test-utils.ts` 与 `test/stub-agent/stub-agent.mjs` 是牵一发动全身的两个点。

## 6. 提交与分支规范

- **只在 `main` 分支提交**，不创建其他分支。
- **提交信息用中文**，建议 `类型: 摘要` 形式，类型可选：`feat` / `fix` / `docs` / `chore` / `test` / `refactor`。
- **一个功能一次提交**，提交前确保门禁全绿。
- 推送目标：`origin`（GitHub 主仓库）。本项目无镜像仓库。

```bash
git add .
git commit -m "feat: 新增 xxx"
git push origin main
```

## 7. 版本与发布

- 版本号遵循语义化版本；发版时：
  1. 修改 `package.json` 的 `version`；
  2. `npm install --package-lock-only` 刷新 `package-lock.json`；
  3. `npm run build` 同步 `src/version.generated.ts`；
  4. 提交并推送；
  5. 打 tag（如 `v1.0.0`）并推送 → 触发 `Release` workflow 校验
     `tag == package.json == tarball`，要求同 SHA 的成功 CI，并用双语发布说明合成正文后**直接发布**
     GitHub Release（`draft: false`）；
  6. `npm publish --registry=https://registry.npmjs.org --access public`。
- 发布前**必须先备齐** `docs/release-v<版本>.md` 与 `.en.md`——`release.yml` 缺文档会直接失败。
- 变更需同步登记到 [CHANGELOG.md](CHANGELOG.md)（英文版同步更新 `CHANGELOG.en.md`）。
- 完整发布流程见 [docs/npm-publish-guide.md](docs/npm-publish-guide.md)。

## 8. 新增一个外部 AI-Agent

绝大多数情况**无需改代码**，只需在数据目录 `agent-profiles.json` 加一段 profile：

1. 参考 [docs/agent-profiles.md](docs/agent-profiles.md) 的字段说明；
2. CLI 类：配 `command` / `argsTemplate` / `promptMode` / `cwd`；
   GUI 类：配 `driver: "gui"` 与 `gui` 段；
3. 若输出解析有特殊语义（如非 0 退出码但成功），再实现一个 `AgentAdapter` 并在 registry 注册；
4. 用 `get_profiles` 自检可执行探测，跑一次真实任务验收。

## 9. 报告问题

- Bug / 功能请求：用仓库 Issue 模板（`.github/ISSUE_TEMPLATE/`）。
- 安全漏洞：**不要**开公开 Issue，按 [SECURITY.md](SECURITY.md) 的渠道私密报告。

## 10. 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
