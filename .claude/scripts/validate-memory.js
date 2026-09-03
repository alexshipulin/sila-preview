#!/usr/bin/env node
// Механическая защита памяти проекта memory/
// Без внешних зависимостей: только fs, path, child_process.
// ERROR -> exit 1, WARN -> exit 0. Итог: "Memory validation: OK | N errors, M warnings".
// --quiet: на старте сессии показываем только ошибки, чтобы не шуметь предупреждениями.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const QUIET = process.argv.includes('--quiet');

const ROOT = path.resolve(__dirname, '..', '..'); // корень проекта (родитель .claude)
const MEM = path.join(ROOT, 'memory');            // память вынесена из .claude/ (у конфиг-каталога особая защита)
const DECISIONS = path.join(MEM, 'decisions');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// Репозитории, где могут жить коммиты/файлы из evidence:
// корень + все подпапки первого уровня со своим .git (на случай монорепо).
const REPOS = ['.'];
try {
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(ROOT, e.name, '.git'))) {
      REPOS.push(e.name);
    }
  }
} catch { /* корень нечитаем — останемся с '.' */ }

// ---------- утилиты ----------
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function countLines(content) {
  if (!content) return 0;
  const arr = content.split('\n');
  if (arr[arr.length - 1] === '') arr.pop();
  return arr.length;
}
function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
function rel(p) { return path.relative(ROOT, p); }

// ---------- 0. базовая проверка ----------
if (!fs.existsSync(MEM)) {
  err(`каталог памяти не найден: ${rel(MEM)}`);
  report();
}

// ---------- 1. лимиты строк ----------
const LIMITS = {
  'index.md': 60,
  'state.md': 100,
  'project.md': 80,
  'architecture.md': 120,
  'risks.md': 60,
};
for (const [name, limit] of Object.entries(LIMITS)) {
  const p = path.join(MEM, name);
  const c = read(p);
  if (c === null) continue; // отсутствие файла лимитом не считаем
  const n = countLines(c);
  if (n > limit) err(`${name}: ${n} строк > лимита ${limit}`);
}

// ---------- 2. ADR ----------
const VALID_STATUS = /^(accepted|disputed|expired|superseded-by-\d+)$/;
const adrFiles = fs.existsSync(DECISIONS)
  ? fs.readdirSync(DECISIONS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  : [];

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (mm) fm[mm[1].trim()] = mm[2].trim();
  }
  return fm;
}

const adrIds = new Set();
const adrParsed = [];
for (const f of adrFiles) {
  const p = path.join(DECISIONS, f);
  const c = read(p);
  if (c === null) continue;
  const n = countLines(c);
  if (n > 30) err(`decisions/${f}: ${n} строк > лимита 30`);
  const fm = parseFrontmatter(c);
  if (!fm) { err(`decisions/${f}: нет frontmatter (--- ... ---)`); continue; }
  for (const field of ['id', 'title', 'date', 'status', 'evidence']) {
    if (!fm[field] || fm[field] === '') err(`decisions/${f}: нет обязательного поля "${field}"`);
  }
  if (fm.id && /^\d+$/.test(fm.id)) adrIds.add(fm.id);
  adrParsed.push({ f, fm });
}
for (const { f, fm } of adrParsed) {
  if (fm.status && !VALID_STATUS.test(fm.status)) {
    err(`decisions/${f}: недопустимый status "${fm.status}"`);
  }
  const sup = fm.status && fm.status.match(/^superseded-by-(\d+)$/);
  if (sup && !adrIds.has(sup[1])) {
    err(`decisions/${f}: status ссылается на несуществующий ADR id=${sup[1]}`);
  }
}

// ---------- 3. секреты во всех файлах памяти ----------
const SECRETS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'api-key/secret/password/token literal', re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}/i },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: 'mongodb connection string', re: /mongodb(\+srv)?:\/\/[^\s]+:[^\s]+@/ },
  { name: 'postgres connection string', re: /postgres(ql)?:\/\/[^\s]+:[^\s]+@/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe secret key', re: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
];
for (const file of walk(MEM)) {
  if (!file.endsWith('.md')) continue;
  const c = read(file);
  if (c === null) continue;
  for (const s of SECRETS) {
    if (s.re.test(c)) err(`секрет (${s.name}) в файле памяти: ${rel(file)}`);
  }
}

// ---------- 4. index.md: ссылки на файлы памяти ----------
const indexPath = path.join(MEM, 'index.md');
const indexContent = read(indexPath);

function findByBasename(base) {
  return walk(MEM).some((f) => path.basename(f) === base);
}
if (indexContent !== null) {
  const mdRefs = indexContent.match(/[A-Za-z0-9_./-]+\.md/g) || [];
  const seen = new Set();
  for (const ref of mdRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const ok = ref.includes('/') ? fs.existsSync(path.join(MEM, ref)) : findByBasename(ref);
    if (!ok) err(`index.md: ссылка на несуществующий файл памяти "${ref}"`);
  }
  const dirRefs = indexContent.match(/\b([A-Za-z0-9_-]+)\//g) || [];
  const seenDir = new Set();
  for (const d of dirRefs) {
    const name = d.replace(/\/$/, '');
    if (seenDir.has(name)) continue;
    seenDir.add(name);
    if (['decisions', 'plans', 'journal'].includes(name) && !fs.existsSync(path.join(MEM, name))) {
      err(`index.md: ссылка на несуществующий каталог памяти "${name}/"`);
    }
  }
}

// ---------- 5. WARN: файл памяти есть, но не в index.md ----------
if (indexContent !== null) {
  const topMd = fs.readdirSync(MEM).filter((f) => f.endsWith('.md') && f !== 'index.md');
  for (const f of topMd) {
    if (!indexContent.includes(f)) warn(`файл памяти "${f}" не упомянут в index.md`);
  }
}

// ---------- 6. WARN: evidence -> несуществующий файл/коммит ----------
function fileExistsAcrossRepos(candidate) {
  return REPOS.some((r) => fs.existsSync(path.join(ROOT, r, candidate)));
}
function commitExists(hash) {
  return REPOS.some((r) => {
    try {
      execFileSync('git', ['-C', path.join(ROOT, r), 'cat-file', '-e', hash], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  });
}
function checkEvidence(value, where) {
  for (const raw of value.split(',')) {
    let tok = raw.trim().replace(/\([^)]*\)/g, '').trim();
    if (!tok) continue;
    for (const w0 of tok.split(/\s+/)) {
      const w = w0.replace(/[.,;)]+$/, '').replace(/^[(]+/, '');
      if (!w) continue;
      if (/^[0-9a-f]{7,40}$/.test(w) && !/^\d+$/.test(w)) {
        if (!commitExists(w)) warn(`${where}: evidence-коммит не найден в git: ${w}`);
        continue;
      }
      if (/\//.test(w) && /\.[A-Za-z0-9]+$/.test(w)) {
        if (!fileExistsAcrossRepos(w)) warn(`${where}: evidence-путь не найден: ${w}`);
      }
    }
  }
}
const EVIDENCE_FILES = ['project.md', 'architecture.md', 'state.md', 'risks.md'];
for (const name of EVIDENCE_FILES) {
  const c = read(path.join(MEM, name));
  if (c === null) continue;
  for (const line of c.split('\n')) {
    const idx = line.toLowerCase().indexOf('evidence:');
    if (idx === -1) continue;
    checkEvidence(line.slice(idx + 'evidence:'.length), name);
  }
}
for (const { f, fm } of adrParsed) {
  if (fm.evidence) checkEvidence(fm.evidence, `decisions/${f}`);
}

// ---------- 7. WARN: state.md updated старше 14 дней ----------
const stateContent = read(path.join(MEM, 'state.md'));
if (stateContent !== null) {
  const m = stateContent.match(/updated:\s*(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const days = (new Date() - new Date(m[1] + 'T00:00:00Z')) / 86400000;
    if (days > 14) warn(`state.md: поле updated (${m[1]}) старше 14 дней (${Math.floor(days)} дн.)`);
  }
}

// ---------- 8. WARN: product-ADR с истёкшим ttl ----------
const todayStr = new Date().toISOString().slice(0, 10);
for (const { f, fm } of adrParsed) {
  if (fm.type === 'product' && fm.status === 'accepted' && fm.ttl && /^\d{4}-\d{2}-\d{2}$/.test(fm.ttl)) {
    if (fm.ttl < todayStr) warn(`decisions/${f}: product-ADR со статусом accepted, но ttl (${fm.ttl}) истёк`);
  }
}

// ---------- 9. WARN: unverified в канонических файлах ----------
const CANON = ['project.md', 'architecture.md', 'state.md', 'risks.md'];
for (const name of CANON) {
  const c = read(path.join(MEM, name));
  if (c !== null && /unverified/i.test(c)) warn(`${name}: содержит пометку unverified`);
}
for (const { f } of adrParsed) {
  const c = read(path.join(DECISIONS, f));
  if (c !== null && /unverified/i.test(c)) warn(`decisions/${f}: содержит пометку unverified`);
}

// ---------- вывод ----------
function report() {
  for (const e of errors) console.log(`[ERROR] ${e}`);
  if (!QUIET || errors.length > 0) {
    for (const w of warnings) console.log(`[WARN] ${w}`);
  }
  const status = errors.length === 0 ? 'OK' : 'FAILED';
  console.log(`Memory validation: ${status} | ${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length > 0) {
    console.log('ДЕЙСТВИЕ: память проекта повреждена. Исправь перечисленные [ERROR] в memory/ ДО начала работы над задачей пользователя.');
  }
  process.exit(errors.length > 0 ? 1 : 0);
}
report();
