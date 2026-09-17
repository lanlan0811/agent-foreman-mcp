# HANDOFF.md — 项目交接说明

> **交接快照：2026-09-17 · 版本 `1.0.0`（独立分化后首个版本）**
> 本文写给**接手本仓库的人**：先说清「这是什么、现在到哪一步」，再给出「怎么跑、怎么改、哪里会踩坑」。
> 安装与用法见 [README.md](README.md)，本文不重复，只做导览与状态记录。
> 工作区规则见 `AGENTS.md`（gitignore，仅本地，不入库）。

---

## 0. 五分钟上手

| 你想做什么 | 看哪节 |
|---|---|
| 搞清这是什么、为什么这么设计 | §1 |
| 看系统分层、模块边界、运行流程与扩展点 | **[ARCHITECTURE.md](ARCHITECTURE.md)**（独立架构文档） |
| 看当前状态（版本 / 测试 / CI / agent 适配） | §2 |
| 改 GUI adapter 前必须知道的结构 | §3、§4 硬性红线 |
| 跑起来 / 日常迭代 / 诊断 | §5 |
| 出问题了怎么查 | §7 专题排障（先看 §7.0 症状索引） |
| 找某份文档 / 下一步做什么 | §9 / §10 |

**验证基线**（一条命令，期望全绿）：

```bash
git clone https://github.com/lanlan0811/agent-foreman-mcp.git && cd agent-foreman-mcp
npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

1.0.0 出厂基线：**661 passed / 12 skipped（68 测试文件）**，`check:stdio` 6/6，lint 0 warning。
（其中 12 skipped 为真实浏览器用例，需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1` 才会执行，见 §9。）

---

## 1. 这个项目是什么

`agent-foreman-mcp` 是一个**面向任意 MCP 宿主的通用编排层**：宿主（Claude Desktop / Cursor / ZCode / Cline / Windsurf / 任意 stdio 宿主）是总指挥，本 server 负责**调度 + 执行面 + 客观验收仪**，驱动外部 AI-Agent 完成闭环：

```text
项目开发 → 验收 → 失败返修 → 再验收
```

- **本仓库**：`github.com/lanlan0811/agent-foreman-mcp`（单远程 `origin`，无镜像仓库）
- **npm**：`agent-foreman-mcp`
- **工具面**：11 个 MCP 工具（`run_task / continue_task / query_task / list_tasks / get_task_report / cancel_task / verify_task / rework_task / get_profiles / prepare_visual_baseline / approve_visual_baseline`）
- **宿主接入**：见 [docs/host-integration.md](docs/host-integration.md)
- **数据目录**：默认 `~/.agent-foreman`（`AGENT_FOREMAN_HOME` 覆盖）；项目级配置在 `<项目>/.agent-foreman/`
- **技能自装**：启动时幂等同步到 `~/.agents/skills/agent-foreman-mcp/`（Agents Skills 标准，用户级）

### 为什么是这样设计的（硬约束，改架构前必读）

本项目的形态不是自由设计的结果，而是若干条**实测硬约束**逼出来的（完整表见 `ARCHITECTURE.md §1.1`）：

- **源流约束 C1（已解除）**：上游前身项目时期的宿主对 MCP 工具只回文本 → 本项目**已由 `structuredContent` 双轨解除**（文本 meta 块 + 结构化返回双投递）；保留文本块仅为兼容只认文本的旧式宿主。
- **源流约束 C2**：彼时宿主按次同步调用 `tools/call` → 长任务仍异步化（`run_task` 秒回 `taskId`，`query_task` 轮询）。
- **C3**：TraeWork 的 agent 请求在 TTNet 层 TDE 加密，无法在客户端外构造 → **只能 CDP 驱动桌面 UI**。
- **C4**：Codex 桌面端是 MSIX 商店包，GUI 宿主无法 `CreateProcess` 直启 → 必须经 COM 激活 + 专属 `--user-data-dir`。
- ZCode 无随包 headless CLI → 同样走 CDP。

C3/C4 是 **agent 侧**约束（被驱动的桌面应用本身的属性），与宿主无关，独立化后依然成立。

---

## 2. 交接快照

| 项 | 状态 |
|---|---|
| 版本 | `1.0.0`（独立分化后首个版本；版本源单一：`package.json` → build 时注入 `src/version.generated.ts`） |
| 测试 | 661 passed / 12 skipped / 68 文件（skipped 为真实浏览器用例，默认跳过） |
| CI | GitHub Actions：`build-test`（ubuntu/windows/macos × Node 20/22/24）、`visual-browser`（含 macOS Intel/ARM 真机 runner × Node 20/22/24）、`pack-check` |
| 门禁 | typecheck / lint（0 warning）/ test / build / `check:stdio` 6 场景 / `pack:check` |
| npm | `agent-foreman-mcp` |
| 数据目录 | `~/.agent-foreman`（env `AGENT_FOREMAN_HOME`） |
| 技能安装目标 | `~/.agents/skills/agent-foreman-mcp/` |
| 发布 | `npm publish` + 推 `v*` tag 触发 release.yml（要求同 SHA 成功 CI + 双语发布文档） |

### 2.1 Agent 适配现状

| agentId | driver / adapter | status | 说明 |
|---|---|---|---|
| `codex` | `gui` / `codex-gui` | **ready**（darwin 为 `research`） | Codex 桌面端 GUI（Windows：MSIX COM 激活 + CDP；macOS：spawn .app + CDP） |
| `zcode` | `gui` / `zcode-gui` | **research** | CDP GUI adapter；Windows 闭环通过，macOS 基本闭环通过；取消/返修/新建项目矩阵未覆盖 |
| `traework` | `gui` / `traework-gui` | **ready** | CDP 驱动 TRAE SOLO CN；三种面板模式真机验证通过 |
| `stub` | `spawn` | 仅测试 | `test/stub-agent/stub-agent.mjs` 三剧本（good / fix-on-first / never） |

`status` 语义：`ready` = 当前平台闭环已验证；`research` = 已实现但矩阵未覆盖（**仍可执行**）。

---

## 3. 架构与模块导览

分层、模块边界、状态机、验收流水线、扩展点与已知缺口全部在 **[ARCHITECTURE.md](ARCHITECTURE.md)**，此处只给「动手前必须先知道」的结构性事实。

### 3.1 两条执行面（`driver`）

- `driver: "gui"` → 由显式 adapter 驱动桌面 UI（`src/agents/{codex,zcode,traework}/`），经 CDP。
- `driver: "spawn"` → 外部 CLI 子进程（`src/agents/spawn/`）。

新 agent = 一个 profile（数据）+（如需）一个 adapter 文件，零改编排核心。

### 3.2 三个 GUI adapter 的执行顺序（实测结论，勿随意调整）

**TraeWork**：

```text
确保实例可用 → 等待 UI 就绪 → 新建会话 → 切到目标模式 → 在目标模式内绑定项目 → 切模型 → 发送 → 轮询到完成
```

> **关键事实**：TraeWork 的 Work/Code/Design **各自维护独立的项目绑定**，切换模式会把输入栏项目换成该模式上次使用的项目。
> 因此必须先切模式、再在目标模式里绑定项目；绑定后复核「模式 + 项目」双双就位，任一不符即响亮失败。

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

> 停在「等待用户确认」界面（方案确认卡 / 订阅结账页）→ stall 判定转 `needs_user(user_confirmation)`；
> 用户处理完后 `continue_task` 重新观察（**不重发消息**）；`login_required` 则复检环境后重派任务书。

### 3.3 视觉验收是一条独立链路（可选模块）

`run_task` / `verify_task` 在项目配置 `visual.enabled=true` 后自动带上截图对比与静态图片规格检查，**不需要新工具**。

- 视觉**缺陷**（布局差异、图片规格错误、可定位交互失败）按 `autoFixRounds` 返修；
- 视觉**阻塞**（缺基准、页面不可达、浏览器缺失、资源被策略拦截、截图不稳定）进 `needs_attention`，**不触发 agent 返修**——`rework_task` 会先只重新验收；
- 基准必须由用户审阅批准（`prepare_visual_baseline` 只产候选，`approve_visual_baseline` 才落正式基准，且必须带 `expectedDigest` + `approvalNote`）；
- 可选 AI 内容校验（`visual.contents[]` / `pages[].content`）默认**仅告警**，只有 `blocking: true` 的规则致败；判定委托用户自备命令，MCP 不内置模型客户端。

---

## 4. 硬性红线（违反 = 运行时损坏或事故）

1. **绝不按进程树盲杀 TraeWork**：只终止本模块创建、且命令行核对通过的 PID，且不带 `/T`。
   事故来源：验证期 `taskkill /PID <pid> /T /F` 误杀用户正在使用的实例（数据完好，已恢复）。见 `docs/traework-cdp.md`。
2. **默认复用用户实例**：`gui.windowMode="reuse"`，绝不新起第二个（Codex/ZCode 以专属 user-data-dir 启动的受管实例除外，且不触碰用户手动打开的实例）。
3. **computer-use 白名单**：仅允许 TraeWork 文件夹选择对话框（窗口标题 + 宿主进程双校验），其他窗口一律 `COMPUTER_USE_DENIED`。
4. **凭证零管理**：不读取/解密/转发任何 agent 凭证；GUI adapter 只驱动 UI。**AI 内容校验同样适用**：不实现模型/厂商 HTTP 客户端、不读密钥，判定委托用户自备命令；外发闸门只在契约层强制，命令自身行为无法在系统层审计（见 `SECURITY.md`）。
5. **命令不拼 shell**：验收命令是结构化 argv，`shell:false`。
6. **不自动 commit/stash/回滚**：动工前采集 git 基线，报告相对基线计算。
7. **路径不硬编码**：机器路径 / 用户名 / 端口走 profile 或占位符（`{LOCALAPPDATA}`、`{PROGRAMFILES}` 等；展开大小写不敏感）。
8. **GUI 取消不得谎报**：`cancel_task` 对 GUI agent 必须尽力点击停止 + 在 `gui.cancelWaitMs` 内有界等待确认；
   未确认停止时终态必须明示「GUI 内运行未确认停止」。重派前必须确认受管实例空闲，否则以 `instance_busy` 拒绝（防 turn 交叠）。
9. **验收 fail-closed**：测试命令退出码 0 但输出显示零用例 → 判失败；git 项目默认要求相对基线产生变更
   （`requireChanges: false` 显式关闭）。不得为「让任务变绿」放松这两个门禁。
10. **路径闸门不得放宽**：`projectPath` 必须是存在的绝对目录，`realpath` 归一后落在主目录或系统/根级目录一律拒绝；盘符根由单独判定覆盖，不依赖枚举清单。
11. **视觉基准不得被自动化改写**：`approve_visual_baseline` 只能在用户明确授权后调用，且必须带 `expectedDigest` 与 `approvalNote`；
    自动返修路径禁止调用批准入口；不得修改基准/阈值/屏蔽区域或关闭规则来绕过失败（规则冻结会检出 `VISUAL_INTEGRITY`）。
12. **只在 `main` 提交，commit 用中文**；不建分支、不覆盖已有 tag。
13. **返回契约只增不改**：`MetaBlockFields` / `structuredContent` 顶层字段名稳定，字段只增不改不换名——工具已声明 `outputSchema`，客户端会按其校验，改名即破坏已发布契约。新增字段须同步登记 `META_BLOCK_FIELDS`（协议测试会断言）。

---

## 5. 环境搭建、日常迭代与诊断探针

### 5.1 从零搭环境

```bash
npm ci                  # 依赖（跨平台，含 puppeteer-core / pixelmatch 等）
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --max-warnings 0
npm test                # vitest run（默认跳过真实浏览器用例）
npm run build           # sync-version + tsc → dist/
npm run check:stdio     # 严格校验 stdout 只承载 MCP 协议消息（6 场景）
npm run pack:check      # npm pack --dry-run，核对产物内容
```

### 5.2 本机环境事实（2026-09 探测，接手机器可能不同）

| 项 | 值 |
|---|---|
| 开发机 | Windows 10 x64（10.0.19045） |
| Node | ≥ 20（CI 覆盖 20/22/24） |
| TraeWork | TRAE SOLO CN 桌面端 |
| Codex | Codex 桌面端（MSIX 商店包）+ 可选 codex CLI |
| ZCode | ZCode 桌面端（Electron CDP） |

### 5.3 诊断探针与真机验证（**不入 CI**，需真实客户端在跑）

| 探针 / 脚本 | 用途 |
|---|---|
| `scripts/probe-traework.mjs` | TraeWork 发现 / 启动 / 选择器探测 |
| `scripts/probe-zcode.mjs` | ZCode 发现 / 项目绑定 / 模型菜单探测 |
| `scripts/probe-codex.mjs` | Codex MSIX 发现 / COM 激活 / CDP 端口探测 |
| `scripts/smoke-zcode.mjs` | ZCode 端到端冒烟 |
| `scripts/evidence-visual-windows.mjs` | Windows 视觉验收矩阵留证 |
| `scripts/prepare-zcode-fixture.mjs` | 生成 ZCode 真机验证用夹具项目 |

这些脚本需要真实桌面应用与登录态，**不可在 CI 跑**；改动 GUI adapter 后必须在本机跑对应探针。

### 5.4 发布流程（tag → CI → Release → npm）

完整步骤见 [docs/npm-publish-guide.md](docs/npm-publish-guide.md)。要点：

1. 本地门禁全绿 + 该提交 CI 全绿；
2. 版本三处一致（`package.json` / `package-lock.json` / build 生成的 `src/version.generated.ts`）；
3. 备齐 `docs/release-v<版本>.md` 与 `.en.md`（**缺文档 release.yml 会直接失败**）；
4. `npm publish --registry=https://registry.npmjs.org`；
5. 推 `v<版本>` tag → release.yml 校验同 SHA 成功 CI、附 tarball、合成双语正文。

---

## 6. 测试分层

| 层 | 位置 | 说明 |
|---|---|---|
| 单元 | `test/unit/` | 纯函数 / 解析器 / 状态机 / 配置校验；无真机依赖 |
| 集成 | `test/integration/` | 用 stub agent 跑完整任务闭环（`test/stub-agent/`），覆盖派活/验收/返修/取消/超时 |
| 协议 | `test/protocol/` | 官方 SDK client 连 in-memory transport，断言工具面、返回双轨契约、参数校验 |
| 真实浏览器 | `test/integration/visual-*.test.ts` | 需 `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`，默认跳过；CI 的 `visual-browser` job 全跑 |

共享夹具在 `test/test-utils.ts`（含 `makeGitProject` / `writePlaybook` / `callTool` / `parseMeta`）。**改项目级目录约定时，`test-utils.ts` 与 `test/stub-agent/stub-agent.mjs` 是牵一发动全身的两个点**。

---

## 7. 专题排障手册

### 7.0 症状 → 小节索引

| 症状 | 去 |
|---|---|
| TraeWork 项目文件夹绑定卡住 / 下拉未命中 / 路径写入被破坏 | §7.1 |
| TraeWork 任务长时间不结束，或长思考被提前判完成 | §7.2 |
| 严格 MCP 客户端握手失败 / 工具调用失败 / stdout 有杂音 | §7.3 |
| Codex 卡在「等待用户确认」/ `cancel_task` 没真停 | §7.4 |
| ZCode 模型菜单选不中 / 项目绑定判据漂移 / 验收假绿 | §7.5 |
| ZCode 项目或模型回读误判 / 原生面板超时 / 恢复后丢会话 | §7.6 |
| ZCode 无项目派发报参数错误 / 卡在 `setup_recovery` / 窗口被遮挡时发送失败 | §7.7 |
| 验收检查互相干扰 / 符号链接路径下历史任务「消失」 | §7.8 |
| 视觉验收不通过 / 基准待批准 / 判 `VISUAL_INTEGRITY` / 离线报告看不开 | §7.9 |
| AI 内容校验整轮阻塞 / 占位符被拒 / 判定总是 uncertain / 缓存不失效 | §7.10 |

### 7.1 TraeWork 项目文件夹绑定

- 项目下拉**未命中**时不要瞎重试：绑定走「触发器逐级定位 + 完整路径判据」，路径比较需 realpath 归一（macOS `/tmp` → `/private/tmp`）。
- 绑定后必须**复核**「模式 + 项目」双双就位；任一不符即响亮失败，不要带着错状态发任务。
- 原生文件夹对话框驱动是最后的兜底路径，走 computer-use 白名单（窗口标题 + 宿主进程双校验）。

### 7.2 TraeWork 任务进行中检测

- 完成判定**依赖 UI 信号**：停止按钮 / loading task tail 存在时不结束；无运行信号才接受「由AI生成」。
- `stableRounds` 只启动 `idleTimeoutMs`（默认 10 分钟）空闲计时，**不再把静态画面直接当完成**——早期曾把「仍在生成但 DOM 恰好静止」误判为完成。
- 异常结束（`idle_no_completion` / `timeout` / `aborted` / `cdp_lost`）均**保留现场**；`query_task` meta 看 `agentEndReason` / `keptInstance`。

### 7.3 stdio 日志污染

- 症状：严格客户端握手失败或工具调用失败、stdout 有非协议内容。
- 根因类别：任何诊断输出写到 stdout 都会破坏 JSON-RPC 流。本项目**强制所有级别日志走 stderr**（同时落 `<数据目录>/logs/server.log`），`eslint.config.js` 对 `src/**/*.ts` 禁用 `console.log`（仅允许 `console.error`）。
- 自查：`npm run check:stdio` 会真实捕获子进程完整字节流，非协议行 / parser error / 空行 / 残留片段任意一条即失败。
- 注意：**stderr 出现 `INFO`/`WARN` 不代表服务器出错**，那是正常诊断；只有启动失败才是致命错误。

### 7.4 Codex GUI 状态脱节与取消

- 停在「等待用户确认」（方案确认卡 / 订阅结账页）→ 走 `needs_user(user_confirmation)`，`continue_task` 后**只重新观察、不重发消息**。
- `cancel_task` 对 GUI 是「尽力点击停止 + 有界等待」；**未确认停止时终态会明示**，此时不要在确认停止前重派同项目任务（重派护栏会以 `instance_busy` 拒绝，防 turn 交叠）。
- 受管实例的启停只针对本模块以专属 user-data-dir 启动的实例，**绝不触碰用户手动打开的默认实例**。

### 7.5 ZCode 模型菜单与项目绑定

- 模型选择：**直选优先**，provider/family 分组兜底，回读时解码稳定属性（不要依赖易变的展示文本）。
- 项目绑定判据漂移：以**完整路径**为判据并归一化比较，不要用显示名。
- 「验收假绿」：验收引擎 fail-closed（零用例判失败 + `requireChanges` 门禁），若见假绿先确认这两条没被配置放松。

### 7.6 ZCode 项目/模型回读、初始化恢复与会话发送确认

- 回读不一致时**宁可响亮失败**，不要猜。
- 原生面板操作超时 / 恢复预算用尽 → `needs_user(setup_recovery)`，请用户在 ZCode 内确认项目或手工绑定后 `continue_task`。
- 恢复依赖原会话锚点（`zcodeSessionId`）；锚点丢失时明确拒绝恢复，**不会擅自打开「最近会话」**，也不会新开会话冒充恢复。
- 发送前做回读一致性检查；发送结果无法确认时**不重复发送**（防重发），改人工查看或 `continue_task`。

### 7.7 ZCode 无项目派发

- `projectPath` 省略仅对 ZCode 生效（进入无项目模式：不登记项目、不采集 Git 基线、不执行项目验收）；其他 agent 省略会在排队前报错。
- 空串 / `null` / 相对路径 / 不存在的目录**不视为**无项目模式。
- `allowCreateProject: false` 作用于有项目模式：目标目录未登记时**在任何导入副作用之前**停止派发，返回 `project_not_registered`。
- 窗口被遮挡会影响模拟输入的可靠性——保持窗口可见。

### 7.8 验收并行与符号链接

- 命令检查默认**有界并行 2**（`verifyConcurrency`，范围 1–4）。检查项之间有顺序依赖（后续检查读 build 产物、带 `--fix`、共享缓存目录）时必须设 `1` 退化为串行，否则偶发误报。
- 符号链接路径下历史任务「消失」：路径归一化（realpath）后同一个项目可能对应不同字符串，排查时以归一化结果为键。

### 7.9 视觉验收

- 不通过先分清**缺陷 vs 阻塞**：阻塞（缺基准/页面不可达/浏览器缺失/资源被拦截/截图不稳定）不触发返修，`rework_task` 会先重新验收。
- 基准待批准：`prepare_visual_baseline` 只产候选，需用户审阅后 `approve_visual_baseline`（带 `expectedDigest` + `approvalNote`）。
- `VISUAL_INTEGRITY`：说明检测到试图通过改基准/阈值/屏蔽区域/关闭规则来绕过失败；配置或基准变化需用 `agent-foreman-mcp visual rules review/approve` 重建任务快照（CLI 在 stdio 前分流）。
- 离线报告看不开：报告是自包含 HTML（图片并排 / 透明叠加 / 区域定位），确认用浏览器打开而非编辑器。
- 浏览器缺失：`agent-foreman-mcp visual browser install` 安装受管浏览器；Ubuntu 上需 AppArmor 放行 user namespace（CI 已配置 profile `agent-foreman-visual-chrome`）。

### 7.10 AI 内容校验

- **整轮阻塞**（`CONTENT_COMMAND_MISSING` / `CONTENT_ENV_MISSING`）：任一规则的**有效**命令不可解析或声明的宿主环境变量缺失即 fail-closed，且不产出任何视觉结果行。先修配置或环境，再 `rework_task`。
- 占位符被拒：`allowRemote` 默认 `false`，未放行的规则禁止使用字节外传占位符（`<image:base64:file>`）。
- 判定总是 `uncertain`：票不集中或低于 `minConfidence`；提高 `samples` 或让命令输出更一致。`minConfidence` 在命令不报 confidence 时不生效。
- 缓存不失效：清任务级判定缓存 `agent-foreman-mcp visual content cache clear <taskId>`。
- 排查命令解析：`agent-foreman-mcp visual doctor <project>`。
- **不要为消除告警而伪造产物或放宽检查**。

---

## 8. 已知限制（对接手人有直接影响）

- **TraeWork 窗口必须可见**：发送依赖模拟输入；且不能有第三方工具（如截图器）抢焦点。
- **单会话串行**：TraeWork 是单会话 UI，所有任务经串行队列；同项目任务被 `projectBusy()` 串行化。
- **完成判定依赖 UI 信号**：详见 §7.2。
- **UI 升级会漂移**：三个 adapter 的选择器分别集中在
  `src/agents/traework/cdp/selectors.ts`、`src/agents/zcode/selectors.ts`、`src/agents/codex/selectors.ts`，
  均可经 profile `gui.selectors` 覆盖；先用探针诊断。
- **macOS 部分验证**：Codex 与 ZCode 的 macOS 基本闭环（发现/启动/绑定/发送/观察/验收）均已真机通过，
  但取消/返修/continue_task/新建项目矩阵未覆盖，二者 darwin 仍标 `research`；
  TraeWork 的原生对话框驱动与真机闭环未在 macOS 实测，macOS 分支保持 fail-closed。
- **`mode` 仅 TraeWork 生效**：ZCode / Codex 会拒绝该参数（返回明确错误）。
- **无项目派发仅 ZCode 且仅 Windows 实测**：macOS 上的无项目派发尚未真机验证。
- **`continue_task` 仅 codex/zcode**：traework 与 spawn 类 agent 会被拒绝。
- **`needs_user` 状态下取消是已知边界**：MCP 侧无 CDP 连接，GUI 内等待中的会话停不掉；终态文案会提示。
- **验收 fail-closed 对纯分析任务的影响**：git 项目默认要求产生变更；纯问答 / 分析任务必须在
  `.agent-foreman/acceptance.json` 设 `"requireChanges": false`，否则验收判失败。
- **视觉验证以 CI 矩阵为事实来源**：浏览器侧由 CI 覆盖；**真机 GUI 驱动不在矩阵内**（需真实安装+登录）。
  见 `docs/visual-validation.md`。
- **npm 上的 README 停留在发布时**：之后新增的文档只在仓库里；如需同步到 npm 需再发版本。
- **本仓库不保留前身项目的历史**：发布记录、真机验收记录、里程碑叙事均归属其自身仓库；本仓库自 1.0.0 起笔。

---

## 9. 凭证与安全红线

- **不读取/存储/转发任何 agent 的 API key 或登录态**：各 agent 用自己的登录态；AI 内容校验的判定命令自管密钥（见 `SECURITY.md`）。
- **审批由宿主实施**：工具上的 `requireApproval` / `annotations` 只是暴露给宿主的标注，**标注本身不是安全边界**。
- **私密报告渠道**：安全漏洞走仓库 Security Advisories 私密上报，不要开公开 Issue。
- **不外发项目内容**：除用户显式配置的验收命令与 AI 内容判定命令外，server 不主动联网。

---

## 10. 文档地图与下一步建议

### 10.1 文档地图

| 文档 | 内容 |
|---|---|
| [README.md](README.md) / [README.en.md](README.en.md) | 定位、快速开始、工具面、技能自装、渊源与切换 |
| [docs/host-integration.md](docs/host-integration.md) | 宿主接入指南（各宿主配置位置、环境变量、冒烟、FAQ） |
| [ARCHITECTURE.md](ARCHITECTURE.md) / [ARCHITECTURE.en.md](ARCHITECTURE.en.md) | 分层、模块边界、状态机、验收流水线、扩展点、已知缺口 |
| [docs/agent-profiles.md](docs/agent-profiles.md) | agent profile 字段全解 + 真机样例 |
| [docs/adapter-matrix.md](docs/adapter-matrix.md) | 各 agent 能力调研矩阵 |
| [docs/acceptance-config.md](docs/acceptance-config.md) | 项目级验收配置写法 |
| [docs/visual-acceptance.md](docs/visual-acceptance.md) / [docs/visual-validation.md](docs/visual-validation.md) | 视觉验收配置与验证口径 |
| [docs/codex-gui-cdp.md](docs/codex-gui-cdp.md) / [docs/traework-cdp.md](docs/traework-cdp.md) / [docs/zcode-cdp.md](docs/zcode-cdp.md) | 三个 GUI adapter 的原理、配置、选择器、踩坑 |
| [docs/npm-publish-guide.md](docs/npm-publish-guide.md) | 发布流程 |
| [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md) / [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 协作、安全、行为准则 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更日志（自 1.0.0 起笔） |

### 10.2 接手人下一步建议

1. **先跑通门禁**（§0 的一条命令），确认基线全绿再动代码。
2. **要改 GUI adapter 前**，先读 §3.2 执行顺序与 §4 红线，并跑对应探针（§5.3）。
3. **要加新 agent**：先加 profile 试跑（`docs/agent-profiles.md`），确认适配方式后再决定是否需要写 adapter。
4. **优先补齐的方向**（按影响面）：
   - ZCode 在 macOS 的取消 / 返修 / 新建项目矩阵（补齐后可从 `research` 升 `ready`）；
   - TraeWork 的 macOS 原生对话框驱动（当前 fail-closed）；
   - 更多 MCP 宿主的接入验证（`docs/host-integration.md` 可随实测补充）。
5. **改返回契约时**：牢记 §4 第 13 条（只增不改），并同步 `META_BLOCK_FIELDS` 与协议测试。

---

## 11. 渊源

本项目源自 **tianshu-mcp v0.5.4**（Apache-2.0）**独立分化**，自 1.0.0 起独立演进。两者是**并行维护的两个独立项目**，互不依赖、互不读取对方数据；tianshu-mcp 的全部历史（发布记录、真机验收、里程碑叙事）归属其自身仓库，本仓库不保留、不复述。

从 tianshu-mcp 切换过来的用户须知（数据目录、项目级验收配置、Codex GUI profile 目录、备份后缀四项行为变化）见 [README.md](README.md) 的「渊源与切换」小节。
