#!/usr/bin/env node
/**
 * 组合发布正文（GitHub 发行版）。
 *
 * 目的：把每个版本的双语发布说明文档（docs/release-v<版本>.md 与 .en.md）合成为发行版正文，并：
 *   1) 把文档里的**相对链接**改写为指向该 tag 的**绝对链接**（否则 Release 页上会 404）；
 *   2) 末尾追加 npm 包链接、CI 链接（可选）与 Full Changelog 比较链接。
 *
 * 用法（CLI）：
 *   node scripts/release-body.mjs <version> [ownerRepo] [npmPackage] [ciRunId] [previousVersion]
 *   例：node scripts/release-body.mjs 1.0.0 lanlan0811/agent-foreman-mcp agent-foreman-mcp 34661265199 ""
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");

/** 站点域名（本项目仅发布到 GitHub；保留函数以便未来扩展） */
export function hostDomain() {
  return "github.com";
}

/**
 * 把文档中的相对 markdown 链接改写为该 tag 的绝对链接。
 * 仅改写形如 `](name.md)` / `](name.en.md)` 的文档内相对链接；已是 http(s) 的保持原样。
 * @param {string} text
 * @param {{ownerRepo: string, tag: string}} ctx
 */
export function absolutizeDocLinks(text, { ownerRepo, tag }) {
  const base = `https://${hostDomain()}/${ownerRepo}/blob/${tag}/docs/`;
  return text.replace(/\]\((?!https?:\/\/)([^)\s]+\.md)(#[^)]*)?\)/g, (_m, file, anchor) => {
    return `](${base}${file}${anchor ?? ""})`;
  });
}

/**
 * 读取发布说明文档；缺失时返回 null。
 * @param {string} version
 * @param {"zh"|"en"} lang
 */
export function readReleaseDoc(version, lang) {
  const suffix = lang === "en" ? ".en.md" : ".md";
  const p = path.join(repoRoot, "docs", `release-v${version}${suffix}`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
}

/**
 * @typedef {Object} ComposeOptions
 * @property {string} version
 * @property {string} ownerRepo   形如 lanlan0811/agent-foreman-mcp
 * @property {string} [npmPackage]
 * @property {string|number} [ciRunId]
 * @property {string} [previousVersion]  用于 Full Changelog 的上一版本 tag（不含 v）
 */

/**
 * 合成双语发布正文。
 * @param {ComposeOptions} opts
 * @returns {string}
 */
export function composeReleaseBody(opts) {
  const version = String(opts.version).replace(/^v/, "");
  const tag = `v${version}`;
  const { ownerRepo } = opts;
  const npmPackage = opts.npmPackage ?? "agent-foreman-mcp";

  const zh = readReleaseDoc(version, "zh");
  const en = readReleaseDoc(version, "en");
  if (!zh && !en) {
    throw new Error(
      `未找到发布说明文档 docs/release-v${version}.md / .en.md；请先写好发布说明再发布。`,
    );
  }

  /** @type {string[]} */
  const parts = [];
  if (zh) parts.push(absolutizeDocLinks(zh, { ownerRepo, tag }));
  if (en) {
    parts.push("---");
    parts.push(absolutizeDocLinks(en, { ownerRepo, tag }));
  }

  /** @type {string[]} */
  const footer = ["---", ""];
  // A GitHub release does not imply that its version was published to npm.
  footer.push(`**npm registry**: https://www.npmjs.com/package/${npmPackage}`);
  if (opts.ciRunId) footer.push(`**CI**: https://github.com/${ownerRepo}/actions/runs/${opts.ciRunId}`);
  const prev = opts.previousVersion ? `v${String(opts.previousVersion).replace(/^v/, "")}` : "";
  footer.push(
    prev
      ? `**Full Changelog**: https://github.com/${ownerRepo}/compare/${prev}...${tag}`
      : `**Full Changelog**: https://github.com/${ownerRepo}/commits/${tag}`,
  );
  parts.push(footer.join("\n"));

  return parts.join("\n\n").trimEnd() + "\n";
}

// CLI 入口（跨平台判断：比较解析后的文件路径）
const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const [, , version, ownerRepo, npmPackage, ciRunId, previousVersion] = process.argv;
  if (!version) {
    console.error(
      "用法: node scripts/release-body.mjs <version> [ownerRepo] [npmPackage] [ciRunId] [previousVersion]",
    );
    process.exit(2);
  }
  const repo = ownerRepo || "lanlan0811/agent-foreman-mcp";
  try {
    process.stdout.write(
      composeReleaseBody({
        version,
        ownerRepo: repo,
        npmPackage: npmPackage || "agent-foreman-mcp",
        ciRunId: ciRunId || undefined,
        previousVersion: previousVersion || undefined,
      }),
    );
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
