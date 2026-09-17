# ARCHITECTURE.md — agent-foreman-mcp 架构说明

> 本文描述**系统结构、模块边界与关键不变量**，面向要改动本仓库的开发者。
> 安装、宿主接入与用法见 [README.md](README.md) 与 [宿主接入指南](docs/host-integration.md)；
> 交接状态、排障手册与踩坑记录见 [HANDOFF.md](HANDOFF.md)。
> 英文版：[ARCHITECTURE.en.md](ARCHITECTURE.en.md)。

---

## 1. 定位与系统上下文

`agent-foreman-mcp` 是一个**面向任意 MCP 宿主的通用编排层**。宿主（Claude Desktop / Cursor / ZCode / Cline / Windsurf / 任意 stdio 宿主）是总指挥与用户交互面，本 server 承担三件事：

1. **调度**——任务队列、并发闸、状态机、超时与取消；
2. **执行面**——把任务书送达外部 AI-Agent（Codex 桌面端 / TraeWork / ZCode / 任意 CLI）；
3. **客观验收仪**——相对 git 基线做命令检查、代码分析与（可选）视觉像素比对，产出报告。

```text
┌─────────────────────────────────────────────────────────────┐
│ MCP 宿主（Claude Desktop / Cursor / ZCode / Cline / …）        │
│   · 按次调用 tools/call                                       │
│   · 消费 content[].text + meta 块，或 structuredContent       │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP over stdio（stdout 仅承载 JSON-RPC）
┌───────────────────────────▼─────────────────────────────────┐
│ agent-foreman-mcp（本仓库）                                   │
│   调度 ── 执行面 ── 验收仪                                    │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
   ┌───────▼────────┐            ┌────────▼─────────┐
   │ 外部 AI-Agent   │            │ 目标项目工作区     │
   │ GUI：CDP 驱动 UI│            │  git 仓库 + 测试  │
   │ CLI：子进程      │            │  .agent-foreman/  │
   └────────────────┘            └──────────────────┘
```

### 1.1 硬约束，以及它们造成的架构后果

本项目的形态不是自由设计的结果，而是若干条**实测硬约束**逼出来的。改架构前必须先读这张表：

| # | 实测约束 | 架构后果 |
|---|---|---|
| C1 | **源流约束**（前身项目时期的宿主限制）：当时的宿主对 MCP 工具**只回文本**——`content[]` 的 `text` 被拼成字符串，`isError` 透传 | 该限制在本项目**已由 structuredContent 双轨解除**：结果同时提供「人类可读文本 + `---agent-foreman-meta---` JSON 块」与 MCP 标准 `structuredContent`；仍不依赖 resources / prompts（`src/mcp/formatter.ts`）。保留文本块是为兼容只认文本的旧式宿主 |
| C2 | **源流约束**（前身项目时期的宿主限制）：当时的宿主**按次同步**调用 `tools/call` | 长任务仍异步化：`run_task` 秒回 `taskId`，用 `query_task` 轮询；无服务端推送。这是通用做法，非某宿主特有约束 |
| C3 | TraeWork 的 agent 请求在 TTNet 层 TDE 加密，无法在客户端外构造 | 唯一可行路径是 **CDP 驱动桌面 UI**，从 DOM 提取结果（`src/agents/traework/`） |
| C4 | Codex 桌面端是 **MSIX 商店包**，GUI 宿主无法 `CreateProcess` 直启 | 必须经 `IApplicationActivationManager` COM 激活并注入专属 `--user-data-dir` 才能开 CDP 端口（`src/agents/codex/launcher.ts`） |

C3/C4 是 **agent 侧**约束（被驱动的桌面应用本身），与宿主无关，独立化后依然成立。ZCode 属于同类问题：无随包 headless CLI，故同样走 CDP。

---

## 2. 分层架构总览

```text
┌──────────────────────────────────────────────────────────────────┐
│ L1 协议边     src/index.ts · src/server.ts · src/mcp/             │
│   入口与 CLI 分流 · 装配 · 11 工具注册 · 参数校验 · 双轨格式化       │
├──────────────────────────────────────────────────────────────────┤
│ L2 任务域     src/tasks/                                           │
│   状态机 · 每项目串行队列 · 全局并发闸 · 事件流落盘 · 取消语义        │
├──────────────────────────────────────────────────────────────────┤
│ L3 编排       src/loop/                                            │
│   TaskOrchestrator：派发 → 验收 → 返修 → 再验收；轮次记账与终止判定   │
├───────────────────────────────┬──────────────────────────────────┤
│ L4a 执行面    src/agents/      │ L4b 验收面  src/verify/ src/visual/│
│   AgentAdapter 契约            │   git 基线 · 命令检查 · 代码分析    │
│   CLI spawn / GUI CDP 驱动     │   视觉像素比对 · 报告产物           │
├───────────────────────────────┴──────────────────────────────────┤
│ L5 基础       src/config/ · src/util/                              │
│   zod schema · 数据目录 · 热加载 · 原子写 · 路径归一 · 日志 · 技能自检 │
└──────────────────────────────────────────────────────────────────┘
```

依赖方向**严格单向向下**：L1 → L2 → L3 → {L4a, L4b} → L5。L4a 与 L4b 互不依赖，只在 L3 汇合；这是本项目最重要的解耦边界——**「谁来干活」与「怎么算干得好」是两件独立可替换的事**。

---

## 3. 启动装配与生命周期

### 3.1 入口分流（`src/index.ts`）

```text
node dist/index.js                → stdio MCP server
node dist/index.js visual <cmd>   → 视觉验收 CLI 子命令族
                                   （在建立 stdio 连接之前分流，不占用协议流）
```

- 数据目录由 `resolveDataHome()` 解析：环境变量 `AGENT_FOREMAN_HOME` 优先，否则 `~/.agent-foreman`。
- 日志器初始化到 `<数据目录>/logs/`。
- 技能自检安装可经 `--no-skill-install` 或 `AGENT_FOREMAN_NO_SKILL_INSTALL=1` 关闭。
- 退出路径：`SIGINT` / `SIGTERM` / stdin EOF / stdin close → 归档活动任务并终止子进程 → `exit(0)`。

### 3.2 组装顺序（`src/server.ts`）

`buildServer()` 是唯一的装配点，顺序有语义：

```text
resolveDataHome → Logger → DataHome(BUILTIN_PROFILES) → init()
  → loadConfig() → maxRunning
  → TaskStore → AgentAdapterRegistry(loadProfiles) → AcceptanceEngine
  → TaskManager(+makeBuildCtx) → manager.initialize(maxRunning)   # 归档重启遗留的 active 任务
  → 技能自检安装（后台，不阻塞握手）
  → 注册 11 个工具 → 返回 ServerAssembly{server, manager, dataHome, store, logger, close}
```

`close()` = `manager.shutdownInterrupt()`（归档活动任务 + 终止子进程）→ `engine.close()` → `server.close()`。

工具注册是**数据驱动**的：遍历 `TOOL_DEFS`，按名字在 `handlers` 里取实现，缺失即 log error 并跳过；`registerTool` 时顺带下发 `inputSchema` / `outputSchema`、`_meta.requireApproval`、`_meta.capability` 与 MCP `annotations`（readOnly / destructive / openWorld），供宿主策略层使用。

### 3.3 数据目录布局

```text
<数据目录>/                       默认 ~/.agent-foreman
├── config.json                  server 配置（并发、超时、技能开关）
├── agent-profiles.json         用户自定义/覆盖的 agent profile
├── projects.json                项目登记表（含每项目验收配置）
├── logs/server.log             全级别诊断日志（与 stderr 同源）
├── browsers/                    视觉模块托管的 Chrome（managed 模式）
├── visual-candidates/<uuid>/    待批准基准候选（candidate.json + PNG + preview.html）
├── visual-locks/<sha256>.lock   视觉操作互斥锁
└── tasks/<taskId>/              单任务隔离目录（见下）
```

单任务目录（`src/tasks/task-store.ts`）：

| 文件 | 内容 |
|---|---|
| `task.jsonl` | 追加式事件流（唯一权威时间线） |
| `task.json` | 最新 `TaskMeta` 快照（原子写） |
| `baseline.json` | 动工前的 git 基线 |
| `agent-<round>.log` | agent 输出（round 从 0 起） |
| `verify-<round>.log` | 验收命令输出 |
| `report-<round>.md` / `.json` | 验收报告（`.md` 人读，`.json` 机读） |
| `report-<round>.html` | 视觉离线报告，**仅当报告含视觉结果时**生成 |
| `rework-<taskId>-r<round>.md` | 返修计划（非 Codex 路径） |
| `visual/<round>/<pageId>/<viewportId>/` | 视觉四联图：`actual/baseline/diff/regions.png` + `metrics.json` |
| `visual-snapshot.json` | 任务期冻结的视觉规则快照 |

**项目侧产物**：

| 路径 | 内容 |
|---|---|
| `<项目>/.agent-foreman/acceptance.json` | 项目级验收配置（**唯一**读取路径，不读取任何旧目录） |
| `<项目>/tests/visual/baselines/...` | 视觉基准 |
| `<项目>/.agent-foreman/plans/codex-fix-r<N>.md` | Codex 路径的修复计划（`gui.fixPlanDir` 默认值，profile 可覆盖） |

**技能安装**：server 启动时幂等同步仓库 `skills/agent-foreman-mcp/` → **`~/.agents/skills/agent-foreman-mcp/`**（Agents Skills 开放标准）。该路径由 `os.homedir()` 解析，**不受 `AGENT_FOREMAN_HOME` 影响**。

---

## 4. MCP 工具面与返回契约

11 个工具（`src/mcp/tools.ts`），按能力分为读与写两族：

| 工具 | 能力 | 审批 | 作用 |
|---|---|---|---|
| `run_task` | write | 是 | 派活，异步返回 `taskId` |
| `continue_task` | write | 是 | 恢复 `needs_user` 的原会话 |
| `query_task` | read | 否 | 轮询状态 / 进度 / 日志尾 |
| `list_tasks` | read | 否 | 历史任务列表（可按项目/状态过滤） |
| `get_task_report` | read | 否 | 取某轮 `report.md` 全文 |
| `cancel_task` | write | 是 | 取消（CLI 杀进程树；GUI 尽力点停止 + 有界等待） |
| `verify_task` | read | 否 | 对任务或项目路径做一次验收（不改源码） |
| `rework_task` | write | 是 | 手动返修，把失败摘要喂回同一 agent |
| `get_profiles` | read | 否 | agent 适配与可执行探测结果 |
| `prepare_visual_baseline` | write | 是 | 生成基准候选与摘要（不落正式基准） |
| `approve_visual_baseline` | write | 是 | 用户审阅后核对摘要并写入基准 |

> **审批是标注，不是边界**：`_meta.requireApproval` 与 `annotations` 只是下发给宿主的元数据，**实际授权控制必须由宿主实施**。

**返回契约（双轨，`src/mcp/formatter.ts`）**：同一份 `MetaBlockFields` 对象**双投递**——

1. **文本轨**：人类可读正文 + 尾随元块，便于只认文本的宿主正则抽取；
2. **结构化轨**：MCP 标准 `structuredContent`，现代宿主直接消费结构化字段。

```text
<人类可读文本>
---agent-foreman-meta---
{ ...MetaBlockFields: taskId, status, ok, round, changedFiles, diffstat, ... }
---agent-foreman-meta---
```

```jsonc
// 同一对象的另一条投递路径（structuredContent）
{ "ok": true, "taskId": "tsk_…", "status": "succeeded", "round": 1, "message": "…" }
```

**契约纪律**：工具声明了宽松 `outputSchema`（`TOOL_OUTPUT_SHAPE`，字段全部可选 + `passthrough`），客户端会按其校验 `structuredContent`。因此**顶层对象必须稳定、字段只增不改不换名**——改名字段等于破坏已发布的返回契约。`META_BLOCK_FIELDS` 是字段名的单一事实来源，协议测试会断言 meta 块不出现未登记字段。视觉基准类工具返回自由结果对象，统一信封为 `{ ok, message, result }`；`get_task_report` 返回报告原文，结构化侧给出 `reportRound` 与 `reportFiles` 定位信息。

**错误路径同样双轨**：`errorResult()` 统一产出 `{ ok: false, message }`（`src/server.ts` 的参数校验失败与 handler 异常两条直返都经它）。**注意区分**：*schema 级*非法参数由 SDK 在协议层拦截，返回 JSON-RPC 错误（`-32602`，协议上不可能携带 `structuredContent`）；而 handler 内抛出的语义错误走 `errorResult`，带完整 `structuredContent`。

**参数校验是两段式的**：`server.ts` 先用 `inputSchema.safeParse()` 做协议级校验；handler 内再做语义闸门，例如 `projectPath` 安全校验（绝对路径 + 存在 + realpath 归一 + 拒绝主目录与根级/系统目录）、`mode` 仅 TraeWork 可用的拒绝、`allowCreateProject` 仅 ZCode 可用等。

进度**只落盘、不推送**：GUI adapter 按 `gui.progressIntervalMs`（默认 30s）回报进度，`TaskOrchestrator` 写成 `task.jsonl` 的 `note` 事件并刷新快照的 `progressSummary` / `lastRunSignal`；`query_task` 每次读取最新快照与事件流，因此轮询者看到的是「最后一次落盘的进度」。

---

## 5. 任务域：状态机、队列与持久化

### 5.1 状态机（`src/tasks/task.ts`）

```text
   run_task ──► queued ──► running ──► verify_start ──┬──► succeeded
                  ▲          ▲            │           ├──► failed
                  │          │            ▼           └──► needs_attention
                  │          └──── fixing ◄───────────┘
                  │
                  ├──► needs_user ──► queued   (continue_task 恢复)
                  ├──► cancelled
                  └──► interrupted
```

- **终态**：`succeeded` / `failed` / `needs_attention` / `cancelled` / `interrupted`。
- `needs_user` 是**暂停态**而非终态：`continue_task` 可把它推回 `queued`（仅 codex / zcode）。
- 状态迁移全部经 `task.jsonl` 事件流落盘，重启后可回放。

### 5.2 队列与并发

- **每项目串行**：同一 `projectPath` 的任务排队，避免两个 agent 同时改同一个工作区。
- **全局并发闸**：`concurrency.maxRunning`（默认 2）限制同时运行的任务数。
- **重派护栏**：同项目已有未停止的运行 → `instance_busy` 直接拒绝派发，防止新旧 turn 交叠。
- **无项目模式**（ZCode 专用）：省略 `projectPath` 时走 `default` 工作区，不登记项目、不采集 git 基线、不冻结项目快照、不进项目锁与项目验收；终态以 `not_applicable: no_project` 结构化标注。

### 5.3 持久化与原子写

所有落盘写操作都走**原子写**（临时文件 + rename），避免半写状态被读到。`task.json` 是快照、`task.jsonl` 是权威时间线；两者不一致时以事件流为准。

### 5.4 取消语义

| agent 类型 | 取消动作 |
|---|---|
| CLI（spawn） | 终止进程树（POSIX 先 SIGTERM 后 SIGKILL 进程组；Windows 走 `taskkill`） |
| GUI（codex / zcode / traework） | 经 CDP 尽力点击界面停止按钮，并在 `gui.cancelWaitMs`（默认 15s）内有界等待 GUI 空闲 |

**取消不得谎报**：未确认停止时终态必须明示「GUI 内运行未确认停止」。`needs_user` 状态下 MCP 侧已无 CDP 连接，无法停止 GUI 内等待中的会话，终态文案如实提示需人工检查。

---

## 6. 编排：自动验收与自动返修闭环

`src/loop/fix-loop.ts` 的 `TaskOrchestrator` 是闭环的唯一实现：

```text
queued →（派发）running → agent 结束
   → autoVerify? verify_start → 验收
        ├─ 通过 ─────────────────────────────► succeeded
        ├─ 失败 且 轮次 < autoFixRounds ─────► fixing（生成返修计划 → 下一轮 running）
        ├─ 失败 且 轮次用尽 ─────────────────► needs_attention
        └─ 验收阻塞（配置/视觉阻塞）────────► needs_attention
   → autoVerify=false ──────────────────────► 按 agent 终态判定
```

关键点：

- **返修计划**：验收失败时自动生成修复计划文档。Codex 路径落**项目内** `gui.fixPlanDir`（默认 `.agent-foreman/plans/`），文件名含轮次号、每轮独立不覆盖，并在返修指令里直接引用；其他 agent 落任务目录。
- **轮次优先级**：调用参数 > agent 缺省（codex 5、zcode 2；traework 未设缺省）> server 默认 0（不开启）。
- **视觉阻塞不触发返修**：`rework_task` 对阻塞任务**先重新验收**（不启动 agent、不消耗返修轮次），通过即结束。
- **feedback 竞态**：`startTask` **启动时**原子取走并清空 `reworkFeedback`（不在收尾 delete），保证「失败 → 立即 rework」时返修轮一定拿到反馈。

---

## 7. 验收引擎

`src/verify/` 是「怎么算干得好」的客观实现，相对 **git 基线**计算。

### 7.1 检查项来源与优先级

```text
extraChecks 参数 > 项目 .agent-foreman/acceptance.json > projects.json 管理员补录 > 按技术栈推导的默认集
```

- 默认集从 `package.json` 的 `scripts` 推导 `typecheck / lint / test / build`；无可运行命令时标注**弱验收**。
- `checksMode` 默认 `append`（追加），`replace` 才替换基础集。

### 7.2 三类检查

| 类别 | 内容 |
|---|---|
| **命令检查** | 结构化 argv（`shell:false`）执行，捕获退出码与输出尾部；支持 `optional` 标记（失败不影响 verdict） |
| **代码分析** | 确定性规则：TODO/FIXME、`console.log`/`debugger`、疑似密钥形态、超大单文件改动、变更清单与 diffstat |
| **视觉检查** | 可选模块，见 §9 |

> 代码分析是**确定性规则，不是 LLM 评审**——命中仅提示人工复核，不等同于任务失败。

### 7.3 fail-closed 不变量

1. **零用例判失败**：测试命令退出码 0 但输出显示零用例 → 判失败（防止「测试没跑也算过」）。
2. **requireChanges 门禁**：git 项目默认要求相对动工前基线**产生变更**（防止 agent「什么都没做却报成功」）。纯只读/排查任务必须显式设 `requireChanges: false`，否则必然失败。
3. **缺失依赖明确阻塞**：视觉相关依赖（`sharp` / `pixelmatch` / `puppeteer-core`）缺失时**明确报阻塞**，不静默降级。

### 7.4 并行度

命令检查默认**有界并行 2**（`verifyConcurrency`，范围 1–4，越界值 clamp 而不株连整份配置）。检查项之间有顺序依赖时（后续检查读 build 产物、带 `--fix`、共享缓存目录）必须设 `1` 退化为串行，否则偶发误报。结果**按声明顺序**返回，报告与日志格式不受并行度影响。

### 7.5 报告产物

每轮验收产出 `report-<round>.md`（人读）与 `report-<round>.json`（机读，含 `checks[]` 的 PASS/FAIL/SKIP、`analysis` 段落），启用视觉时额外产出 `report-<round>.html` 离线报告（并排 / 叠加 / 区域定位）。

---

## 8. Agent 驱动层

### 8.1 `AgentAdapter` 契约（`src/agents/adapter.ts`）

```text
run(taskCtx)     执行任务：把任务书送达 agent，观察至结束，返回终态与产物
cancel(taskCtx)  尽力停止当前运行
resolve()        解析可用性：发现安装、探测可执行、返回 status 与说明
```

两条执行面由 profile 的 `driver` 选择：

| driver | 实现 | 适用 |
|---|---|---|
| `spawn` | `src/agents/spawn.ts` + `src/agents/cli.ts` | 有 headless CLI/API 的 agent；用户自建 profile 走这条 |
| `gui` | `src/agents/{codex,zcode,traework}/` | 只能靠桌面 UI 驱动的 agent（C3/C4 约束） |

### 8.2 GUI 实例生命周期（`src/agents/gui-instance.ts`）

| 关注点 | 规则 |
|---|---|
| 复用 | `gui.windowMode = "reuse"`：默认复用用户已打开的实例，**绝不新起第二个** |
| 受管实例 | Codex / ZCode 以专属 `user-data-dir` 启动受管实例；**绝不触碰用户手动打开的默认实例** |
| 保留 | Codex / ZCode 几乎在所有返回路径都置 `keptInstance: true` 且从不杀进程；TraeWork 仅在干净完成时释放自己启动的实例 |
| 归属核对 | TraeWork 释放前核对命令行含调试端口 + exe 名，且 `taskkill` **不带 `/T`**；Codex 只停受管实例 |
| 孤儿处理 | ZCode 遇到「活着但没开 CDP 端口」的实例 → `needs_user(close_existing_instance)`，交由用户处理，**绝不盲杀** |

> **`detached: true` 是不变量而非平台偏好**：桌面实例必须跨 MCP server 退出继续存活，才能兑现 `keptInstance` 的语义。
> 注意语义相反的另一族：**执行型子进程**（`agents/spawn`、`verify/runner`、`visual/services`）必须随 server 一起收干净，因此它们按平台分支。

### 8.3 三个 GUI adapter 的执行顺序

**TraeWork**：

```text
确保实例可用 → 等待 UI 就绪 → 新建会话 → 切到目标模式 → 在目标模式内绑定项目 → 切模型 → 发送 → 轮询到完成
```

> **关键事实**：Work / Code / Design **各自维护独立的项目绑定**，切模式会把输入栏项目换成该模式上次使用的项目。因此必须**先切模式、再在目标模式里绑定**，绑定后复核「模式 + 项目」双双就位，任一不符即响亮失败。

**ZCode**：

```text
发现安装 → 启动/复用 CDP 实例（共同截止时间预算） → 绑定项目（触发器逐级定位 + 完整路径判据）
  → 选模型（直选优先，provider/family 分组兜底，回读解码稳定属性） → 完全访问权限
  → 发送（按钮就绪检查 → 标记/会话差集定位） → 运行检测/提问检测 → 轮询到完成
```

> 提问、登录页、旧实例无 CDP、macOS 辅助功能权限、自动恢复未完成分别转
> `agent_question` / `login_required` / `needs_user(close_existing_instance)` / `system_permission` / `setup_recovery`，由 `continue_task` 恢复。

**Codex**：

```text
MSIX 发现（Appx 查询优先 + 扫盘回退） → COM 激活 + 专属 user-data-dir + CDP 端口 → 项目登记/绑定
  → 选模型与思考等级 → 发送（planDoc/designSystem 拼进初始指令） → 运行检测（停止按钮 + 对话哈希 stall） → 轮询到完成
```

> 停在「等待用户确认」界面（方案确认卡 / 订阅结账页）→ stall 判定转 `needs_user(user_confirmation)`；用户处理完后 `continue_task` 重新观察（**不重发消息**）；`login_required` 则复检环境后重派任务书。

### 8.4 Codex 项目登记（`src/agents/codex/registry.ts`）

Codex 桌面端的项目列表来自 `~/.codex/.codex-global-state.json` 的 `local-projects` + `project-order`。通过界面「新建项目 → 源文件夹」需要驱动 Windows 原生文件夹对话框，无人值守下不稳定；因此提供**直接登记**的确定性路径，等价于用户在 Codex 里手动创建过一次。

安全约束（fail-closed，失败即回退界面路径，绝不破坏用户状态）：

- 仅在状态文件存在且可解析时生效；
- **幂等**：已存在同路径登记则直接返回，不写文件；
- 写入前**备份**（新后缀 `.agent-foreman-backup.json`），**只在不存在时创建**以保留最初的良好副本；
- 兼容识别**旧品牌后缀** `.tianshu-mcp-backup.json`：旧备份存在则不新建、不覆盖，保住用户「任何工具动手之前」的干净回滚点（详见 §13.3）；
- **原子写**（临时文件 + rename），只改 `local-projects` / `project-order` 两个键，其余键原样保留；
- 只在**受管实例停止**时写入，避免运行中的 Codex 用内存态覆盖。

### 8.5 运行检测（liveness）

完成判定依赖 **UI 信号**，不能只看「画面静止」：

- 停止按钮 / loading 标记存在时不结束；
- 无运行信号才接受完成标志；
- 静态轮数只启动 `idleTimeoutMs`（默认 10 分钟）空闲计时，**不把静态画面直接当完成**——避免「仍在生成但 DOM 恰好静止」被误判。
- 异常结束（`idle_no_completion` / `timeout` / `aborted` / `cdp_lost`）**保留现场**，`query_task` 的 meta 给出 `agentEndReason` 与 `keptInstance`。

### 8.6 硬失败与错误码

硬失败（`hardFailure`）**不进验收与返修**，直接用 meta 的 `agentEndReason` / `errorType` / `message` 定位。常见 `agentEndReason`：

| 码 | 含义 |
|---|---|
| `setup_failed` | 找不到安装 / 实例未就绪 / 点不到「新对话」 |
| `project_ambiguous` / `project_mismatch` / `project_create_failed` | 项目消歧、绑定回读不一致、GUI 内新建失败 |
| `model_unavailable` / `model_mismatch` | 面板里找不到指定模型 / 回读与期望不符 |
| `permission_unknown` | 权限模式未确认 |
| `cdp_disconnected` | CDP 连接断开且未能恢复 |
| `instance_busy` | 同项目已有未停止的运行（重派护栏） |
| `session_lost` | ZCode 找不到原会话锚点 |
| `input_mismatch` / `send_unknown` | 发送前回读不一致 / 发送结果无法确认（**不重复发送**） |
| `idle_timeout` | GUI 长时间静止且无完成标志 |
| `setup_recovery` | ZCode 初始化/原生面板操作超时或恢复预算用尽 |
| `task_timeout`（`errorType=timeout`） | 任务级超时 |
| `aborted`（`errorType=cancelled`/`interrupted`） | 被取消/中断 |

`errorType` 取值：`timeout` / `spawn` / `agent_failed` / `verify_failed` / `cancelled` / `interrupted` / `agent_unresolved` / `internal`。

---

## 9. 视觉验收链路（可选模块）

未启用时对既有行为零影响；启用后它是一条**独立于命令检查**的并行验收链路。

```text
项目 acceptance.json 配 visual.enabled=true
  → 页面：三类来源（existing / command / static）+ 声明式步骤 + 稳定化采样 + 显式屏蔽
        → 与已批准基准做像素比对（pixelmatch）
        → 若声明 pages[].content，复用同一次截图再做内容判定（pixel:false 则只做内容判定）
  → 图片：显式文件清单 + 编码/尺寸/DPI/透明度规格校验
  → 内容（可选）：委托用户自备命令判定「图片/截图内容是否符合显式期望」
        → 采样多数票 + 任务级输入哈希缓存（键含命令二进制身份）
        → 默认仅告警（optional）；逐规则 blocking:true 才参与致败与返修
  → 缺陷按 autoFixRounds 返修；阻塞 → needs_attention
  → rework_task 对阻塞任务先重新验收，不先启动 agent
```

### 9.1 缺陷 vs 阻塞

| 类别 | 例子 | 处置 |
|---|---|---|
| **视觉缺陷** | 布局差异、图片规格错误、可定位的交互失败 | 按 `autoFixRounds` 返修 |
| **视觉阻塞** | 缺基准、页面不可达、浏览器缺失、资源被策略拦截、截图不稳定 | 进 `needs_attention`，**不触发 agent 返修** |

### 9.2 基准必须两阶段

1. `prepare_visual_baseline` — 只生成候选（`visual-candidates/<uuid>/`，含 `candidate.json`、PNG、`preview.html`）与摘要，**不采用正式基准**。
2. `approve_visual_baseline` — 仅在用户明确审阅并授权后调用。写入前核对**三向摘要**（候选摘要 + 原基准摘要 + 配置摘要），并检查目标路径未被 gitignore、关联任务确实处于同项目 `needs_attention`，最后原子写入基准与 `manifest.json` 审批记录。

**缺基准不得判通过，自动返修禁止调用批准入口。**

### 9.3 工程约束（`src/visual/`）

| 关注点 | 实现 |
|---|---|
| 浏览器 | `puppeteer-core` 无头 Chrome/Edge；`managed` 模式由 `@puppeteer/browsers` 安装到 `<数据目录>/browsers` 并锁定版本 |
| 资源限制 | 只允许本地来源 + `allowedOrigins`，其余请求直接拦截（`RESOURCE_BLOCKED`） |
| 稳定性 | 要求连续 `stabilitySamples`（默认 3）次截图字节完全一致，否则 `SCREENSHOT_UNSTABLE` |
| 预算 | `VisualBudget`：轮次截止时间 + 产物字节上限（默认 500 MiB） |
| 互斥 | `withVisualLock()`：`<数据目录>/visual-locks/<sha256(key)>.lock`，占用时返回 `VISUAL_BUSY` |
| 缺失依赖 | `sharp` / `pixelmatch` / `puppeteer-core` 缺失时**明确阻塞**，不静默降级 |
| 规则冻结 | 任务期内配置或基准被改动 → `VISUAL_INTEGRITY`，防止 agent 削弱验收规则 |

### 9.4 AI 内容校验（可选、默认关闭）

**凭证边界**：MCP 不读取、不存储、不转发任何密钥，也不实现模型/厂商 HTTP 客户端；判定完全委托用户显式声明的本地命令。MCP 只负责占位符展开（`<image:path>` / `<expect:file>` / `<image:base64:file>`）、`shell:false` + 结构化 argv 的子进程执行、stdout 末行的严格 JSON 校验。外发闸门是**契约层**强制：`allowRemote` 默认 `false`，未放行的规则使用 `<image:base64:file>` 会被 schema 直接拒绝；命令自身是否外传图片**无法在系统层拦截**，须用户自行确认（见 `SECURITY.md`）。

**状态语义**：`VisualResult.status` 的 `uncertain`（票不集中或低于 `minConfidence`）既不匹配 `visualFailed`（只取 `failed`）也不匹配 `visualBlocked`（只取 `blocked`），因此**天然不参与 verdict**。整轮级失败（`CONTENT_COMMAND_MISSING` / `CONTENT_ENV_MISSING`）在预检阶段（`assertContentReady` 枚举每条规则的**有效**命令与 env）抛错、经 `acceptance.ts` 的 try/catch 升级为 `configurationError`，**不产出任何结果行**。

| 关注点 | 实现要点 |
|---|---|
| 内容判定 | `src/visual/content*.ts`：命令解析（`where`/`which`）、占位符展开、`runChild` 语义的子进程执行、stdout 末行严格 JSON；纯函数 `tallyContentVotes` 多数票与置信度闸门；任务级缓存含 `commandPath`/`commandDigest`，使自备 CLI 升级即失效 |
| 语义-only 页面 | `pages[].pixel:false` 跳过基准要求与像素比对（必须有 `content`）；`prepareBaseline` 显式跳过、不纳入候选；`captureVisualSnapshot` 对其基线**显式记 null**（不读可能残留的无关文件，避免冻结摘要误漂移） |
| 告警隔离 | `blocking:false` → `optional:true`，不进 `visualBlocked`/`visualFailed`，不触发返修；返修计划列「仅告警项（不必修复）」 |

### 9.5 CLI 子命令族

```bash
node dist/index.js visual init [project]                   # 写入禁用的模板配置
node dist/index.js visual doctor [project]                 # 含内容命令解析与预算对比两项 finding
node dist/index.js visual browser install                  # 安装受管浏览器
node dist/index.js visual baseline prepare|approve …       # 基准两阶段
node dist/index.js visual rules review|approve …           # 规则快照重建
node dist/index.js visual artifacts clean <taskId>         # 清理任务产物（默认只预览）
node dist/index.js visual content probe <project> [ruleId] # 跑真实判定但不写证据/缓存
node dist/index.js visual content cache clear <taskId>     # 清任务级判定缓存
```

---

## 10. 配置系统与热加载

### 10.1 三层配置

| 层 | 位置 | 关键字段 |
|---|---|---|
| server 配置 | `<数据目录>/config.json` | `concurrency.maxRunning`、`defaultTaskTimeoutMs`、`verifyCommandTimeoutMs`、`verifyConcurrency`、`skills.autoInstall` |
| 项目级验收 | `<项目>/.agent-foreman/acceptance.json` | `checks[]`、`visual`、`requireChanges`（默认 `true`）、`verifyConcurrency` |
| agent profile | `<数据目录>/agent-profiles.json` | 见 `docs/agent-profiles.md` |

**生效顺序**：项目级 > server 级 > 内置默认。项目级配置只读 `.agent-foreman/`，**不读取任何旧目录**。

### 10.2 热加载

`config.json` 与 `agent-profiles.json` 在变更后被重新读取（无需重启 server），使 agent profile 调整与并发参数修改可以即时生效。视觉配置与基准在**任务期内被冻结**（`visual-snapshot.json`），防止中途漂移。

---

## 11. 跨平台策略

| 关注点 | Windows | macOS / Linux |
|---|---|---|
| 路径 | 原生分隔符 + 盘符；`normalizeDir()` 处理大小写不敏感 | POSIX 语义；符号链接经 realpath 归一（`/tmp` → `/private/tmp`） |
| Codex 启动 | MSIX COM 激活（`IApplicationActivationManager`） | 直接 spawn `.app` 包内可执行文件 |
| 进程终止 | `taskkill`（受管实例不带 `/T`） | 进程组 SIGTERM → SIGKILL |
| TraeWork 文件夹对话框 | 经 computer-use 白名单驱动 | 未实测，macOS 分支 fail-closed |
| 受管实例存活 | `detached: true`（不变量） | 同左；执行型子进程另行按平台分支 |

CI 在三平台矩阵上验证（见 §14.3）。

---

## 12. 安全边界与硬性红线

1. **绝不按进程树盲杀 TraeWork**：只终止本模块创建、且命令行核对通过的 PID，且不带 `/T`。
2. **默认复用用户实例**：`gui.windowMode = "reuse"`，绝不新起第二个；受管实例也不触碰用户手动打开的实例。
3. **computer-use 白名单**：仅允许 TraeWork 文件夹选择对话框（窗口标题 + 宿主进程双校验），其他窗口一律 `COMPUTER_USE_DENIED`。
4. **凭证零管理**：不读取 / 解密 / 转发任何 agent 凭证；GUI adapter 只驱动 UI。**AI 内容校验同样适用**：不实现模型/厂商 HTTP 客户端、不读密钥，判定委托用户自备命令；外发闸门只在契约层强制，**无法在系统层阻止用户命令外传图片**，此边界必须如实告知（见 `SECURITY.md`）。
5. **命令不拼 shell**：验收命令是结构化 argv，`shell:false`。
6. **不自动 commit / stash / 回滚**：动工前采集 git 基线，报告相对基线计算。
7. **路径不硬编码**：机器路径 / 用户名 / 端口走 profile 或占位符（`{LOCALAPPDATA}`、`{PROGRAMFILES}`、`{HOME}` 等，展开大小写不敏感）。
8. **stdout 只承载 JSON-RPC**：所有诊断日志走 stderr（并同源追加到 `logs/server.log`）。任何写入 stdout 的杂音都会破坏 MCP 流，导致严格客户端握手失败。
9. **路径闸门不得放宽**：`projectPath` 必须是存在的绝对目录，`realpath` 归一后落在主目录或系统/根级目录一律拒绝。
10. **视觉基准不得被自动化改写**：批准入口只能在用户明确授权后调用；不得修改基准/阈值/屏蔽区域或关闭规则来绕过失败。
11. **返回契约只增不改**：`MetaBlockFields` / `structuredContent` 顶层字段名稳定，新增字段须登记 `META_BLOCK_FIELDS`。

---

## 13. 兼容边界

### 13.1 项目级配置：无兼容读

本项目**只读** `<项目>/.agent-foreman/acceptance.json`。`readAcceptanceConfig()` 在 `ENOENT` 时返回 `null`，**不猜测其他位置、不做旧目录回退**——这是刻意的严格语义，不得为「方便迁移」而放宽。

### 13.2 数据目录：不迁移

数据目录为 `~/.agent-foreman`（env `AGENT_FOREMAN_HOME`）。旧产品目录下的任务历史、项目登记、agent profiles 与配置**既不读取也不迁移**。

### 13.3 唯一保留的旧品牌字面量

`src/agents/codex/registry.ts` 的 `LEGACY_CODEX_BACKUP_SUFFIX = ".tianshu-mcp-backup.json"` 是**全仓库唯一有意保留的旧品牌字面量**：

- **为什么保留**：备份是「只在不存在时创建」的防覆盖机制，保护的是**用户 Codex 原始状态**（人工回滚出口）。若改名后不识别旧备份，首次登记就会把「已被旧工具改过」的状态拍成新备份，使「任何工具动手之前」的干净回滚点静默降级。
- **边界**：该判断**只做存在性检查、不读其内容**，且作用于 `~/.codex/`（Codex 自己的目录）而非旧产品数据目录——属**防覆盖**，不属数据迁移或跨产品读取。
- **纪律**：该字面量只允许出现在此常量一处，禁止散落或用字符串拼接规避检查。

---

## 14. 测试与交付流水线

### 14.1 测试分层

| 层 | 位置 | 说明 |
|---|---|---|
| 单元 | `test/unit/` | 纯函数 / 解析器 / 状态机 / 配置校验；无真机依赖 |
| 集成 | `test/integration/` | 用 stub agent 跑完整任务闭环（`test/stub-agent/`），覆盖派活 / 验收 / 返修 / 取消 / 超时 |
| 协议 | `test/protocol/` | 官方 SDK client 连 in-memory transport，断言工具面、双轨返回契约、参数校验 |
| 真实浏览器 | `test/integration/visual-*.test.ts` | 需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`，默认跳过 |

共享夹具在 `test/test-utils.ts`。**改项目级目录约定时，`test-utils.ts` 与 `test/stub-agent/stub-agent.mjs` 是牵一发动全身的两个点。**

### 14.2 门禁命令

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run check:stdio     # 真实子进程捕获完整字节流；非协议行/parser error/空行/残留片段任一即失败
npm run pack:check      # npm pack 产物内容断言
```

### 14.3 CI / 发布

| 工作流 | 触发 | 内容 |
|---|---|---|
| `ci.yml` | push / PR 到 `main` | `build-test`（ubuntu / windows / macos × Node 20/22/24）、`pack-check`、`visual-browser`（ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24，真实浏览器 + 生产 tarball 消费者验收） |
| `release.yml` | 推 `v*` tag | 跑完整门禁 → 校验 tag 版本 === `package.json` 版本 → 要求同 SHA 的成功 CI → 双语正文（`docs/release-v<ver>.md` + `.en.md`，**缺文档直接失败**）→ 发 GitHub Release 并附 tgz |

版本号三处必须同步：`package.json`、`package-lock.json`、`src/version.generated.ts`（后者由 `scripts/sync-version.mjs` 在每次 build 前从 `package.json` 生成，**勿手改**）。

---

## 15. 已知缺口与设计约束

按对接手人的影响排序：

1. **UI 信号是唯一可靠完成判据**——三个 GUI driver 都依赖 DOM 结构与可见信号。客户端升级可能使选择器漂移；先在 `selectors.ts` 或 profile 覆盖处修复，真机复验不可省。
2. **`needs_user` 状态下无法停止 GUI 内会话**——MCP 侧无 CDP 连接。终态文案会诚实提示，需人工检查。
3. **单会话串行**——GUI 是单会话资源，同项目任务被 `projectBusy()` 串行化，全局并发受 `maxRunning` 限制。这是**设计约束，不是缺陷**。
4. **macOS 验证矩阵不完整**——Codex 与 ZCode 的 macOS 基本闭环已真机验证，但取消 / 返修 / `continue_task` / 新建项目矩阵未覆盖，故二者 darwin 仍标 `research`；TraeWork 的 macOS 分支 fail-closed。
5. **无项目派发仅 ZCode 且仅 Windows 实测**；ZCode 未登记项目的自动导入在 Windows 上不可用（需先手动登记，或传 `allowCreateProject=false` 显式失败）。
6. **视觉验证的平台边界**——浏览器侧由 CI 矩阵覆盖；**真机 GUI 驱动不在矩阵内**（需真实安装与登录）。见 `docs/visual-validation.md`。
7. **验收 fail-closed 对纯分析任务的影响**——git 项目默认要求产生变更，纯问答/分析任务必须显式设 `requireChanges: false`。

---

## 16. 扩展点

### 16.1 新增一个 agent（推荐路径）

1. **先加 profile**：在 `<数据目录>/agent-profiles.json` 里加一条（`docs/agent-profiles.md` 有字段全解与真机样例）。默认能力足够时**零代码**。
2. **需要自定义解析时**再实现 adapter：`src/agents/adapter.ts` 的 `AgentAdapter` 契约，然后 `registry.register(id, adapter)`。
3. 验证：`get_profiles` 应列出新 profile 并给出可执行探测结果；跑一次 stub 或真机冒烟。

### 16.2 其他扩展位

| 想扩展 | 改哪里 |
|---|---|
| 新增验收检查 | 项目 `acceptance.json` 的 `checks[]`（无需改代码）；或内置默认集推导规则 `src/verify/acceptance.ts` |
| 新增视觉检查类型 | `src/visual/schema.ts` + `engine.ts` + `report.ts` |
| 新增 MCP 工具 | `src/mcp/tools.ts` 加 `TOOL_DEFS` 条目 + `src/mcp/handlers.ts` 加 handler（注册是数据驱动的，无需改 `server.ts`） |
| 调整并发/超时默认 | `config/schema.ts` 默认值 + README 说明 |

---

## 17. 延伸阅读

| 主题 | 文档 |
|---|---|
| 安装、宿主接入、工具用法 | [README.md](README.md) / [README.en.md](README.en.md) / [宿主接入指南](docs/host-integration.md) |
| 交接状态、排障手册、踩坑记录 | [HANDOFF.md](HANDOFF.md) |
| Codex 桌面端 GUI 驱动细节 | [docs/codex-gui-cdp.md](docs/codex-gui-cdp.md) |
| TraeWork GUI 驱动细节 | [docs/traework-cdp.md](docs/traework-cdp.md) |
| ZCode GUI 驱动细节 | [docs/zcode-cdp.md](docs/zcode-cdp.md) |
| agent profile 字段全解 | [docs/agent-profiles.md](docs/agent-profiles.md) |
| 各 agent 能力矩阵 | [docs/adapter-matrix.md](docs/adapter-matrix.md) |
| 项目级验收配置规范 | [docs/acceptance-config.md](docs/acceptance-config.md) |
| 视觉验收配置与排查 | [docs/visual-acceptance.md](docs/visual-acceptance.md) |
| 视觉验收验证口径 | [docs/visual-validation.md](docs/visual-validation.md) |
| 开发环境与提交规范 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 安全模型 | [SECURITY.md](SECURITY.md) |
