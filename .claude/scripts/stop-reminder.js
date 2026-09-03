#!/usr/bin/env node
// Stop-хук: два напоминания перед завершением ответа.
//   1) журнал памяти — не чаще одного раза за сессию (маркер по session_id);
//   2) незакоммиченные правки в репозитории — КАЖДЫЙ раз, пока они есть
//      (это страховка правила «автокоммит после крупной задачи» из CLAUDE.md).
// Единственный надёжный способ доставить текст агенту на Stop — decision: "block".
// От зацикливания защищает stop_hook_active: внутри одной цепочки Stop не блокируем повторно.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_SLUG = 'sila';
const ROOT = path.resolve(__dirname, '..', '..');
const REPOS = ['.']; // Sila — один репозиторий; массив оставлен на случай подпроектов

// Незакоммиченное в репозитории: 'M file' / '?? dir'. Пустая строка — чисто.
function dirtyFiles(repo) {
  const dir = path.join(ROOT, repo);
  if (!fs.existsSync(path.join(dir, '.git'))) { return []; }
  try {
    const out = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return []; // git недоступен/сломан — молчим, хук не должен мешать работе
  }
}

function gitReminder() {
  const parts = [];
  for (const repo of REPOS) {
    const files = dirtyFiles(repo);
    if (!files.length) { continue; }
    const shown = files.slice(0, 8).join(', ');
    const tail = files.length > 8 ? ` и ещё ${files.length - 8}` : '';
    parts.push(`${repo === '.' ? 'корень' : repo}: ${shown}${tail}`);
  }
  if (!parts.length) { return null; }
  return (
    'НЕЗАКОММИЧЕНО (правило автокоммита из CLAUDE.md) — ' + parts.join(' | ') + '. ' +
    'Закоммить осмысленным сообщением в текущую ветку без запроса подтверждения. ' +
    'Если файл коммитить не нужно — добавь его в .gitignore. После этого можешь завершать.'
  );
}

let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(data || '{}'); } catch { process.exit(0); } // нет валидного stdin — не блокируем

  if (input.stop_hook_active) { process.exit(0); } // уже напоминали в этой цепочке — даём остановиться

  const reasons = [];

  // Напоминание про коммит — каждый раз, пока в репозитории есть незакоммиченное.
  const git = gitReminder();
  if (git) { reasons.push(git); }

  // Напоминание про журнал памяти — один раз за сессию (маркер во временной папке).
  const sid = input.session_id;
  let memoryDone = false;
  if (sid) {
    const safe = String(sid).replace(/[^\w-]/g, '');
    const marker = path.join(os.tmpdir(), `${PROJECT_SLUG}-stop-reminded-${safe}`);
    try {
      if (fs.existsSync(marker)) { memoryDone = true; } // в этой сессии уже напоминали
      else { fs.writeFileSync(marker, '1'); }
    } catch { /* не смогли записать маркер — не критично, напомним */ }
  }
  if (!memoryDone) {
    reasons.push(
      'Проверь: все ли решения/задачи/риски этой сессии записаны в журнал памяти ' +
      '(memory/journal/<YYYY-MM-DD>-<id>.md). Если что-то не записано — запиши сейчас, ' +
      'затем можешь завершать.'
    );
  }

  if (!reasons.length) { process.exit(0); } // всё чисто и про память уже напомнили

  process.stdout.write(JSON.stringify({ decision: 'block', reason: reasons.join('\n\n') }));
  process.exit(0);
});
