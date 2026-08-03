#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import process from 'process'

// ─── Domain Utilities ─────────────────────────────────────────────────────────

function cleanDomainCandidate(raw) {
  // 规避上游未知原因意外引入的规则, 导致部分服务无法正常使用
  const whiteList = [
    'kurogame.xyz', // 库洛游戏(鸣潮)
  ]
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  // remove protocol
  s = s.replace(/^[a-zA-Z]+:\/\//, '')
  // remove path, query, fragment
  s = s.split(/[\/\?#]/, 1)[0]
  // remove port
  s = s.replace(/:\d+$/, '')
  // remove leading wildcards or dots
  s = s.replace(/^\*+\.*/, '').replace(/^\.+/, '')
  s = s.toLowerCase()
  // reject obvious invalids
  if (/[\/\s@]/.test(s)) return null
  if (/^\d+$/.test(s)) return null
  if (!s.includes('.')) return null
  if (!/^[a-z0-9\.\-]+$/.test(s)) return null
  s = s.replace(/(^[\.-]+)|([\.-]+$)/g, '')
  if (!s) return null
  if (whiteList.some((w) => s === w || s.includes(w))) return null
  return s
}

// ─── HTTP Utilities ───────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`)
  return res.json()
}

async function fetchText(url) {
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status} ${res.statusText}`)
  return res.text()
}

// ─── CIDR Utilities ───────────────────────────────────────────────────────────

function buildCIDRLines(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return null
      // 如果已经包含 no-resolve，则不重复添加
      if (trimmed.includes('no-resolve')) return trimmed
      return `${trimmed},no-resolve`
    })
    .filter(Boolean)
}

function writeCIDRFile(outputPath, url, lines) {
  const header = [
    '# Converted CIDR rules with no-resolve',
    `# Source: ${url}`,
    `# Rules: ${lines.length}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ]
  fs.mkdirSync(path.dirname(outputPath) || '.', { recursive: true })
  fs.writeFileSync(outputPath, header.concat(lines).join('\n') + '\n', { encoding: 'utf8' })
}

async function fetchAndWriteCIDR(url, outputFile, label) {
  console.error(`[INFO] fetching ${label} rules from`, url)
  const text = await fetchText(url)
  const lines = buildCIDRLines(text)
  const outputPath = path.resolve(process.cwd(), outputFile)
  writeCIDRFile(outputPath, url, lines)
  console.error(`[INFO] wrote ${lines.length} ${label} rules to ${outputFile}`)
}

// ─── Fetch & Write Tasks ──────────────────────────────────────────────────────

async function fetchAndConvertCIDR() {
  await fetchAndWriteCIDR(
    'https://raw.githubusercontent.com/Loyalsoldier/surge-rules/release/ruleset/cncidr.txt',
    'ip.txt',
    'CIDR',
  )
}

async function fetchAndConvertCIDROfTG() {
  const url = 'https://raw.githubusercontent.com/Loyalsoldier/surge-rules/release/telegramcidr.txt'
  console.error('[INFO] fetching TG CIDR rules from', url)
  const text = await fetchText(url)
  return buildCIDRLines(text)
}

async function fetchAndWritePCDN() {
  const url =
    'https://github.com/Yuu518/sing-box-rules/raw/refs/heads/rule_set/rule_set_site/pcdn-cn.json'
  console.error('[INFO] fetching PCDN rules from', url)

  const json = await fetchJson(url)
  if (!json || typeof json !== 'object') throw new Error('Invalid JSON response')

  const rules = json.rules
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('rules is not an array or empty')

  const domainSuffixes = rules[0].domain_suffix
  if (!Array.isArray(domainSuffixes)) throw new Error('rules[0].domain_suffix is not an array')

  const pcdnRules = domainSuffixes
    .filter((s) => typeof s === 'string')
    .map((s) => cleanDomainCandidate(s))
    .filter(Boolean)
    .map((s) => `DOMAIN-SUFFIX,${s}`)

  const header = [
    '# Converted PCDN rules',
    `# Source: PCDN-CN`,
    `# Rules: ${pcdnRules.length}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ]
  const outputPath = path.resolve(process.cwd(), 'pcdn.txt')
  fs.writeFileSync(outputPath, header.concat(pcdnRules).join('\n') + '\n', { encoding: 'utf8' })

  console.error(`[INFO] wrote ${pcdnRules.length} PCDN rules to pcdn.txt`)
}

// ─── Rule Processing ──────────────────────────────────────────────────────────

function extractRules(rules) {
  const domainMap = new Map()
  const domainSuffixMap = new Map()
  const domainKeywordSet = new Set()
  let countDomain = 0,
    countDomainSuffix = 0,
    countKeyword = 0

  for (const ruleObj of rules) {
    if (!ruleObj || typeof ruleObj !== 'object') continue

    if (Array.isArray(ruleObj.domain)) {
      for (const item of ruleObj.domain) {
        const s = typeof item === 'string' ? cleanDomainCandidate(item) : null
        if (s) {
          domainMap.set(s, true)
          countDomain++
        }
      }
    }

    if (Array.isArray(ruleObj.domain_suffix)) {
      for (const item of ruleObj.domain_suffix) {
        const s = typeof item === 'string' ? cleanDomainCandidate(item) : null
        if (s) {
          domainSuffixMap.set(s, true)
          countDomainSuffix++
        }
      }
    }

    if (Array.isArray(ruleObj.domain_keyword)) {
      for (const item of ruleObj.domain_keyword) {
        const s = typeof item === 'string' ? cleanDomainCandidate(item) : null
        if (s) {
          domainKeywordSet.add(s)
          countKeyword++
        }
      }
    }
  }

  return {
    domainMap,
    domainSuffixMap,
    domainKeywordSet,
    counts: { domain: countDomain, suffix: countDomainSuffix, keyword: countKeyword },
  }
}

function mergeRules(domainMap, domainSuffixMap, domainKeywordSet) {
  const outSet = new Set()
  // 合并规则：如果同时存在 DOMAIN 和 DOMAIN-SUFFIX，只保留 DOMAIN-SUFFIX
  for (const domain of domainSuffixMap.keys()) outSet.add(`DOMAIN-SUFFIX,${domain}`)
  for (const domain of domainMap.keys()) {
    if (!domainSuffixMap.has(domain)) outSet.add(`DOMAIN,${domain}`)
  }
  for (const keyword of domainKeywordSet) outSet.add(`DOMAIN-KEYWORD,${keyword}`)
  return Array.from(outSet).sort((a, b) => a.localeCompare(b))
}

function processRules(rules) {
  const { domainMap, domainSuffixMap, domainKeywordSet, counts } = extractRules(rules)
  const lines = mergeRules(domainMap, domainSuffixMap, domainKeywordSet)
  return { lines, counts }
}

// ─── Fetch & Write Tasks (continued) ─────────────────────────────────────────

async function fetchAndWriteAdsRules() {
  const url =
    'https://raw.githubusercontent.com/Yuu518/sing-box-rules/rule_set/rule_set_site/category-ads-all.json'
  const outputFile = 'reject.txt'
  console.error('[INFO] fetching ads rules from', url)

  const json = await fetchJson(url)
  if (!json || typeof json !== 'object') throw new Error('fetched JSON is not an object')
  if (!Array.isArray(json.rules)) throw new Error('JSON.rules is not an array or missing')

  const { lines } = processRules(json.rules)

  const header = [
    '# Converted by scripts/convert_to_loon_no_action.js',
    `# Source: ${url}`,
    `# Rules: ${lines.length}`,
    '# Format: TYPE,CONTENT (no action column)',
    '',
  ]
  const outPath = path.resolve(process.cwd(), outputFile)
  fs.mkdirSync(path.dirname(outPath) || '.', { recursive: true })
  fs.writeFileSync(outPath, header.concat(lines).join('\n') + '\n', { encoding: 'utf8' })

  console.error(`[INFO] wrote ${lines.length} ads rules to ${outputFile}`)
}

function writeProxyIP(lines) {
  const outputPath = path.resolve(process.cwd(), 'proxy_ip.txt')
  const header = [
    '# Proxy IP rules',
    `# Rules: ${lines.length}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ]
  fs.mkdirSync(path.dirname(outputPath) || '.', { recursive: true })
  fs.writeFileSync(outputPath, header.concat(lines).join('\n') + '\n', { encoding: 'utf8' })
  console.error(`[INFO] wrote ${lines.length} proxy IP rules to proxy_ip.txt`)
}

async function runSafely(label, fn) {
  try {
    await fn()
  } catch (err) {
    console.error(`[WARN] ${label} failed:`, err.message || err)
  }
}

async function main() {
  await runSafely('CIDR conversion', fetchAndConvertCIDR)
  await runSafely('proxy IP conversion', async () => {
    const tgLines = await fetchAndConvertCIDROfTG()
    writeProxyIP([...tgLines])
  })
  await runSafely('PCDN conversion', fetchAndWritePCDN)
  // await runSafely('Ads rules conversion', fetchAndWriteAdsRules)
}

main().catch((err) => {
  console.error('[ERROR]', err)
  process.exit(2)
})
