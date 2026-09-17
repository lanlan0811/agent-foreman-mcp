# Agent 能力矩阵（adapter-matrix.md）

[English](adapter-matrix.en.md)

记录**外部 AI-Agent 接入路线的调研结论与当前状态**。本文件与 [agent-profiles.md](agent-profiles.md) 配套：本文件回答「为什么这个 agent 这样接」，后者回答「profile 字段怎么写」。

## 接入原则

1. **优先官方接口**：有官方 headless CLI/API 就走 `driver: "spawn"`。
2. **GUI 路线必须可严格核验**：Electron 桌面产品仅在能核验**产品、进程、项目、会话**四要素时，才使用隔离的 GUI adapter（CDP）。
3. **不调用未公开内部协议**，不 pty 硬接，不做无核验的通用 GUI 自动化。
4. **登录态不落本 server**：各 agent 用各自登录态，本 MCP 不读取/存储/转发凭证。

## 汇总矩阵

| Agent | 接口类型 | driver / adapter | status | 可执行发现 | 登录态 | 任务/文件回读 |
|---|---|---|---|---|---|---|
| **Codex 桌面端** | MSIX 商店包 + **CDP GUI 驱动** | `gui` / `codex-gui` | **ready**（darwin 为 `research`） | Appx 查询优先，扫盘回退 | 复用 `~/.codex` 登录态（受管实例另有专属 profile） | 从 DOM 提取回复；项目文件由 Codex 自身写入 |
| **ZCode 桌面端** | Electron + **CDP GUI 驱动** | `gui` / `zcode-gui` | **research** | 桌面程序路径探测，不把运行时数据当入口 | 复用 ZCode 桌面端登录态 | 从 DOM 提取；支持无项目派发 |
| **TraeWork / TRAE SOLO CN** | 桌面 IDE + **CDP GUI 驱动** | `gui` / `traework-gui` | **ready** | 无头 CLI 不存在；以 `--remote-debugging-port` 驱动聊天 UI | 复用 TraeWork 桌面端登录态 | 从 DOM 提取回复；项目文件由 TraeWork 自身写入 |
| **codex-cli**（用户自建） | 官方 CLI | `spawn` | 用户自定 | PATH / `executableDiscovery` | 复用 `~/.codex` | 按退出码判定 |
| **stub**（测试用） | 本地脚本 | `spawn` | 仅测试 | 测试注入 profile | 无 | 固定剧本 |

`status` 语义：`ready` = 当前平台闭环已验证；`research` = 已实现但矩阵未覆盖（**仍可执行**）；`unsupported` = 明确不支持。

## 为什么三个 GUI agent 都只能走 CDP

| 约束 | 说明 |
|---|---|
| **无头 CLI 缺失** | TraeWork 与 ZCode 的安装目录里没有任何 agent 驱动子命令（详见下方逐项调研）。 |
| **请求在客户端内加密** | TraeWork 的 agent 请求在 TTNet 层 TDE 加密，无法在客户端外构造 → 驱动完整客户端是唯一可行路径。 |
| **MSIX 无法直启** | Codex 桌面端是 MSIX 商店包，GUI 宿主无法 `CreateProcess` 直启 → 必须 COM 激活 + 专属 `user-data-dir`。 |

## Codex 桌面端（`codex-gui`，status `ready`）

Codex 桌面端自带一个内核 CLI，但**内置适配走 GUI 路线**，原因与取舍：

- **GUI 路线（内置）**：与用户日常使用同一入口，模型 / 思考等级 / 项目绑定等能力完整；需 MSIX COM 激活 + 专属 `user-data-dir` 才能开 CDP 端口。
- **无头路线（用户可选自建 profile）**：不想依赖 GUI 自动化时，可在数据目录加一个 `driver: "spawn"` 的 profile 走 `codex exec`。示例见 [README](../README.md) 的「无头路径：codex-cli」。

> 走 `codex exec` 需注意：`--sandbox` 与 `--approve-for-me` **互斥**，非交互自动化用 `--sandbox workspace-write` 即可（实测 approval 输出为 never）；`-C/--cd` 指定工作根，配合 `cwd: "task"` 双保险；`--json` 输出 JSONL 事件，`-o/--output-last-message` 取末条消息。

GUI 路线细节（MSIX 发现、COM 激活、CDP、选择器、运行检测）见 [codex-gui-cdp.md](codex-gui-cdp.md)。

## ZCode 桌面端（`zcode-gui`，status `research`）

**结论：无头路线不支持；GUI 路线已实现。**

调研证据（仅针对无头路线）：

- 安装目录为标准 Electron 布局（`ZCode.exe` + `resources/app.asar`），无 `cli.js` / headless launcher / `cli.exe`。
- `resources/tools/` 仅打包 `cua-helper`（computer-use）、`ripgrep`、`ugrep` 等应用内部辅助，无 agent 驱动命令。
- 应用运行时数据目录（会话与配置）**不是可执行入口**——探测时必须排除，避免把数据文件当 CLI。
- `%PATH%` / npm 全局无 `zcode` 命令。

因此内置 adapter 改走 CDP 驱动桌面 UI，并支持 `needs_user` / `continue_task` 与自动验收返修。实现与踩坑见 [zcode-cdp.md](zcode-cdp.md)。

> `status` 保持 `research` 的原因：Windows 真机闭环已完成，但取消 / 返修 / 新建项目矩阵在 darwin 未覆盖。

## TraeWork / TRAE SOLO CN（`traework-gui`，status `ready`）

**结论：无头 CLI 确实不存在——但 CDP GUI 驱动可行，已实现并真机验证。**

无头路线调研证据：

- 应用为 Electron（product.json `name: TRAE SOLO CN`），提供过的 CLI 仅 VS Code 家族命令
  （`open` / `serve-web` / `install-extension` / `list-extensions` / `tunnel` / `command` 等），
  **没有任何 headless agent 驱动子命令**。
- 全安装目录搜索无独立 agent CLI 二进制。
- 扩展中的 `byted-solo.builtin-mcp` 是 **MCP 客户端**扩展（供 IDE 内接 MCP server），
  属 IDE 侧能力，**不是可供本 server 外部调用的无头接口**。

GUI 路线（已接入）：

- 连接：`TRAE SOLO CN.exe --remote-debugging-port=<port>` → `GET /json` 取页面 WS。
- 已实测选择器：聊天输入框、新建任务、任务列表、模式切换器、模型下拉、项目文件夹下拉。
- 项目登记：下拉未命中时经 Windows 原生对话框写入路径。
- 端到端：`run_task(agentId="traework", model=..., autoVerify=true)` 驱动其创建文件并验收通过。

**为什么不走 HTTP 直连**：agent 请求在 TTNet 层 TDE 加密，无法在客户端外构造；CDP 驱动完整客户端是唯一可行路径。

实现与踩坑记录见 [traework-cdp.md](traework-cdp.md)。

## 扩展新 agent（三步）

1. **数据目录加 profile**（见 [agent-profiles.md](agent-profiles.md)）；默认能力够用则**零代码**。
2. **需要特殊输出解析**（如非 0 退出码但成功、要解析 JSON 结果）→ 实现 `AgentAdapter` 并 `registry.register(id, adapter)`。
3. **验证**：`get_profiles` 自检可执行探测，跑一次 stub 或真机冒烟任务到验收通过。

### 候选评估清单

评估一个新 agent 是否值得接入时，逐项确认：

| 问题 | 若「否」 |
|---|---|
| 有官方 headless CLI/API 吗？ | 走 GUI 路线，需满足下方四要素 |
| GUI 路线能核验**产品标识**（窗口/页面标识）吗？ | 不接入 |
| 能核验**进程归属**（调试端口所属进程）吗？ | 不接入 |
| 能核验**项目绑定**（完整路径判据）吗？ | 不接入 |
| 能核验**会话/运行状态**（运行信号、完成标志）吗？ | 不接入 |

四要素任一无法严格核验，就不应接入——宁缺勿滥，避免做出会误操作真实工作区的适配器。

## 平台状态一览

| Agent | Windows | macOS | 说明 |
|---|---|---|---|
| `codex` | `ready` | `research` | macOS 基本闭环已真机验证；取消/返修矩阵未覆盖 |
| `zcode` | `research` | `research` | 两侧基本闭环均已验证；取消/返修/新建项目矩阵未覆盖 |
| `traework` | `ready` | 未接入（fail-closed） | 原生对话框驱动未在 macOS 实测 |
| `stub` | 仅测试 | 仅测试 | 不参与真机矩阵 |
