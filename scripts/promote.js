#!/usr/bin/env node
/**
 * Rootle promote script
 *
 * Reads candidates.json, shows suitable ones, and appends approved entries
 * to ../puzzles.json with sequential dates starting after the last existing puzzle.
 *
 * Usage:
 *   node promote.js              # promote all suitable candidates
 *   node promote.js --dry-run    # preview without writing
 *   node promote.js SALARY PANIC # promote specific words only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir  = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.resolve(__dir, '..');
const DRY    = process.argv.includes('--dry-run');
const FILTER = process.argv.slice(2).filter(a => a !== '--dry-run').map(w => w.toUpperCase());

// ── Load existing puzzles ─────────────────────────────────────────────────────
const puzzlesPath = path.join(ROOT, 'puzzles.json');
const puzzles = JSON.parse(fs.readFileSync(puzzlesPath, 'utf8'));

// Find the last date and id
const lastDate = puzzles.reduce((max, p) => p.date > max ? p.date : max, '2000-01-01');
const lastId   = puzzles.reduce((max, p) => p.id > max ? p.id : max, 0);
const existing = new Set(puzzles.map(p => p.answer.toUpperCase()));

function nextDate(dateStr) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

// ── Load candidates ───────────────────────────────────────────────────────────
const candidatesPath = path.join(__dir, 'candidates.json');
if (!fs.existsSync(candidatesPath)) {
  console.error('No candidates.json found. Run scrape.js first.');
  process.exit(1);
}

const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

let eligible = candidates.filter(c => {
  if (!c.suitable || c.hops.length < 2) return false;
  if (existing.has(c.word.toUpperCase()))  return false;
  if (FILTER.length && !FILTER.includes(c.word.toUpperCase())) return false;
  return true;
});

if (!eligible.length) {
  console.log('No eligible candidates to promote.');
  console.log(`(${candidates.length} total, ${candidates.filter(c=>c.suitable).length} suitable, ${candidates.filter(c=>!existing.has(c.word)).length} not already in puzzles.json)`);
  process.exit(0);
}

// ── Build new puzzle entries ──────────────────────────────────────────────────
const newPuzzles = [];
let curDate = lastDate;
let curId   = lastId;

for (const c of eligible) {
  curDate = nextDate(curDate);
  curId++;
  newPuzzles.push({
    id:     curId,
    date:   curDate,
    answer: c.word.toUpperCase(),
    hops:   c.hops,
  });
}

// ── Preview ───────────────────────────────────────────────────────────────────
console.log(`\n${DRY ? '[DRY RUN] ' : ''}Adding ${newPuzzles.length} puzzles:\n`);
for (const p of newPuzzles) {
  console.log(`  #${p.id} ${p.date}  ${p.answer}`);
  for (const h of p.hops) {
    console.log(`    ${h.language.padEnd(25)} ${h.form.padEnd(20)} "${h.meaning}"`);
  }
  console.log();
}

if (DRY) {
  console.log('Dry run — puzzles.json not modified.');
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────────
const merged = [...puzzles, ...newPuzzles];
fs.writeFileSync(puzzlesPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`puzzles.json updated: ${puzzles.length} → ${merged.length} puzzles.`);
