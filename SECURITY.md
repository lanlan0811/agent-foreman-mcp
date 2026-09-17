# 安全策略（SECURITY）

英文版：[SECURITY.en.md](SECURITY.en.md)

## 支持的版本

安全修复只面向最新发布版本。请升级到最新版后再报告问题。

| 版本 | 支持 |
|---|---|
| 1.x（最新） | 支持 |
| 更早版本 | 不支持 |

## 报告漏洞

**请不要通过公开 Issue 报告安全漏洞。**

请使用 GitHub 的私密漏洞报告通道：

1. 打开 <https://github.com/lanlan0811/agent-foreman-mcp/security/advisories/new>
2. 或在该仓库 **Security → Advisories → Report a vulnerability** 提交。

报告请尽量包含：

- 受影响版本（`npm view agent-foreman-mcp version` 或 `package.json`）；
- 复现步骤（最小可复现配置/命令）；
- 影响评估（能读什么、能写什么、是否需要本地访问）；
- 若已知，给出缓解建议。

**响应预期**：收到后 7 天内确认，30 天内给出修复或缓解计划；修复发布后会在 Release 说明与
[CHANGELOG.md](CHANGELOG.md) 中致谢（如你希望匿名请注明）。

## 安全模型（本项目的设计边界）

理解以下边界有助于判断问题是否属于「设计内行为」。

### 1. 凭证零管理

- 本 MCP **不保存、不读取、不转发**任何外部 AI-Agent 的 API key 或登录态。
- 各 agent 使用各自的登录态（例如 Codex 用 `~/.codex`，TraeWork / ZCode 用其桌面端登录态）。
- GUI 驱动只通过 CDP 操作 UI，**不接触**其凭证文件。
- **AI 内容校验（可选，默认关闭）同样不引入任何凭证管理**：MCP 不读取任何密钥，不实现任何模型/厂商
  HTTP 客户端，也不内置 agent CLI 预设。判定完全**委托给用户显式声明的本地命令**，由该命令自行使用它
  自己的登录态或密钥。MCP 只做三件事：按模板拼参数、spawn 该命令（`shell:false` + 结构化 argv）、
  解析其 stdout 末行 JSON。

**数据外发的强制力边界（务必如实理解）**：

- 图片是否离开本机**取决于用户自备命令的行为**，MCP 无法在系统层拦截。
- MCP 的强制力仅在**契约层**：`allowRemote` 默认为 `false`，未逐规则显式放行的规则**禁止**在
  `argsTemplate` 中使用字节外传占位符 `<image:base64:file>`（schema 直接拒绝该配置，不是运行期提示）。
- `agent-foreman-mcp visual doctor` 会列出每条规则的 `allowRemote` 声明供人工核对。
- 因此需要用户自行确认其命令的实际行为；MCP 不对此做含糊承诺。

### 2. 命令执行面收敛

- 验收命令来自**白名单式结构化配置**（`name` + `cmd` 为 argv 数组），**不拼接 shell 字符串**，
  不使用 `shell: true`。
- 命令在**目标项目目录**内执行，超时受 `verifyCommandTimeoutMs` 约束。
- AI 内容校验的自备命令同样以 `shell:false` + 结构化 argv 执行，超时受 `visual.content.timeoutMs`
  约束并杀进程树；用户声明的环境变量使用 `{ 子进程变量名: 宿主环境变量名 }` 引用，缺失即整轮阻塞，
  MCP 自身不读取该变量的内容。
- 任务产物（日志、报告、修复计划）只写入任务数据目录与项目内 `.agent-foreman/`。

### 3. 路径与进程

- 路径参数要求**绝对路径且目录存在**，经 `realpath` 归一化消除符号链接歧义。
- **路径闸门**：主目录本身与系统/根级目录（`/`、`/etc`、`/usr`、`/var`、`/tmp`、`/Users`、`C:\`、
  `C:\Windows`、`C:\Users`、`C:\Program Files` 等）一律拒绝；只挡精确相等的根，其子目录正常可用。
- 子进程使用 `windowsHide`、stdio 管道；终止使用进程树 kill（Windows `taskkill`，POSIX 进程组
  SIGTERM→SIGKILL）。
- 环境变量占位符（`{HOME}`、`{LOCALAPPDATA}` 等）展开时大小写不敏感，避免跨平台写法漂移。

### 4. GUI 驱动边界（三个 adapter 共同约束）

- **默认复用用户已有实例，绝不新起第二个**。
- **绝不按进程树盲杀**；终止前核对命令行归属（调试端口 + 进程名），无法确认则放弃终止并告警。
- TraeWork 的释放动作**不带 `/T`**；Codex 只停自己以专属 `user-data-dir` 启动的受管实例。
- 运行中的 ZCode 若「活着但没开 CDP 端口」，只触发 `needs_user(close_existing_instance)`，
  **绝不自动关闭**；超时或断线保留窗口，不自动点击停止。
- 传给 GUI 进程的路径一律使用原生平台形式。
- 窗口模式受 `gui.windowMode` 控制；**绝不触碰用户手动打开的默认实例**。

### 5. 桌面自动化白名单

内置原生自动化**仅**允许驱动本次由本模块新打开、且所有者进程可核验的文件夹选择对话框
（窗口标题 + 宿主进程双校验）。其他任何窗口（浏览器、终端、编辑器、系统对话框）一律拒绝并抛
`COMPUTER_USE_DENIED`。

### 6. CDP 连接边界

- CDP 仅连接**本机回环**（`127.0.0.1`），并同时核验页面标识与调试端口所属进程，避免连到他人实例。
- 不读取、复制、解密或打印宿主应用的登录数据、密钥和凭证。
- 不调用宿主应用安装包内未公开的内部协议。

### 7. 权限审批

工具上的 `requireApproval` 是**下发给宿主的元数据**，不是安全边界本身。

| 类别 | 工具 | `requireApproval` |
|---|---|---|
| 写 / 执行 | `run_task`、`cancel_task`、`rework_task`、`continue_task`、`prepare_visual_baseline`、`approve_visual_baseline` | `true` |
| 读 / 查询 / 验收 | `query_task`、`list_tasks`、`get_task_report`、`verify_task`、`get_profiles` | `false` |

> 工具同时通过 MCP `annotations` 声明 `readOnlyHint` / `destructiveHint` / `openWorldHint`。
> **实际授权控制必须由宿主实施**——标注本身不构成安全边界。

### 8. 视觉基准完整性

- 基准只能经**用户审阅后**由 `approve_visual_baseline` 写入，且必须带 `expectedDigest` 与 `approvalNote`。
- 写入前核对**三向摘要**（候选 + 原基准 + 配置），防止中间被替换。
- **自动返修路径禁止调用批准入口**。
- 任务期内配置或基准被改动 → `VISUAL_INTEGRITY`，防止 agent 削弱验收规则来「通过」。

### 9. 代码保护

- 动工前采集 git 基线（HEAD + 脏状态）；验收报告相对基线计算变更。
- **不自动** commit / stash / 回滚；需要回滚由用户基于报告自行决定。
- Codex 状态备份采用「只在不存在时创建」的防覆盖语义，并兼容识别旧品牌后缀，保住用户原始回滚点。

## 依赖与供应链

运行时依赖（发布产物中分发）：

| 依赖 | 许可 | 用途 |
|---|---|---|
| `@modelcontextprotocol/sdk` | MIT | MCP 协议实现 |
| `zod` | MIT | 外部输入校验 |
| `cross-spawn` | MIT | 跨平台子进程 |
| `puppeteer-core` / `@puppeteer/browsers` | Apache-2.0 | GUI 驱动与受管浏览器 |
| `pixelmatch` | ISC | 视觉像素比对 |
| `sharp`（optional） | Apache-2.0 | 图像处理（缺失时视觉模块明确阻塞，不静默降级） |

- 提交前 `npm audit` 应无已知漏洞；CI 在 Ubuntu / Windows / macOS × Node 20/22/24 上运行类型检查、
  lint、测试与构建。
- 发布物经 `npm pack` 内容校验（必须含 `dist/`、`skills/`、双 README、LICENSE、`assets/`）。

## 不在范围内

- 外部 AI-Agent 自身的行为与漏洞（请向其厂商报告）。
- 用户自行在 profile 中填写的 `env` 敏感值（属本机自担风险字段，不会写入任务日志）。
- 用户自备的 AI 内容判定命令本身的行为（含是否外传图片）。
- 因用户手动授予过高系统权限而导致的越权。
