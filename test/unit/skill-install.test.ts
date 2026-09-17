/**
 * 技能自装（D8）单测：安装目标必须是 Agents Skills 开放标准的用户级目录
 * `~/.agents/skills/agent-foreman-mcp/`，不得回退到任何宿主专属目录。
 * 另覆盖幂等语义：内容一致 → skip；内容变化 → 备份旧版后覆盖。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_NAME, resolveSkillDestDir, skillSelfInstall } from "../../src/util/skill-install.js";
import type { Logger } from "../../src/util/log.js";

/** 只记录调用的哑 logger（测试不关心日志文案，但要验证行为分支） */
function makeLogger(): Logger & { infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    info: (m: string) => void infos.push(m),
    warn: (m: string) => void warns.push(m),
    error: () => {},
    debug: () => {},
  } as unknown as Logger & { infos: string[]; warns: string[] };
}

describe("resolveSkillDestDir（技能安装目标，D8）", () => {
  it(`指向 ~/.agents/skills/${SKILL_NAME}（Agents Skills 开放标准，用户级）`, () => {
    const dest = resolveSkillDestDir();
    const expected = path.join(os.homedir(), ".agents", "skills", SKILL_NAME);
    expect(dest).toBe(expected);
  });

  it("不再使用任何宿主专属目录（.rivet 等）", () => {
    expect(resolveSkillDestDir()).not.toMatch(/\.rivet/);
    expect(resolveSkillDestDir()).toMatch(/[\\/]\.agents[\\/]skills[\\/]/);
  });

  it("SKILL_NAME 为完整包名 agent-foreman-mcp", () => {
    expect(SKILL_NAME).toBe("agent-foreman-mcp");
  });
});

describe("skillSelfInstall 幂等与备份", () => {
  let home: string;
  let src: string;
  const realHome = os.homedir();

  beforeEach(() => {
    // 进程级隔离：技能目标走 os.homedir()，必须改 HOME/USERPROFILE 才能不污染开发机
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-foreman-skillhome-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    src = fs.mkdtempSync(path.join(os.tmpdir(), "agent-foreman-skillsrc-"));
    fs.writeFileSync(path.join(src, "SKILL.md"), "v1\n", "utf8");
  });

  afterEach(() => {
    process.env.HOME = realHome;
    process.env.USERPROFILE = realHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("首次安装到 <隔离HOME>/.agents/skills/ 并返回 installed", async () => {
    const logger = makeLogger();
    const r = await skillSelfInstall(logger, { sourceDir: src });
    expect(r.installed).toBe(true);
    expect(r.failed).toBe(false);
    expect(r.destDir).toBe(path.join(home, ".agents", "skills", SKILL_NAME));
    expect(fs.readFileSync(path.join(r.destDir, "SKILL.md"), "utf8")).toBe("v1\n");
  });

  it("二次安装内容一致 → 幂等 skip，不产生备份", async () => {
    const logger = makeLogger();
    await skillSelfInstall(logger, { sourceDir: src });
    const r2 = await skillSelfInstall(logger, { sourceDir: src });
    expect(r2.skipped).toBe(true);
    expect(r2.installed).toBe(false);
    const parent = path.dirname(r2.destDir);
    const baks = fs.readdirSync(parent).filter((n) => n.includes(".bak-"));
    expect(baks, "内容一致时不应产生备份").toEqual([]);
  });

  it("内容变化 → 备份旧版后覆盖（旧版仍可找回）", async () => {
    const logger = makeLogger();
    const r1 = await skillSelfInstall(logger, { sourceDir: src });
    fs.writeFileSync(path.join(src, "SKILL.md"), "v2\n", "utf8");
    const r2 = await skillSelfInstall(logger, { sourceDir: src });
    expect(r2.installed).toBe(true);
    expect(fs.readFileSync(path.join(r2.destDir, "SKILL.md"), "utf8")).toBe("v2\n");
    const parent = path.dirname(r2.destDir);
    const baks = fs.readdirSync(parent).filter((n) => n.includes(`${SKILL_NAME}.bak-`));
    expect(baks.length, "覆盖前应备份旧版").toBe(1);
    const bakSkill = path.join(parent, baks[0]!, "SKILL.md");
    expect(fs.readFileSync(bakSkill, "utf8")).toBe("v1\n");
    expect(r1.destDir).toBe(r2.destDir);
  });
});
