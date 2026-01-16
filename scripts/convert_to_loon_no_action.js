#!/usr/bin/env node
/**
 * 简洁版：使用全��� fetch 拉取 JSON 并输出 Loon 格式 TYPE,CONTENT 到指定文件（默认 reject.list）
 * 用法:
 *   node scripts/convert_to_loon_no_action.js --url <JSON_URL> --output <OUTPUT_FILE> [--verbose]
 *
 * 要求 Node >= 18（GitHub Actions 中请设置 node-version: '18' 或更高）
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

const RE_IP_CIDR = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/;
const RE_IP_RANGE = /^\d{1,3}(?:\.\d{1,3}){3}-\d{1,3}(?:\.\d{1,3}){3}$/;
const RE_DOMAIN = /^(?:\*\.?){0,1}([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,63}$/;
const RE_ADBLOCK_PREFIX = /^\|\|([^\/\^]+)\^?$/; // ||domain^
const RE_COMMENT = /^\s*(!|#)/;

function flattenJson(obj) {
  const items = [];
  if (obj === null || obj === undefined) return items;
  if (Array.isArray(obj)) {
    for (const e of obj) items.push(...flattenJson(e));
  } else if (typeof obj === "object") {
    const ruleKeys = new Set(["rule", "type", "value", "payload", "pattern", "domain", "content", "host"]);
    const keys = Object.keys(obj);
    if (keys.some(k => ruleKeys.has(k)) && keys.length <= 30) {
      items.push(obj);
    } else {
      for (const v of Object.values(obj)) items.push(...flattenJson(v));
    }
  } else {
    items.push(String(obj));
  }
  return items;
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toLoonLines(entry) {
  const lines = [];
  if (typeof entry === "string") {
    let s = entry.trim();
    if (!s) return lines;
    if (RE_COMMENT.test(s)) return lines;
    const m = s.match(RE_ADBLOCK_PREFIX);
    if (m) {
      const domain = m[1].trim().replace(/^\.+/, "");
      if (domain) lines.push(`DOMAIN-SUFFIX,${domain}`);
      return lines;
    }
    if (/[*\^\/\?\$\+\(\)\[\]\{\}\|]/.test(s)) {
      let pattern = s;
      if (pattern.startsWith("||")) {
        pattern = pattern.slice(2);
        pattern = escapeForRegex(pattern).replace(/\\\*/g, ".*").replace(/\\\^/g, "");
        const regex = `.*${pattern}.*`;
        lines.push(`REGEX,${regex}`);
      } else {
        const regex = escapeForRegex(pattern).replace(/\\\*/g, ".*");
        lines.push(`REGEX,${regex}`);
      }
      return lines;
    }
    if (RE_IP_CIDR.test(s)) {
      lines.push(`IP-CIDR,${s}`);
      return lines;
    }
    if (RE_IP_RANGE.test(s)) {
      lines.push(`REGEX,^${escapeForRegex(s)}$`);
      return lines;
    }
    if (s.startsWith(".")) {
      const domain = s.replace(/^\.+/, "");
      lines.push(`DOMAIN-SUFFIX,${domain}`);
      return lines;
    }
    const s_no_star = s.replace(/^[\*\.]+/, "");
    if (RE_DOMAIN.test(s_no_star)) {
      lines.push(`DOMAIN-SUFFIX,${s_no_star}`);
      return lines;
    }
    lines.push(`REGEX,${escapeForRegex(s)}`);
    return lines;
  } else if (typeof entry === "object" && entry !== null) {
    let v = null;
    const preferKeys = ["payload", "value", "content", "pattern", "domain", "host", "rule"];
    for (const k of preferKeys) { if (k in entry) { v = entry[k]; break; } }
    let t = null;
    for (const k of ["type", "rule_type", "kind"]) { if (k in entry) { t = String(entry[k]).toLowerCase(); break; } }
    if (v === null) {
      for (const k of ["domain", "host", "pattern", "rule"]) { if (k in entry) { v = entry[k]; break; } }
    }
    if (v === null) {
      lines.push(`REGEX,${escapeForRegex(JSON.stringify(entry, null, ""))}`);
      return lines;
    }
    if (Array.isArray(v)) {
      for (const e of v) lines.push(...toLoonLines(e));
      return lines;
    }
    const s = String(v).trim();
    if (!s) return lines;
    if (t) {
      if (t.includes("domain") && (t.includes("suffix") || t === "suffix" || t.includes("domain-suffix"))) {
        lines.push(`DOMAIN-SUFFIX,${s}`);
        return lines;
      }
      if (t.includes("domain") && (t.includes("keyword") || t.includes("key"))) {
        lines.push(`DOMAIN-KEYWORD,${s}`);
        return lines;
      }
      if (t.includes("domain")) {
        lines.push(`DOMAIN-SUFFIX,${s}`);
        return lines;
      }
      if (t.includes("ip") || t.includes("cidr")) {
        lines.push(`IP-CIDR,${s}`);
        return lines;
      }
      if (t.includes("regex") || t.includes("re")) {
        lines.push(`REGEX,${s}`);
        return lines;
      }
    }
    return toLoonLines(s);
  }
  return lines;
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const opt = parseArgs();
  if (opt.verbose) console.error(`[INFO] fetching ${opt.url}`);
  const jsonObj = await fetchJson(opt.url);
  if (opt.verbose) console.error("[INFO] flattening and converting...");
  const flat = flattenJson(jsonObj);
  if (opt.verbose) console.error(`[INFO] found ${flat.length} raw entries`);
  const seen = new Set();
  const out = [];
  for (const e of flat) {
    try {
      const lines = toLoonLines(e);
      for (const ln of lines) {
        if (!seen.has(ln)) { seen.add(ln); out.push(ln); }
      }
    } catch (err) {
      if (opt.verbose) console.error("[WARN] skip entry:", err);
    }
  }
  const header = [
    "# Converted by scripts/convert_to_loon_no_action.js",
    `# Source: ${opt.url}`,
    `# Rules: ${out.length}`,
    "# Format: TYPE,CONTENT (no action column)",
    ""
  ];
  const content = header.concat(out).join("\n") + "\n";
  const outPath = path.resolve(process.cwd(), opt.output);
  fs.mkdirSync(path.dirname(outPath) || ".", { recursive: true });
  fs.writeFileSync(outPath, content, { encoding: "utf8" });
  if (opt.verbose) console.error(`[INFO] wrote ${out.length} rules to ${opt.output}`);
}

// 直接执行主函数（作为 CLI 脚本）
if (import.meta.url) {
  main().catch(err => { console.error("[ERROR]", err); process.exit(2); });
}
