/**
 * 技能自检安装（D8）：server 启动后幂等同步
 * 仓库 skills/agent-foreman-mcp/ → ~/.agents/skills/agent-foreman-mcp/（os.homedir() 动态解析）。
 *
 * 目标采用 Agents Skills 开放标准（用户级 ~/.agents/skills/），不再使用任何宿主专属目录。
 * 目标已存在且内容 hash 一致 → skip；不一致 → 备份 .bak-<ts> 后覆盖。
 * 失败仅告警不阻断 server。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "./log.js";
import { mkdirp } from "./fs.js";

export const SKILL_NAME = "agent-foreman-mcp";

/** 源目录定位：本地 dev 指向仓库 skills/；npm 包内通过 import.meta.url 定位 */
export function resolveSkillSourceDir(): string {
  const here = fileURLToPath(import.meta.url); // 正确处理 Windows 盘符与非 ASCII 路径
  // <…>/dist/util/skill-install.js → 上三级到包根；包内 skills/ 与 dist/ 同级
  const candidates = [
    path.resolve(path.dirname(here), "..", "..", "skills", SKILL_NAME), // dist/util → 包根/skills
    path.resolve(path.dirname(here), "..", "skills", SKILL_NAME), // dist → 包根/skills（宽松）
    path.resolve(process.cwd(), "skills", SKILL_NAME),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* 下一个 */
    }
  }
  // fallback：仓库根（本地 dev 未 build 直接 tsx 跑）
  const repo = path.resolve(process.cwd());
  const c = path.join(repo, "skills", SKILL_NAME);
  if (fs.existsSync(c)) return c;
  return candidates[0]!;
}

export function resolveSkillDestDir(): string {
  return path.join(os.homedir(), ".agents", "skills", SKILL_NAME);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function hashDir(dir: string): string {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  files.sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(path.relative(dir, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex");
}

/** 幂等安装；返回 { installed | skipped | failed, destDir, message }
 *  opts.sourceDir / opts.destDir 仅供测试注入隔离路径；生产路径始终走 homedir 解析。 */
export async function skillSelfInstall(
  logger: Logger,
  opts: { sourceDir?: string; destDir?: string } = {},
): Promise<{
  installed: boolean;
  skipped: boolean;
  failed: boolean;
  destDir: string;
  message: string;
}> {
  const src = opts.sourceDir ?? resolveSkillSourceDir();
  const dest = opts.destDir ?? resolveSkillDestDir();
  try {
    if (!fs.existsSync(src)) {
      const msg = `技能源目录不存在（${src}），跳过安装。`;
      logger.warn(msg);
      return { installed: false, skipped: true, failed: false, destDir: dest, message: msg };
    }
    const srcHash = hashDir(src);
    if (fs.existsSync(dest)) {
      let destHash: string | null = null;
      try {
        destHash = hashDir(dest);
      } catch {
        /* 读不了目标就当不一致 */
      }
      if (destHash === srcHash) {
        const msg = `技能已安装且内容一致，跳过（${dest}）。`;
        logger.info(msg);
        return { installed: false, skipped: true, failed: false, destDir: dest, message: msg };
      }
      // 备份旧版
      const bak = `${dest}.bak-${Date.now()}`;
      try {
        fs.renameSync(dest, bak);
        logger.info(`技能旧版已备份到 ${bak}`);
      } catch {
        /* 备份失败继续覆盖 */
      }
    }
    await mkdirp(path.dirname(dest));
    copyDir(src, dest);
    const msg = `技能已安装到 ${dest}（新会话生效，无热加载）。`;
    logger.info(msg);
    return { installed: true, skipped: false, failed: false, destDir: dest, message: msg };
  } catch (e) {
    const msg = `技能自检安装失败（仅告警，不影响 MCP 工具面）：${e instanceof Error ? e.message : String(e)}`;
    logger.warn(msg);
    return { installed: false, skipped: false, failed: true, destDir: dest, message: msg };
  }
}
