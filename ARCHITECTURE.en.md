# ARCHITECTURE.en.md — agent-foreman-mcp Architecture

> This document describes the **system structure, module boundaries and key invariants** for developers who
> intend to modify this repository. Installation, host integration and usage live in [README.en.md](README.en.md)
> and the [Host Integration Guide](docs/host-integration.en.md); handover state, troubleshooting and pitfalls
> live in [HANDOFF.md](HANDOFF.md).
> Chinese version: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Positioning and system context

`agent-foreman-mcp` is a **general-purpose orchestration layer for any MCP host**. The host (Claude Desktop / Cursor / ZCode / Cline / Windsurf / any stdio host) is the commander and the user-facing surface; this server owns three things:

1. **Scheduling** — task queue, concurrency gate, state machine, timeouts, cancellation.
2. **Execution surface** — delivering the task brief to an external AI agent (Codex desktop, TraeWork, ZCode, or any CLI).
3. **Objective acceptance** — verifying against a git baseline with command checks, code analysis, and optional visual pixel comparison, then producing a report.

```text
┌─────────────────────────────────────────────────────────────┐
│ MCP host (Claude Desktop / Cursor / ZCode / Cline / …)       │
│   · Calls tools/call per request                             │
│   · Consumes content[].text + meta block, or structuredContent│
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP over stdio (stdout carries JSON-RPC only)
┌───────────────────────────▼─────────────────────────────────┐
│ agent-foreman-mcp (this repository)                          │
│   scheduling ── execution surface ── acceptance instrument   │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
   ┌───────▼────────┐            ┌────────▼─────────┐
   │ External agent  │            │ Target workspace │
   │ GUI: drive UI   │            │ git repo + tests │
   │      over CDP   │            │ .agent-foreman/  │
   │ CLI: subprocess │            └──────────────────┘
   └────────────────┘
```

### 1.1 Hard constraints and the architecture they forced

This project's shape is not a free design choice — it was forced by several **measured constraints**. Read this table before changing the architecture:

| # | Measured constraint | Architectural consequence |
|---|---|---|
| C1 | **Inherited constraint** (host limitation during the predecessor era): that host **returned text only** for MCP tools — `content[]` `text` items were concatenated and `isError` passed through | This limitation is **resolved here by the structuredContent dual track**: results carry both "human-readable text + a `---agent-foreman-meta---` JSON block" and the MCP-standard `structuredContent`. Resources and prompts are still unused (`src/mcp/formatter.ts`). The text block is kept for legacy text-only hosts |
| C2 | **Inherited constraint** (host limitation during the predecessor era): that host called `tools/call` **synchronously, per call** | Long tasks stay async: `run_task` returns a `taskId` immediately and `query_task` polls. There is no server push — a general practice, not a host-specific constraint |
| C3 | TraeWork agent requests are TDE-encrypted at the TTNet layer and cannot be constructed outside the client | The only viable path is **driving the desktop UI over CDP** and extracting results from the DOM (`src/agents/traework/`) |
| C4 | The Codex desktop app is an **MSIX store package**; a GUI host cannot `CreateProcess` it directly | It must be activated through `IApplicationActivationManager` COM with an injected dedicated `--user-data-dir` before a CDP port opens (`src/agents/codex/launcher.ts`) |

C3/C4 are **agent-side** constraints (properties of the driven desktop apps), independent of the host, and they still hold after the split. ZCode falls into the same class: it ships no headless CLI, so it is also CDP-driven.

---

## 2. Layered architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│ L1 Protocol edge  src/index.ts · src/server.ts · src/mcp/         │
│   Entry & CLI dispatch · assembly · 11 tool registrations ·       │
│   argument validation · dual-track formatting                     │
├──────────────────────────────────────────────────────────────────┤
│ L2 Task domain    src/tasks/                                       │
│   State machine · per-project serial queue · global gate ·         │
│   event-stream persistence · cancellation semantics                │
├──────────────────────────────────────────────────────────────────┤
│ L3 Orchestration  src/loop/                                        │
│   TaskOrchestrator: dispatch → verify → rework → re-verify         │
├───────────────────────────────┬──────────────────────────────────┤
│ L4a Execution     src/agents/  │ L4b Acceptance  src/verify/       │
│   AgentAdapter contract        │                 src/visual/       │
│   CLI spawn / GUI CDP drivers  │   git baseline · command checks   │
│                                │   code analysis · visual compare  │
├───────────────────────────────┴──────────────────────────────────┤
│ L5 Foundation     src/config/ · src/util/                          │
│   zod schemas · data home · hot reload · atomic writes ·           │
│   path normalization · logging · skill self-install                │
└──────────────────────────────────────────────────────────────────┘
```

Dependencies flow **strictly one way, downward**: L1 → L2 → L3 → {L4a, L4b} → L5. L4a and L4b do not depend on each other and meet only in L3. That is this project's most important decoupling boundary — **"who does the work" and "how we judge the work" are two independently replaceable concerns**.

---

## 3. Startup assembly and lifecycle

### 3.1 Entry dispatch (`src/index.ts`)

```text
node dist/index.js                → stdio MCP server
node dist/index.js visual <cmd>   → the visual acceptance CLI subcommand family
                                    (dispatched before the stdio connection opens,
                                     so it never occupies the protocol stream)
```

- The data home is resolved by `resolveDataHome()`: the `AGENT_FOREMAN_HOME` environment variable wins, otherwise `~/.agent-foreman`.
- The logger initializes into `<data home>/logs/`.
- Skill self-install can be disabled with `--no-skill-install` or `AGENT_FOREMAN_NO_SKILL_INSTALL=1`.
- Exit paths: `SIGINT` / `SIGTERM` / stdin EOF / stdin close → archive active tasks and terminate children → `exit(0)`.

### 3.2 Assembly order (`src/server.ts`)

`buildServer()` is the single assembly point, and the order is meaningful:

```text
resolveDataHome → Logger → DataHome(BUILTIN_PROFILES) → init()
  → loadConfig() → maxRunning
  → TaskStore → AgentAdapterRegistry(loadProfiles) → AcceptanceEngine
  → TaskManager(+makeBuildCtx) → manager.initialize(maxRunning)   # archives tasks left active by a restart
  → skill self-install (background, does not block the handshake)
  → register 11 tools → return ServerAssembly{server, manager, dataHome, store, logger, close}
```

`close()` = `manager.shutdownInterrupt()` (archive active tasks + terminate children) → `engine.close()` → `server.close()`.

Tool registration is **data-driven**: it iterates `TOOL_DEFS` and looks up each implementation by name in `handlers`, logging an error and skipping when one is missing. `registerTool` also publishes `inputSchema` / `outputSchema`, `_meta.requireApproval`, `_meta.capability` and the MCP `annotations` (readOnly / destructive / openWorld) for the host's policy layer.

### 3.3 Data home layout

```text
<data home>/                      default ~/.agent-foreman
├── config.json                 server config (concurrency, timeouts, skill switch)
├── agent-profiles.json         user-defined/overriding agent profiles
├── projects.json               project registry (incl. per-project acceptance config)
├── logs/server.log             all-level diagnostics (same source as stderr)
├── browsers/                   Chrome managed by the visual module (managed mode)
├── visual-candidates/<uuid>/   pending baseline candidates (candidate.json + PNG + preview.html)
├── visual-locks/<sha256>.lock  visual operation mutex
└── tasks/<taskId>/             per-task isolated directory (below)
```

Per-task directory (`src/tasks/task-store.ts`):

| File | Contents |
|---|---|
| `task.jsonl` | append-only event stream (the authoritative timeline) |
| `task.json` | latest `TaskMeta` snapshot (atomic write) |
| `baseline.json` | the git baseline captured before work started |
| `agent-<round>.log` | agent output (round from 0) |
| `verify-<round>.log` | acceptance command output |
| `report-<round>.md` / `.json` | acceptance report (`.md` human, `.json` machine) |
| `report-<round>.html` | offline visual report, **only when the report contains visual results** |
| `rework-<taskId>-r<round>.md` | repair plan (non-Codex paths) |
| `visual/<round>/<pageId>/<viewportId>/` | visual quartet: `actual/baseline/diff/regions.png` + `metrics.json` |
| `visual-snapshot.json` | visual rule snapshot frozen for the task |

**Project-side artifacts**:

| Path | Contents |
|---|---|
| `<project>/.agent-foreman/acceptance.json` | project-level acceptance config (**the only** path read; no legacy directory is ever consulted) |
| `<project>/tests/visual/baselines/...` | visual baselines |
| `<project>/.agent-foreman/plans/codex-fix-r<N>.md` | Codex-path repair plan (the `gui.fixPlanDir` default, overridable per profile) |

**Skill install**: on startup the server idempotently syncs `skills/agent-foreman-mcp/` from the repository into **`~/.agents/skills/agent-foreman-mcp/`** (the Agents Skills open standard). That path is resolved from `os.homedir()` and is **not affected by `AGENT_FOREMAN_HOME`**.

---

## 4. MCP tool surface and return contract

11 tools (`src/mcp/tools.ts`), split into read and write families:

| Tool | Capability | Approval | Purpose |
|---|---|---|---|
| `run_task` | write | yes | Dispatch work; returns a `taskId` asynchronously |
| `continue_task` | write | yes | Resume the original session of a `needs_user` task |
| `query_task` | read | no | Poll status / progress / log tail |
| `list_tasks` | read | no | Task history (filterable by project/status) |
| `get_task_report` | read | no | Full text of a round's `report.md` |
| `cancel_task` | write | yes | Cancel (CLI: kill the process tree; GUI: best-effort stop click + bounded wait) |
| `verify_task` | read | no | Run acceptance once against a task or project path (never modifies source) |
| `rework_task` | write | yes | Manual rework; feeds the failure summary back to the same agent |
| `get_profiles` | read | no | Agent adapters and executable probe results |
| `prepare_visual_baseline` | write | yes | Produce a baseline candidate and summary (never writes the real baseline) |
| `approve_visual_baseline` | write | yes | After user review, verify the digest and write the baseline |

> **Approval is an annotation, not a boundary**: `_meta.requireApproval` and `annotations` are merely metadata published to the host — **actual authorization control must come from the host**.

**Return contract (dual track, `src/mcp/formatter.ts`)**: the same `MetaBlockFields` object is delivered twice —

1. **Text track**: a human-readable body plus a trailing meta block for hosts that only read text;
2. **Structured track**: the MCP-standard `structuredContent` for modern hosts that consume structured fields directly.

```text
<human-readable text>
---agent-foreman-meta---
{ ...MetaBlockFields: taskId, status, ok, round, changedFiles, diffstat, ... }
---agent-foreman-meta---
```

```jsonc
// the same object on its second delivery path (structuredContent)
{ "ok": true, "taskId": "tsk_…", "status": "succeeded", "round": 1, "message": "…" }
```

**Contract discipline**: tools declare a loose `outputSchema` (`TOOL_OUTPUT_SHAPE`, all fields optional with passthrough) and clients validate `structuredContent` against it. The **top-level object must therefore stay stable and its fields may only be added, never renamed or removed** — renaming a field breaks an already-published return contract. `META_BLOCK_FIELDS` is the single source of truth for field names, and protocol tests assert that no unregistered field appears in the meta block. Visual-baseline tools return a free-form result wrapped in the envelope `{ ok, message, result }`; `get_task_report` returns the report text and supplies `reportRound` / `reportFiles` on the structured side.

**Error paths are dual-track too**: `errorResult()` uniformly produces `{ ok: false, message }` (both direct returns in `src/server.ts` — argument-validation failure and handler exception — go through it). **Note the distinction**: *schema-level* invalid arguments are rejected by the SDK at the protocol layer as a JSON-RPC error (`-32602`, which structurally cannot carry `structuredContent`), whereas semantic errors thrown inside a handler go through `errorResult` and do carry full `structuredContent`.

**Validation happens in two stages**: `server.ts` first runs `inputSchema.safeParse()` for protocol-level validation; handlers then apply semantic gates, such as the `projectPath` safety check (absolute, exists, realpath-normalized, rejecting the home directory and root-level/system directories), rejecting `mode` for anything but TraeWork, and allowing `allowCreateProject` only for ZCode.

Progress is **persisted, never pushed**: GUI adapters report on the `gui.progressIntervalMs` cadence (default 30 s), `TaskOrchestrator` writes a `note` event into `task.jsonl` and refreshes the snapshot's `progressSummary` / `lastRunSignal`, and `query_task` reads the latest snapshot plus event stream on each call. A poller therefore sees the *last persisted* progress.

---

## 5. Task domain: state machine, queue, persistence

### 5.1 State machine (`src/tasks/task.ts`)

```text
   run_task ──► queued ──► running ──► verify_start ──┬──► succeeded
                  ▲          ▲            │           ├──► failed
                  │          │            ▼           └──► needs_attention
                  │          └──── fixing ◄───────────┘
                  │
                  ├──► needs_user ──► queued   (resumed by continue_task)
                  ├──► cancelled
                  └──► interrupted
```

- **Terminal states**: `succeeded` / `failed` / `needs_attention` / `cancelled` / `interrupted`.
- `needs_user` is a **pause state**, not a terminal one: `continue_task` can push it back to `queued` (codex / zcode only).
- Every transition is persisted through the `task.jsonl` event stream and can be replayed after a restart.

### 5.2 Queue and concurrency

- **Serial per project**: tasks sharing a `projectPath` are queued so that two agents never edit the same workspace at once.
- **Global gate**: `concurrency.maxRunning` (default 2) caps how many tasks run simultaneously.
- **Re-dispatch guard**: when the same project already has a run that has not stopped → `instance_busy` rejects the dispatch outright, preventing overlapping turns.
- **Project-less mode** (ZCode only): when `projectPath` is omitted the task runs in the `default` workspace, skipping project registration, git baseline, project snapshot, project lock and project acceptance; the terminal state is annotated structurally as `not_applicable: no_project`.

### 5.3 Persistence and atomic writes

Every write goes through **atomic write** (temp file + rename) so that half-written state can never be read. `task.json` is a snapshot and `task.jsonl` is the authoritative timeline; when the two disagree, the event stream wins.

### 5.4 Cancellation semantics

| Agent type | Cancel action |
|---|---|
| CLI (spawn) | Kill the process tree (POSIX: SIGTERM then SIGKILL on the process group; Windows: `taskkill`) |
| GUI (codex / zcode / traework) | Best-effort click of the in-app stop button over CDP, with a bounded wait (`gui.cancelWaitMs`, default 15 s) for the GUI to go idle |

**Cancellation must never lie**: when the stop could not be confirmed the terminal state must say so explicitly ("GUI run not confirmed stopped"). In `needs_user` the MCP side no longer holds a CDP connection and cannot stop a waiting in-GUI session; the terminal copy states plainly that manual inspection is required.

---

## 6. Orchestration: the automatic verify-and-rework loop

`TaskOrchestrator` in `src/loop/fix-loop.ts` is the single implementation of the loop:

```text
queued →(dispatch) running → agent finishes
   → autoVerify? verify_start → acceptance
        ├─ passed ───────────────────────────► succeeded
        ├─ failed and round < autoFixRounds ─► fixing (generate repair plan → next running)
        ├─ failed and rounds exhausted ──────► needs_attention
        └─ acceptance blocked (config/visual)► needs_attention
   → autoVerify=false ───────────────────────► judged by the agent terminal state
```

Key points:

- **Repair plan**: on acceptance failure a repair-plan document is generated automatically. The Codex path writes it **inside the project** at `gui.fixPlanDir` (default `.agent-foreman/plans/`) with the round number in the filename — one per round, never overwritten — and cites it directly in the repair instruction; other agents write it into the task directory.
- **Round precedence**: call argument > agent default (codex 5, zcode 2; traework has none) > server default 0 (disabled).
- **Visual blockers do not trigger rework**: for a blocked task `rework_task` **re-verifies first** (no agent start, no rework round consumed) and finishes as soon as it passes.
- **Feedback race**: `startTask` atomically takes and clears `reworkFeedback` **at start** (not by deleting during teardown), so a "fail → immediately rework" sequence always finds the feedback in the rework round.

---

## 7. The acceptance engine

`src/verify/` is the objective implementation of "how we judge the work", computed against the **git baseline**.

### 7.1 Check sources and precedence

```text
extraChecks argument > project .agent-foreman/acceptance.json > projects.json admin records > default set derived from the tech stack
```

- The default set derives `typecheck / lint / test / build` from `package.json` `scripts`; when no command is runnable it is labelled **weak verification**.
- `checksMode` defaults to `append`; only `replace` substitutes the base set.

### 7.2 Three check families

| Family | Contents |
|---|---|
| **Command checks** | Structured argv (`shell:false`) execution capturing exit code and output tail; supports an `optional` flag (failure does not affect the verdict) |
| **Code analysis** | Deterministic rules: TODO/FIXME, `console.log`/`debugger`, credential-like shapes, oversized single-file changes, change list and diffstat |
| **Visual checks** | Optional module, see §9 |

> Code analysis is **deterministic rules, not an LLM review** — a hit only asks a human to look, and does not by itself mean the task failed.

### 7.3 fail-closed invariants

1. **Zero test cases is a failure**: a test command exiting 0 while reporting zero test cases → failed (so "the tests never ran" cannot pass).
2. **requireChanges gate**: git projects require changes relative to the pre-work baseline by default (so an agent that did nothing cannot report success). Read-only/analysis tasks must explicitly set `requireChanges: false` or they will always fail.
3. **Missing dependencies block explicitly**: missing visual dependencies (`sharp` / `pixelmatch` / `puppeteer-core`) **block loudly** rather than degrading silently.

### 7.4 Parallelism

Command checks default to **bounded parallelism of 2** (`verifyConcurrency`, range 1–4; out-of-range values are clamped rather than invalidating the whole config). When checks have ordering dependencies (a later check reads build output, uses `--fix`, or shares a cache dir) set it to `1` for fully serial execution, otherwise intermittent false failures appear. Results are returned **in declared order**, and report and log formats are unaffected by the parallelism setting.

### 7.5 Report artifacts

Each acceptance round produces `report-<round>.md` (human) and `report-<round>.json` (machine, containing `checks[]` PASS/FAIL/SKIP and the `analysis` section); when visual acceptance is enabled it additionally produces the offline `report-<round>.html` (side-by-side / overlay / region locating).

---

## 8. The agent driver layer

### 8.1 The `AgentAdapter` contract (`src/agents/adapter.ts`)

```text
run(taskCtx)     execute a task: deliver the brief, observe to completion, return the terminal state and artifacts
cancel(taskCtx)  best-effort stop of the current run
resolve()        resolve availability: discover the install, probe the executable, return status and notes
```

The profile's `driver` selects one of two execution surfaces:

| driver | Implementation | Applies to |
|---|---|---|
| `spawn` | `src/agents/spawn.ts` + `src/agents/cli.ts` | Agents with a headless CLI/API; user-defined profiles go this way |
| `gui` | `src/agents/{codex,zcode,traework}/` | Agents drivable only through their desktop UI (constraints C3/C4) |

### 8.2 GUI instance lifecycle (`src/agents/gui-instance.ts`)

| Concern | Rule |
|---|---|
| Reuse | `gui.windowMode = "reuse"`: reuse the user's open instance by default and **never start a second one** |
| Managed instances | Codex / ZCode start a managed instance with a dedicated `user-data-dir`; **never touch the user's manually opened default instance** |
| Retention | Codex / ZCode set `keptInstance: true` on nearly every return path and never kill the process; TraeWork releases only the instance it started, and only on a clean completion |
| Ownership check | Before releasing, TraeWork verifies the command line contains the debug port plus the exe name, and `taskkill` is used **without `/T`**; Codex stops only managed instances |
| Orphans | When ZCode finds an instance that is alive but opened no CDP port → `needs_user(close_existing_instance)`, handed to the user — **never killed blindly** |

> **`detached: true` is an invariant, not a platform preference**: a desktop instance must outlive the MCP server exit for `keptInstance` to mean anything.
> Note the opposite family: **execution subprocesses** (`agents/spawn`, `verify/runner`, `visual/services`) must be reaped with the server, so those do branch per platform.

### 8.3 Execution order for the three GUI drivers

**TraeWork**:

```text
ensure instance available → wait for UI ready → new session → switch to target mode →
bind project inside that mode → switch model → send → poll to completion
```

> **Critical fact**: Work / Code / Design **each keep their own project binding**, and switching mode replaces the composer's project with whatever that mode used last. You must therefore **switch mode first and bind the project inside the target mode**, then confirm that "mode + project" are both in place — any mismatch fails loudly.

**ZCode**:

```text
discover install → start/reuse the CDP instance (shared deadline budget) →
bind project (staged trigger location + full-path criterion) →
select model (direct pick first, provider/family grouping as fallback, decode stable attributes on read-back) →
grant full-access permission → send (button-readiness check → marker/session diff location) →
liveness/question detection → poll to completion
```

> Questions, the login page, a stale instance with no CDP, macOS accessibility permission and incomplete auto-recovery become
> `agent_question` / `login_required` / `needs_user(close_existing_instance)` / `system_permission` / `setup_recovery` respectively, all resumed by `continue_task`.

**Codex**:

```text
MSIX discovery (Appx query first, disk scan as fallback) → COM activation + dedicated user-data-dir + CDP port →
project registration/binding → select model and reasoning level →
send (planDoc/designSystem folded into the initial instruction) →
liveness detection (stop button + conversation-hash stall) → poll to completion
```

> Stopping at a "waiting for user" screen (plan confirmation card / subscription checkout) → stall detection turns it into `needs_user(user_confirmation)`; after the user acts, `continue_task` re-observes (**without resending any message**). `login_required` re-checks the environment and re-dispatches the brief.

### 8.4 Codex project registration (`src/agents/codex/registry.ts`)

The Codex desktop app's project list comes from `local-projects` + `project-order` in `~/.codex/.codex-global-state.json`. Creating a project through the UI ("new project → source folder") requires driving the native Windows folder dialog, which is unreliable unattended; the server therefore offers a **direct registration** path that is equivalent to the user having created the project once inside Codex.

Safety constraints (fail-closed — on failure it falls back to the UI path and never damages user state):

- It only applies when the state file exists and parses;
- **Idempotent**: an existing registration for the same path returns immediately without writing;
- A **backup** is taken before writing (new suffix `.agent-foreman-backup.json`), created **only when absent** so the first good copy survives;
- The **legacy brand suffix** `.tianshu-mcp-backup.json` is still recognized: when an old backup exists nothing new is created or overwritten, preserving the user's clean rollback point from before any tool touched the file (see §13.3);
- **Atomic write** (temp file + rename) touching only the `local-projects` / `project-order` keys and leaving every other key intact;
- It writes only while **managed instances are stopped**, so a running Codex cannot overwrite the change from its in-memory state.

### 8.5 Completion detection (liveness)

Completion depends on **UI signals** and cannot be inferred from "the screen stopped changing":

- While the stop button or a loading marker is present the task is not finished;
- Completion markers are accepted only when no run signal is present;
- Static rounds merely arm the `idleTimeoutMs` idle timer (default 10 minutes) and **do not treat a static screen as completion** — this prevents "still generating, but the DOM happens to be static" from being misjudged.
- Abnormal endings (`idle_no_completion` / `timeout` / `aborted` / `cdp_lost`) **keep the scene**; `query_task`'s meta reports `agentEndReason` and `keptInstance`.

### 8.6 Hard failures and error codes

Hard failures (`hardFailure`) **skip acceptance and rework entirely**; locate them directly through the meta's `agentEndReason` / `errorType` / `message`. Common `agentEndReason` values:

| Code | Meaning |
|---|---|
| `setup_failed` | Install not found / instance not ready / "new chat" not clickable |
| `project_ambiguous` / `project_mismatch` / `project_create_failed` | Project disambiguation, binding read-back mismatch, in-GUI creation failure |
| `model_unavailable` / `model_mismatch` | Requested model absent from the panel / read-back differs from expectation |
| `permission_unknown` | Permission mode unconfirmed |
| `cdp_disconnected` | CDP connection dropped and not recovered |
| `instance_busy` | The same project already has an unstopped run (re-dispatch guard) |
| `session_lost` | ZCode cannot find the original session anchor |
| `input_mismatch` / `send_unknown` | Pre-send read-back mismatch / send result unconfirmable (**never resend**) |
| `idle_timeout` | GUI static for a long time with no completion marker |
| `setup_recovery` | ZCode initialization/native-panel operation timed out or the recovery budget ran out |
| `task_timeout` (`errorType=timeout`) | Task-level timeout |
| `aborted` (`errorType=cancelled`/`interrupted`) | Cancelled/interrupted |

`errorType` values: `timeout` / `spawn` / `agent_failed` / `verify_failed` / `cancelled` / `interrupted` / `agent_unresolved` / `internal`.

---

## 9. The visual acceptance path (optional module)

Disabled it has zero effect on existing behaviour; enabled it is an acceptance path **independent of command checks**.

```text
project acceptance.json sets visual.enabled=true
  → pages: three sources (existing / command / static) + declarative steps + stabilization sampling + explicit masks
        → pixel comparison against the approved baseline (pixelmatch)
        → when pages[].content is declared, reuse the same screenshot for content judgement (pixel:false means content only)
  → images: explicit file list + encoding/size/DPI/transparency spec checks
  → content (optional): a user-supplied command judges "does the image/screenshot match the declared expectation"
        → majority-vote sampling + task-level input-hash cache (keyed including the command binary identity)
        → warning-only by default (optional); only blocking:true rules can fail a round or trigger rework
  → defects rework per autoFixRounds; blockers → needs_attention
  → rework_task re-verifies a blocked task first, without starting an agent
```

### 9.1 Defects vs blockers

| Class | Examples | Handling |
|---|---|---|
| **Visual defect** | Layout differences, image spec violations, locatable interaction failures | Rework per `autoFixRounds` |
| **Visual blocker** | Missing baseline, unreachable page, missing browser, policy-blocked resource, unstable screenshots | Goes to `needs_attention` and **does not trigger agent rework** |

### 9.2 Baselines require two stages

1. `prepare_visual_baseline` — produces only a candidate (`visual-candidates/<uuid>/`, containing `candidate.json`, PNG and `preview.html`) plus a summary; it **never adopts the real baseline**.
2. `approve_visual_baseline` — called only after explicit user review and authorization. Before writing it verifies the **three-way digest** (candidate digest + existing baseline digest + config digest), checks that the target path is not gitignored and that the associated task really is `needs_attention` in the same project, then atomically writes the baseline and the `manifest.json` approval record.

**A missing baseline can never yield a pass, and automatic rework is forbidden from calling the approval entry point.**

### 9.3 Engineering constraints (`src/visual/`)

| Concern | Implementation |
|---|---|
| Browser | `puppeteer-core` headless Chrome/Edge; `managed` mode installs a pinned version into `<data home>/browsers` via `@puppeteer/browsers` |
| Resource policy | Only local origins plus `allowedOrigins`; everything else is intercepted (`RESOURCE_BLOCKED`) |
| Stability | Requires `stabilitySamples` (default 3) consecutive byte-identical screenshots, otherwise `SCREENSHOT_UNSTABLE` |
| Budget | `VisualBudget`: per-round deadline plus an artifact byte cap (default 500 MiB) |
| Mutual exclusion | `withVisualLock()`: `<data home>/visual-locks/<sha256(key)>.lock`, returning `VISUAL_BUSY` when held |
| Missing dependencies | Missing `sharp` / `pixelmatch` / `puppeteer-core` **blocks explicitly** rather than degrading silently |
| Rule freezing | Config or baseline modified during a task → `VISUAL_INTEGRITY`, preventing an agent from weakening the rules |

### 9.4 AI content validation (optional, off by default)

**Credential boundary**: the MCP never reads, stores or forwards credentials and implements no model/vendor HTTP client; the judgement is fully delegated to a local command the user declares. The MCP itself only expands placeholders (`<image:path>` / `<expect:file>` / `<image:base64:file>`), runs the subprocess with `shell:false` and a structured argv, and validates the strict JSON on the command's last stdout line. The egress gate is enforced at the **contract layer**: `allowRemote` defaults to `false`, so a rule that was not cleared and uses `<image:base64:file>` is rejected by the schema outright. Whether the command itself sends images off-machine **cannot be intercepted at the system level** and must be confirmed by the user (see `SECURITY.en.md`).

**Status semantics**: `uncertain` on `VisualResult.status` (votes split, or below `minConfidence`) matches neither `visualFailed` (which takes only `failed`) nor `visualBlocked` (which takes only `blocked`), so it **never participates in the verdict**. Whole-round failures (`CONTENT_COMMAND_MISSING` / `CONTENT_ENV_MISSING`) are raised during preflight (`assertContentReady` enumerates every rule's **effective** command and env) and escalate to `configurationError` through `acceptance.ts`'s try/catch, producing **no result rows at all**.

| Concern | Implementation notes |
|---|---|
| Content judgement | `src/visual/content*.ts`: command resolution (`where`/`which`), placeholder expansion, `runChild`-semantics subprocess execution, strict JSON on the last stdout line; the pure `tallyContentVotes` majority vote and confidence gate; a task-level cache keyed including `commandPath`/`commandDigest` so a user CLI upgrade invalidates it |
| Semantic-only pages | `pages[].pixel:false` skips the baseline requirement and pixel comparison (must have `content`); `prepareBaseline` skips them explicitly and never lists them as candidates; `captureVisualSnapshot` records their baseline as an **explicit null** (rather than reading possibly stale unrelated files and drifting the frozen digest) |
| Warning isolation | `blocking:false` → `optional:true`, entering neither `visualBlocked` nor `visualFailed` and triggering no rework; the repair plan lists them under "warning-only items (no fix needed)" |

### 9.5 CLI subcommand family

```bash
node dist/index.js visual init [project]                   # write a disabled template config
node dist/index.js visual doctor [project]                 # two findings: content-command resolution and budget comparison
node dist/index.js visual browser install                  # install the managed browser
node dist/index.js visual baseline prepare|approve …       # the two baseline stages
node dist/index.js visual rules review|approve …           # rebuild the rule snapshot
node dist/index.js visual artifacts clean <taskId>         # clean task artifacts (preview by default)
node dist/index.js visual content probe <project> [ruleId] # run a real judgement without writing evidence/cache
node dist/index.js visual content cache clear <taskId>     # clear the task-level judgement cache
```

---

## 10. Configuration system and hot reload

### 10.1 Three configuration layers

| Layer | Location | Key fields |
|---|---|---|
| Server config | `<data home>/config.json` | `concurrency.maxRunning`, `defaultTaskTimeoutMs`, `verifyCommandTimeoutMs`, `verifyConcurrency`, `skills.autoInstall` |
| Project acceptance | `<project>/.agent-foreman/acceptance.json` | `checks[]`, `visual`, `requireChanges` (default `true`), `verifyConcurrency` |
| Agent profile | `<data home>/agent-profiles.json` | see `docs/agent-profiles.en.md` |

**Precedence**: project > server > built-in defaults. Project-level config reads `.agent-foreman/` only and **never consults a legacy directory**.

### 10.2 Hot reload

`config.json` and `agent-profiles.json` are re-read after modification (no server restart needed), so agent-profile adjustments and concurrency tweaks take effect immediately. Visual config and baselines are **frozen for the duration of a task** (`visual-snapshot.json`) to prevent mid-task drift.

---

## 11. Cross-platform strategy

| Concern | Windows | macOS / Linux |
|---|---|---|
| Paths | Native separators plus drive letters; `normalizeDir()` handles case-insensitivity | POSIX semantics; symlinks normalized via realpath (`/tmp` → `/private/tmp`) |
| Codex launch | MSIX COM activation (`IApplicationActivationManager`) | Spawn the executable inside the `.app` bundle directly |
| Process termination | `taskkill` (no `/T` for managed instances) | Process group SIGTERM → SIGKILL |
| TraeWork folder dialog | Driven through the computer-use allow-list | Not measured; the macOS branch is fail-closed |
| Managed instance survival | `detached: true` (invariant) | Same; execution subprocesses branch per platform instead |

CI verifies this on the three-platform matrix (see §14.3).

---

## 12. Security boundary and hard red lines

1. **Never kill TraeWork by process tree blindly**: terminate only PIDs this module created and whose command line has been verified, and never with `/T`.
2. **Reuse the user's instance by default**: `gui.windowMode = "reuse"` and never start a second one; managed instances likewise never touch a manually opened instance.
3. **computer-use allow-list**: only the TraeWork folder-selection dialog (window title + host process double check); every other window yields `COMPUTER_USE_DENIED`.
4. **Zero credential management**: no agent credential is read, decrypted or forwarded; GUI adapters drive the UI only. **The same applies to AI content validation**: no model/vendor HTTP client and no key reading, with judgement delegated to a user-supplied command; the egress gate is contract-layer only, and **it cannot stop a user command from sending images off-machine** — that boundary must be stated honestly (see `SECURITY.en.md`).
5. **No shell interpolation for commands**: acceptance commands are structured argv with `shell:false`.
6. **No automatic commit / stash / rollback**: a git baseline is captured before work and reports are computed against it.
7. **No hardcoded paths**: machine paths / usernames / ports come from profiles or placeholders (`{LOCALAPPDATA}`, `{PROGRAMFILES}`, `{HOME}`, …, expanded case-insensitively).
8. **stdout carries JSON-RPC only**: every diagnostic log goes to stderr (and is mirrored into `logs/server.log`). Any noise on stdout corrupts the MCP stream and breaks strict-client handshakes.
9. **The path gate must not be relaxed**: `projectPath` must be an existing absolute directory, and after realpath normalization anything inside the home directory or a system/root-level directory is rejected.
10. **Visual baselines must not be rewritten by automation**: the approval entry point may be called only after explicit user authorization, and baselines/thresholds/masks/enabled rules must never be weakened to force a pass.
11. **The return contract is add-only**: top-level `MetaBlockFields` / `structuredContent` field names are stable, and new fields must be registered in `META_BLOCK_FIELDS`.

---

## 13. Compatibility boundaries

### 13.1 Project-level config: no compatibility read

This project reads **only** `<project>/.agent-foreman/acceptance.json`. `readAcceptanceConfig()` returns `null` on `ENOENT` and **does not guess other locations or fall back to a legacy directory** — this strictness is deliberate and must not be relaxed "for convenience of migration".

### 13.2 Data home: no migration

The data home is `~/.agent-foreman` (env `AGENT_FOREMAN_HOME`). Task history, project registry, agent profiles and configuration under the old product's directory are **neither read nor migrated**.

### 13.3 The single retained legacy brand literal

`LEGACY_CODEX_BACKUP_SUFFIX = ".tianshu-mcp-backup.json"` in `src/agents/codex/registry.ts` is the **only intentionally retained legacy brand literal in the repository**:

- **Why it stays**: the backup is a "create only when absent" anti-overwrite mechanism protecting **the user's original Codex state** (a manual rollback exit). Without recognizing the old backup, the first registration would snapshot a state that a previous tool had already modified, silently degrading the "before any tool touched this" clean rollback point.
- **Boundary**: the check is a **pure existence test that never reads the file's contents**, and it operates on `~/.codex/` (Codex's own directory) rather than the old product's data directory — it is **anti-overwrite**, not data migration or cross-product reading.
- **Discipline**: the literal is allowed in this constant only; it must not be scattered, nor obfuscated by string concatenation to evade checks.

---

## 14. Testing and delivery pipeline

### 14.1 Test layers

| Layer | Location | Notes |
|---|---|---|
| Unit | `test/unit/` | Pure functions / parsers / state machines / config validation; no real-machine dependency |
| Integration | `test/integration/` | Runs the full task loop with a stub agent (`test/stub-agent/`), covering dispatch / acceptance / rework / cancel / timeout |
| Protocol | `test/protocol/` | Official SDK client over an in-memory transport, asserting the tool surface, the dual-track return contract and argument validation |
| Real browser | `test/integration/visual-*.test.ts` | Requires `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1`; skipped by default |

Shared fixtures live in `test/test-utils.ts`. **When you change the project-level directory convention, `test-utils.ts` and `test/stub-agent/stub-agent.mjs` are the two files that touch everything.**

### 14.2 Gate commands

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run check:stdio     # captures the full byte stream from a real subprocess; any non-protocol line, parser error, blank line or stray fragment fails it
npm run pack:check      # asserts on the npm pack artifact contents
```

### 14.3 CI and release

| Workflow | Trigger | Contents |
|---|---|---|
| `ci.yml` | push / PR to `main` | `build-test` (ubuntu / windows / macos × Node 20/22/24), `pack-check`, `visual-browser` (ubuntu / windows / macos-15-intel / macos-15 × Node 20/22/24, real browsers plus production-tarball consumer acceptance) |
| `release.yml` | push of a `v*` tag | Runs the full gate → verifies the tag version equals `package.json` → requires a successful CI run for the same SHA → bilingual body (from `docs/release-v<ver>.md` + `.en.md`, **a missing document fails the run**) → publishes the GitHub Release with the tgz attached |

The version must stay in sync in three places: `package.json`, `package-lock.json` and `src/version.generated.ts` (the last is generated from `package.json` by `scripts/sync-version.mjs` before every build — **never edit it by hand**).

---

## 15. Known gaps and design constraints

Ordered by impact on a maintainer:

1. **UI signals are the only reliable completion evidence** — all three GUI drivers depend on DOM structure and visible signals. Client upgrades can drift the selectors; fix them first in `selectors.ts` or via profile overrides, and never skip real-machine re-verification.
2. **A waiting in-GUI session cannot be stopped while `needs_user`** — the MCP side holds no CDP connection. The terminal copy says so honestly and asks for manual inspection.
3. **Single-session serialization** — the GUI is a single-session resource, so same-project tasks are serialized by `projectBusy()` and global concurrency is capped by `maxRunning`. This is a **design constraint, not a defect**.
4. **The macOS verification matrix is incomplete** — the basic macOS loops for Codex and ZCode are verified on real hardware, but cancel / rework / `continue_task` / new-project are not, so both remain `research` on darwin; the TraeWork macOS branch is fail-closed.
5. **Project-less dispatch is ZCode-only and measured on Windows only**; ZCode's auto-import of unregistered projects does not work on Windows (register the directory manually first, or pass `allowCreateProject=false` for an explicit failure).
6. **Platform boundary for visual validation** — the browser side is covered by the CI matrix; **real-machine GUI drivers are not** (they need real installs and logins). See `docs/visual-validation.en.md`.
7. **The impact of fail-closed acceptance on pure analysis tasks** — git projects require changes by default, so pure Q&A/analysis tasks must explicitly set `requireChanges: false`.

---

## 16. Extension points

### 16.1 Adding an agent (the common path)

1. **Start with a profile**: add one entry to `<data home>/agent-profiles.json` (field reference and real-machine samples in `docs/agent-profiles.en.md`). When the defaults suffice this means **zero code**.
2. **Only implement an adapter when custom parsing is needed**: the `AgentAdapter` contract in `src/agents/adapter.ts`, then `registry.register(id, adapter)`.
3. Verify: `get_profiles` should list the new profile with an executable probe result; run a stub or real-machine smoke test.

### 16.2 Other extension surfaces

| Goal | Where |
|---|---|
| Add an acceptance check | `checks[]` in the project's `acceptance.json` (no code change), or the built-in derivation rules in `src/verify/acceptance.ts` |
| Add a visual check type | `src/visual/schema.ts` + `engine.ts` + `report.ts` |
| Add an MCP tool | A `TOOL_DEFS` entry in `src/mcp/tools.ts` plus a handler in `src/mcp/handlers.ts` (registration is data-driven, so `server.ts` needs no change) |
| Adjust concurrency/timeout defaults | Defaults in `config/schema.ts` plus a README update |

---

## 17. Further reading

| Topic | Document |
|---|---|
| Install, host integration, tool usage | [README.en.md](README.en.md) / [README.md](README.md) / [Host Integration Guide](docs/host-integration.en.md) |
| Handover state, troubleshooting, pitfalls | [HANDOFF.md](HANDOFF.md) |
| Codex desktop GUI driver details | [docs/codex-gui-cdp.en.md](docs/codex-gui-cdp.en.md) |
| TraeWork GUI driver details | [docs/traework-cdp.en.md](docs/traework-cdp.en.md) |
| ZCode GUI driver details | [docs/zcode-cdp.en.md](docs/zcode-cdp.en.md) |
| Agent profile field reference | [docs/agent-profiles.en.md](docs/agent-profiles.en.md) |
| Agent capability matrix | [docs/adapter-matrix.en.md](docs/adapter-matrix.en.md) |
| Project-level acceptance config reference | [docs/acceptance-config.en.md](docs/acceptance-config.en.md) |
| Visual acceptance configuration and troubleshooting | [docs/visual-acceptance.en.md](docs/visual-acceptance.en.md) |
| Visual acceptance verification scope | [docs/visual-validation.en.md](docs/visual-validation.en.md) |
| Dev environment and commit standards | [CONTRIBUTING.en.md](CONTRIBUTING.en.md) |
| Security model | [SECURITY.en.md](SECURITY.en.md) |
