#!/usr/bin/env node
// SessionStart: подкладывает короткую карту памяти в контекст агента.
// Полный state.md агент читает сам по CLAUDE.md; хук не должен раздувать старт
// и создавать ощущение, что Claude "молчит" до первого ответа.
'use strict';

const fs = require('fs');
const path = require('path');

const MEM = path.resolve(__dirname, '..', '..', 'memory'); // память вынесена из .claude/ в корень проекта
function read(p) { try { return fs.readFileSync(p, 'utf8').replace(/\s+$/, ''); } catch { return null; } }
function trimLines(content, maxLines) {
  if (!content) return '';
  const lines = content.split('\n');
  const shown = lines.slice(0, maxLines).join('\n');
  return lines.length > maxLines ? `${shown}\n... (${lines.length - maxLines} строк скрыто; открой файл вручную при необходимости)` : shown;
}
function sectionSummary(content, sectionName, maxBullets) {
  if (!content) return '';
  const lines = content.split('\n');
  const out = [];
  let inSection = false;
  let bullets = 0;
  for (const line of lines) {
    if (line === `## ${sectionName}`) {
      inSection = true;
      out.push(line);
      continue;
    }
    if (inSection && line.startsWith('## ')) break;
    if (!inSection) continue;
    if (line.startsWith('- ')) {
      if (bullets >= maxBullets) continue;
      out.push(line);
      bullets += 1;
    } else if (line.startsWith('### ')) {
      out.push(line);
    }
  }
  return out.join('\n');
}

// «Пульс»: отмечаем факт и время запуска хука — чтобы можно было проверить,
// что автозагрузка реально сработала (файл в journal/, git и валидатор его игнорируют).
try {
  fs.writeFileSync(path.join(MEM, 'journal', '.session-start.last'), `SessionStart fired: ${new Date().toISOString()}\n`);
} catch { /* не критично */ }

const index = read(path.join(MEM, 'index.md'));
const state = read(path.join(MEM, 'state.md'));
if (index === null && state === null) process.exit(0); // памяти нет — молчим

// Необработанные журналы (первая строка ≠ "processed: true") → авто-директива на компакцию.
const pending = [];
try {
  for (const f of fs.readdirSync(path.join(MEM, 'journal'))) {
    if (!f.endsWith('.md')) continue;
    const first = ((read(path.join(MEM, 'journal', f)) || '').split('\n')[0] || '').trim();
    if (first !== 'processed: true') pending.push(f);
  }
} catch { /* журнала может не быть */ }

const out = [];
out.push('===== ПАМЯТЬ ПРОЕКТА (короткая автозагрузка) =====');
out.push('Ниже — короткая карта памяти из memory/. Полный протокол — в CLAUDE.md.');
out.push('Перед задачей определи по карте релевантные файлы и дочитай их. Записи disputed/expired — игнорируй.');
out.push('ОБЯЗАТЕЛЬНО: первой строкой ответа на любую содержательную задачу выдай «🧠 Из памяти: …» (что учтено, простым языком). Даже если релевантного мало — напиши «проверил, ничего критичного». Молчать нельзя — пользователь должен видеть это на КАЖДОЙ задаче.');
if (pending.length) {
  out.push('');
  out.push(`⚠ ЖУРНАЛ: ${pending.length} необработанных записей (${pending.join(', ')}). Не зависай на этом молча: сообщи пользователю коротко и продолжай срочную задачу; компакцию сделай отдельным явным шагом, когда это не блокирует ответ.`);
}
out.push('');
if (index !== null) { out.push('--- КАРТА ПАМЯТИ (index.md, первые 40 строк) ---'); out.push(trimLines(index, 40)); out.push(''); }
if (state !== null) {
  const updated = (state.match(/^updated:.*$/m) || [null])[0];
  out.push('--- STATE.MD: коротко ---');
  if (updated) out.push(updated);
  out.push(sectionSummary(state, 'В работе', 8) || '## В работе\n(открой memory/state.md при необходимости)');
  out.push(sectionSummary(state, 'Дальше', 8) || '## Дальше\n(открой memory/state.md при необходимости)');
}

process.stdout.write(out.join('\n') + '\n');
