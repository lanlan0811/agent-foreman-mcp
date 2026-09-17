# Visual acceptance validation status (visual-validation.en.md)

[中文](visual-validation.md)

This document describes **how the visual acceptance capability is verified**: what CI verifies continuously, what requires manual confirmation on real machines, and where the current coverage boundaries are.

> Raw evidence files recorded per machine/date (screenshots and logs) no longer belong to this repository — since 1.0.0 this project uses a **reproducible CI matrix** as its source of verification truth rather than one-off manual records.

## 1. Source of truth: the CI visual-browser matrix

Real-browser and image acceptance runs in CI across a platform × Node matrix (the `visual-browser` job in `.github/workflows/ci.yml`):

| Dimension | Value |
|---|---|
| OS | `ubuntu-latest`, `windows-latest`, `macos-15-intel`, `macos-15` |
| Node | 20, 22, 24 |
| Switch | `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1` |
| Tests | `npx vitest run visual --maxWorkers=1` |

That job does two extra things so that the **distributed package** (not just the source tree) also passes visual acceptance:

1. **Pinned browser install**: installs the managed browser via `node dist/index.js visual browser install`;
2. **Production tarball consumer acceptance**: `npm pack` → install into a clean directory → `scripts/check-visual-consumer.mjs` launches it and runs visual acceptance against a real project.

Reproduce the same suite locally:

```bash
AGENT_FOREMAN_VISUAL_BROWSER_TEST=1 npx vitest run visual --maxWorkers=1
```

Without `AGENT_FOREMAN_VISUAL_BROWSER_TEST=1` these tests are **skipped** (not counted as failures), so they do not appear in a plain `npm test` — by design, to avoid false alarms where no browser is available.

## 2. Covered capabilities

The real-browser tests in the CI matrix cover:

- Managed browser installation and launch (including the AppArmor setup required for the Linux sandbox);
- Real page capture and screenshot persistence;
- Pixel comparison (`pixelmatch`) and diff-image output;
- The full flow of baseline candidate preparation → user approval → freezing;
- The semantics that visual blockers (missing baseline, unreachable page, policy-blocked resource) do not trigger agent rework, and that `rework_task` re-verifies first;
- Offline HTML report output (side-by-side / overlay / region locating).

## 3. Platform notes

| Platform | Notes |
|---|---|
| **Linux (Ubuntu)** | The Chrome sandbox needs user namespaces. CI allows it via an AppArmor profile (`agent-foreman-visual-chrome`); check this prerequisite first if launch fails in a self-built environment |
| **Windows** | The managed browser and `visual browser install` are verified; make sure node/npx are on `PATH` |
| **macOS** | Both Intel and Apple Silicon are covered; `/tmp` resolves to `/private/tmp` (use realpath when comparing paths) |

## 4. Known limitations

- **Real-machine GUI drivers are outside this matrix**: the browser side of visual acceptance is covered by CI, but the **GUI drivers** for Codex / TraeWork / ZCode (controlling desktop apps over CDP) require real installs and logins and cannot run in CI; those are verified manually on a real machine — see `docs/codex-gui-cdp.md`, `docs/traework-cdp.md`, `docs/zcode-cdp.md`.
- **Visual acceptance depends on reproducible rendering**: fonts, zoom, animation and async loading cause pixel jitter. For unstable cases, prefer narrowing the checked region or freezing animations over loosening thresholds (which would hide real defects).
- **AI content validation (`visual.contents[]` / `pages[].content`) warns only by default**: its verdict comes from a user-supplied local command, as the MCP embeds no model client, so only `blocking: true` rules can fail a round.
- **Baselines must be reviewed and approved by the user**: automation can only prepare candidates, never approve them (`VISUAL_INTEGRITY` detects bypass attempts).

## 5. Maintenance guidance

- When adding visual capability, **also** add coverage in the CI matrix tests; code without tests does not count as done.
- When changing the switch or environment variable names used by visual tests, update both `.github/workflows/ci.yml` and the related scripts, otherwise the matrix will silently skip (appearing "green but not run").
- This file describes **verification scope and boundaries only**; for configuration syntax see `docs/visual-acceptance.md`.
