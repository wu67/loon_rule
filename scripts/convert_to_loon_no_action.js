#!/usr/bin/env node
/**
 * scripts/convert_to_loon_no_action.js
 *
 * 仅解析 JSON 的 rules 数组中每个对象的三个数组属性：
 *   - domain
 *   - domain_suffix
 *   - domain_keyword
 *
 * 并把它们转换为 Loon 格式的规则（TYPE,CONTENT）写入输出文件（默认 reject.list）。
 *
 * 用法:
 *   node scripts/convert_to_loon_no_action.js --url <JSON_URL> --output <OUTPUT_FILE> [--verbose]
 *
 * 要求: Node >= 18（使用全局 fetch）
 */
import fs from "fs";
import path from "path";
import process from "process";

const DEFAULT_URL = "https://raw.githubusercontent.com/Yuu518/sing-box-rules/rule_set/rule_set_site/category-ads-all.json";
const DEFAULT_OUTPUT = "reject.list";

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = { url: DEFAULT_URL, output: DEFAULT_OUTPUT, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--url" || a === "-u") { opt.url = args[++i]; continue; }
    if (a === "--output" || a === "-o") { opt.output = args[++i]; continue; }
    if (a === "--verbose" || a === "-v") { opt.verbose = true; continue; }
    if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/convert_to_loon_no_action.js --url <JSON_URL> --output <OUTPUT_FILE>");
      process.exit(0);
    }
  }
  return opt;
}

function cleanDomainCandidate(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  // remove protocol
  s = s.replace(/^[a-zA-Z]+:\/\//, "");
  // remove path, query, fragment
  s = s.split(/[\/\?#]/, 1)[0];
  // remove port
  s = s.replace(/:\d+$/, "");
  // remove leading wildcards or dots
  s = s.replace(/^\*+\.*/, "").replace(/^\.+/, "");
  s = s.toLowerCase();
  // reject obvious invalids
  if (/[\/\s@]/.test(s)) return null;
  if (/^\d+$/.test(s)) return null;
  if (!s.includes(".")) return null;
  if (!/^[a-z0-9\.\-]+$/.test(s)) return null;
  s = s.replace(/(^[\.-]+)|([\.-]+$)/g, "");
  if (!s) return null;
  return s;
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const opt = parseArgs();
  if (opt.verbose) console.error(`[INFO] fetching ${opt.url}`);
  let j;
  try {
    j = await fetchJson(opt.url);
  } catch (err) {
    console.error("[ERROR] fetch JSON failed:", err.message || err);
    process.exit(2);
  }

  if (!j || typeof j !== "object") {
    console.error("[ERROR] fetched JSON is not an object");
    process.exit(2);
  }

  const rules = j.rules;
  if (!Array.isArray(rules)) {
    console.error("[ERROR] JSON.rules is not an array or missing");
    // 为兼容性：写 header-only 并退出 0（或根据需要改为非0）
    const headerOnly = [
      "# Converted by scripts/convert_to_loon_no_action.js",
      `# Source: ${opt.url}`,
      `# Rules: 0`,
      "# Format: TYPE,CONTENT (no action column)",
      ""
    ].join("\n") + "\n";
    const outPath0 = path.resolve(process.cwd(), opt.output);
    fs.mkdirSync(path.dirname(outPath0) || ".", { recursive: true });
    fs.writeFileSync(outPath0, headerOnly, { encoding: "utf8" });
    console.error("[INFO] wrote header-only output file because rules is missing or not an array");
    return;
  }

  const outSet = new Set();
  let countDomain = 0, countDomainSuffix = 0, countKeyword = 0;

  for (const ruleObj of rules) {
    if (!ruleObj || typeof ruleObj !== "object") continue;

    const dom = ruleObj.domain;
    if (Array.isArray(dom)) {
      for (const item of dom) {
        if (typeof item !== "string") continue;
        const s = cleanDomainCandidate(item);
        if (!s) continue;
        outSet.add(`DOMAIN-SUFFIX,${s}`);
        countDomain++;
      }
    }

    const domsuf = ruleObj.domain_suffix;
    if (Array.isArray(domsuf)) {
      for (const item of domsuf) {
        if (typeof item !== "string") continue;
        const s = cleanDomainCandidate(item);
        if (!s) continue;
        outSet.add(`DOMAIN-SUFFIX,${s}`);
        countDomainSuffix++;
      }
    }

    const dkeyword = ruleObj.domain_keyword;
    if (Array.isArray(dkeyword)) {
      for (const item of dkeyword) {
        if (typeof item !== "string") continue;
        const s = cleanDomainCandidate(item);
        if (!s) continue;
        outSet.add(`DOMAIN-KEYWORD,${s}`);
        countKeyword++;
      }
    }
  }

  const lines = Array.from(outSet).sort((a,b) => a.localeCompare(b));
  if (opt.verbose) {
    console.error(`[INFO] extracted raw counts -> domain: ${countDomain}, domain_suffix: ${countDomainSuffix}, domain_keyword: ${countKeyword}`);
    console.error(`[INFO] unique rules after dedupe: ${lines.length}`);
  }

  const header = [
    "# Converted by scripts/convert_to_loon_no_action.js",
    `# Source: ${opt.url}`,
    `# Rules: ${lines.length}`,
    "# Format: TYPE,CONTENT (no action column)",
    ""
  ];
  const outText = header.concat(lines).join("\n") + "\n";
  const outPath = path.resolve(process.cwd(), opt.output);
  fs.mkdirSync(path.dirname(outPath) || ".", { recursive: true });
  fs.writeFileSync(outPath, outText, { encoding: "utf8" });

  if (opt.verbose) console.error(`[INFO] wrote ${lines.length} rules to ${opt.output}`);
}

main().catch(err => { console.error("[ERROR]", err); process.exit(2); });
