# agent-profiles.en.md — Agent Profiles & Dynamic Discovery

[中文](agent-profiles.md)

External AI agents plug into `agent-foreman-mcp` through a **profile**: each agent is declarative data (executable /
argument template / working directory / env / timeout / login method), so **adding an agent needs no code change** —
add one profile to `agent-profiles.json` in the data home. Only agents with special output parsing need an adapter
subclass on top.

## Storage locations

| Level | File | Notes |
|---|---|---|
| Built-in | `src/agents/builtin.ts` | Default profiles shipped in code (codex / zcode / traework); updated with releases |
| User | `~/.agent-foreman/agent-profiles.json` (`AGENT_FOREMAN_HOME` overrides) | Overrides a built-in profile by whole key |

Merge rule: built-ins first, then user overrides (for the same `id`, the user entry wins).

## Profile fields

```jsonc
{
  "profiles": {
    "<agentId>": {
      "displayName": "Codex (OpenAI desktop CLI)",  // display name
      "type": "cli",                                  // cli only for now
      "driver": "spawn",                              // spawn = external child process (default); gui = desktop UI automation
      "adapter": "zcode-gui",                         // GUI option: codex-gui | zcode-gui | traework-gui
      "status": "ready",                              // ready | research | unsupported
      "command": null,                                // executable; null + discovery = auto-probe
      "argsTemplate": ["exec", "<prompt:arg>", "--skip-git-repo-check"],
      "promptMode": "arg",                            // arg | stdin | file
      "cwd": "task",                                  // task = project dir, home = user home
      "env": {},                                      // extra environment variables (fill sensitive values locally)
      "timeoutMs": 1800000,
      "killTree": "taskkill",                         // taskkill | group
      "authNote": "Reuses the ~/.codex login",        // documentation only; never stores keys
      "executableDiscovery": {                        // optional executable auto-discovery
        "dirs": ["{LOCALAPPDATA}/OpenAI/Codex/bin"],
        "fileNames": ["codex.exe", "codex"],          // without fileNames the directory is not scanned
        "fallbackCommand": "codex",                   // last resort: look up on PATH
        "preferredDrives": ["D:"],                    // Windows fixed-drive priority
        "relativePaths": ["<App>/<App>.exe"]          // candidate relative to a drive root (example; fill in for your product)
      },
      "gui": {                                        // used only when driver="gui"
        "cdpPort": 9222, "cdpPortAuto": true, "cdpPortRange": 20,
        "exeArgs": ["--remote-debugging-port=<port>"], "windowMode": "reuse",
        "launchTimeoutMs": 60000, "pollIntervalMs": 3000, "stableRounds": 12,
        "idleTimeoutMs": 600000, "cdpSendTimeoutMs": 15000, "progressIntervalMs": 30000,
        "modelSwitch": true, "modeSwitch": true, "freshSession": true, "selectors": {},
        "modelRequired": false, "defaultPermissionMode": "Full Access", "defaultAutoFixRounds": 2
      }
    }
  }
}
```

### driver (execution surface)

| Value | Meaning |
|---|---|
| `spawn` (default) | Launches an external CLI child process (`argsTemplate` + `promptMode`); the verdict comes from the exit code |
| `gui` | Drives a desktop UI over CDP (the built-in `codex` / `zcode` / `traework` take this route); no child process, and `run_task` may pass `model` to pick its model |

> With `driver=gui`, `argsTemplate` / `promptMode` have no effect. The explicit `adapter` field separates the GUI
> adapters from one another. See [codex-gui-cdp.en.md](codex-gui-cdp.en.md), [zcode-cdp.en.md](zcode-cdp.en.md) and
> [traework-cdp.en.md](traework-cdp.en.md).

Liveness-related fields: `stableRounds` only confirms the DOM is stable; `idle` is returned only after another
`idleTimeoutMs` with no change and no authoritative running signal. `cdpSendTimeoutMs` bounds a single CDP command
wait, while `progressIntervalMs` controls how often progress events become visible through `query_task`. Idle,
timeout, cancellation and CDP loss retain the instance and expose `agentEndReason` / `keptInstance` in the metadata.

### promptMode

| Mode | Meaning |
|---|---|
| `arg` | The prompt is inlined into the arguments: `<prompt:arg>` in `argsTemplate` is replaced |
| `stdin` | The prompt is written to stdin (stdio pipe) — **the most portable option** |
| `file` | `<task dir>/prompt-<round>.txt` is written first and `<prompt:file>` in the arguments points at it |

### Discovery order (resolve)

`executableDiscovery.dirs` supports `{LOCALAPPDATA}`, `{APPDATA}`, `{HOME}`, `{USERPROFILE}`, `{PROGRAMFILES}`,
`{PROGRAMFILES(X86)}`, `{SYSTEMDRIVE}` and `{XDG_DATA_HOME}`. Placeholder matching is case-insensitive; docs and
built-in profiles consistently use uppercase. Unknown placeholders, or ones undefined in the current environment,
are left as-is.

1. `command` is an existing absolute path → use it directly
2. Look for `fileNames` inside `executableDiscovery.dirs` (**the directory is scanned only when `fileNames` is
   present**), picking the newest by mtime
3. `fallbackCommand` / a relative `command` is looked up on `PATH`
4. All fail → `ok:false`, and `get_profiles` shows the reason

> The Codex desktop app is an MSIX package and the built-in adapter takes the `codex-gui` route (see
> [codex-gui-cdp.en.md](codex-gui-cdp.en.md)). For headless execution (`codex exec`), add a separate
> `driver: "spawn"` profile (see "Headless path example" below).

## Real samples

### Codex desktop (GUI driver)

```jsonc
// ~/.agent-foreman/agent-profiles.json (Windows example)
{
  "profiles": {
    "codex": {
      "displayName": "Codex (OpenAI desktop)",
      "type": "cli",
      "driver": "gui",
      "adapter": "codex-gui",
      "status": "ready",
      "command": null,
      "argsTemplate": [],
      "promptMode": "arg",
      "cwd": "task",
      "timeoutMs": 1800000,
      "killTree": "taskkill",
      "authNote": "Reuses the ~/.codex login (shared with the instance the user opened; the managed instance uses a dedicated user-data-dir)",
      "executableDiscovery": {
        // Appx query first (tracks versions automatically), disk scan as fallback; both dynamic, with no version number or absolute path
        "appxPackageName": "OpenAI.Codex",
        "installRelativeExe": ["app/ChatGPT.exe"],
        "scanRoots": ["{SYSTEMDRIVE}/Program Files/WindowsApps"],
        "scanPattern": "OpenAI.Codex_*_x64__*/app/ChatGPT.exe"
      },
      "gui": {
        "activation": "msix-com",
        "userDataDir": "{LOCALAPPDATA}/agent-foreman/codex-gui/profile",
        "appxPackageName": "OpenAI.Codex",
        "cdpPort": 9333,
        "cdpPortAuto": true,
        "permissionMode": "Full Access",
        "fixPlanDir": ".agent-foreman/plans",
        "defaultAutoFixRounds": 5,
        "launchTimeoutMs": 60000,
        "pollIntervalMs": 3000,
        "stableRounds": 4,
        "idleTimeoutMs": 600000,
        "selectors": {}
      }
    }
  }
}
```

> **Essential**: `activation: "msix-com"` and `userDataDir` are both mandatory — the GUI host `ChatGPT.exe` cannot be
> launched directly (policy denies it), and reusing the default profile means the debug port never opens. Details:
> [codex-gui-cdp.en.md](codex-gui-cdp.en.md).

### Headless path example: Codex CLI (`codex exec`, user-defined profile)

```jsonc
{
  "profiles": {
    "codex-cli": {
      "displayName": "Codex CLI (OpenAI headless)",
      "type": "cli",
      "driver": "spawn",
      "status": "ready",
      "command": null,   // empty = discover automatically via executableDiscovery
      "argsTemplate": ["exec", "<prompt:arg>", "--skip-git-repo-check", "--sandbox", "workspace-write"],
      "promptMode": "arg",
      "cwd": "task",
      "killTree": "taskkill",
      "authNote": "Reuses the ~/.codex login; do not combine with --approve-for-me (mutually exclusive in practice)",
      "executableDiscovery": { "dirs": ["{LOCALAPPDATA}/OpenAI/Codex/bin"], "fileNames": ["codex.exe", "codex"] }
    }
  }
}
```

> The `<hash>` directory changes as Codex updates, so use `executableDiscovery` to pick the newest instead of
> hardcoding an absolute path. This profile is not a built-in default; users create it themselves.

## Status and polling semantics

| status | Meaning | `run_task` behaviour |
|---|---|---|
| `ready` | `command` / discovery resolves | Runnable |
| `research` | Implemented, but the platform matrix is not covered yet (currently `zcode`) | Runnable when install discovery succeeds; otherwise it fails immediately with the reason |
| `unsupported` | Explicitly unsupported (see adapter-matrix.en.md) | As above |

> `traework` is `ready` + `driver=gui` (CDP-driven desktop UI; see [traework-cdp.en.md](traework-cdp.en.md)).

> `zcode` uses `driver=gui` + `adapter=zcode-gui`. `model` must be `provider/model`, the default permission is Full
> Access and the default automatic repair budget is 2 rounds. The Windows loop is complete and the basic macOS loop
> is verified; it stays `research` until the cancel / rework / new-project matrix is covered.

> `codex` uses `driver=gui` + `adapter=codex-gui` + `activation=msix-com`. Task parameters include `model` (use the
> model name the panel actually shows), `reasoningLevel` (low/medium/high), `planDoc` and `designSystem`; the default
> permission is Full Access and the default automatic repair budget is 5 rounds. Windows is `ready` and macOS is
> `research` (cancel/rework matrix not covered). See [codex-gui-cdp.en.md](codex-gui-cdp.en.md).

## FAQ

- **The wrong file was discovered**: make sure `fileNames` lists only valid executable names. For ZCode, discovery
  targets the desktop app (`ZCode.exe` / the macOS bundle) and never treats runtime data or an undocumented internal
  service as an entry point.
- **A profile change has no effect**: each resolve re-reads the profiles file and caches the result, and `get_profiles`
  triggers a fresh probe. Restarting the server after editing a profile is recommended.
- **`env` holds sensitive values**: those are visible only on this machine and are never written to `task.jsonl` or
  the logs; it is a use-at-your-own-risk field.
- **A `driver=gui` agent cannot find its executable**: `get_profiles` shows the probe result, and you can set
  `gui.exePath` in the profile to pin an absolute path.

## ZCode automatic initialization recovery

The following `gui` fields can be overridden in `agent-profiles.json` in the data home; older profiles inherit the
defaults, and other drivers do not use these recovery fields.

| Field | Default | Meaning |
|---|---:|---|
| `setupRecoveryTimeoutMs` | 120000 | Total budget from the start of initialization through completed project binding (ms) |
| `dialogProbeTimeoutMs` | 30000 | Cap for one native dialog observation (ms) |
| `dialogOperationTimeoutMs` | 60000 | Cap for one folder operation (ms) |
| `setupRecoveryMaxRetries` | 2 | Extra attempts for safely retryable stages (0–10) |

Each wait uses the minimum of its configured cap, the remaining initialization budget and the remaining task time;
retries never reset the total budget. Once binding completes only the overall task deadline remains. Periodic
progress during initialization continues to use `progressIntervalMs`.
