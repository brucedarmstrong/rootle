'use strict';

// ── Theme ─────────────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('rootle_theme');
  if (saved) document.documentElement.dataset.theme = saved;
})();

// ── Config ────────────────────────────────────────────────────────────────────
const LAUNCH_DATE    = '2026-06-03';
const KEY_GAME       = date => `rootle_game_${date}`;
const KEY_STATS      = 'rootle_stats';
const KEY_SEEN_HELP  = 'rootle_seen_help';

const LANG_COLORS = {
  'Proto-Indo-European': '#6d28d9',
  'Sanskrit':            '#7c3aed',
  'Greek':               '#1d4ed8',
  'Latin':               '#b91c1c',
  'Medieval Latin':      '#9f1239',
  'Late Latin':          '#be123c',
  'Arabic':              '#047857',
  'Old Norse':           '#1e40af',
  'Old English':         '#78350f',
  'Middle English':      '#92400e',
  'Italian':             '#c2410c',
  'Spanish':             '#b45309',
  'Old French':          '#0f766e',
  'Anglo-French':        '#0e7490',
  'French':              '#155e75',
  'default':             '#374151',
};

// ── State ─────────────────────────────────────────────────────────────────────
let puzzles    = [];
let puzzle     = null;
let state      = null;
let activeDate = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id  => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

function langColor(lang) {
  return LANG_COLORS[lang] || LANG_COLORS['default'];
}

// ── Persistence ───────────────────────────────────────────────────────────────
function freshState(date) {
  return { date, puzzleId: puzzle.id, hopsVisible: 1, guesses: [], solved: false, lost: false };
}

function loadGameState(date) {
  try {
    const raw = localStorage.getItem(KEY_GAME(date));
    if (raw) {
      const saved = JSON.parse(raw);
      // Discard save if it belongs to a different puzzle (after a re-order)
      if (saved.puzzleId === getPuzzleForDate(date).id) return saved;
    }
  } catch {}
  return freshState(date);
}

function saveGameState() {
  localStorage.setItem(KEY_GAME(state.date), JSON.stringify(state));
}

function loadStats() {
  try {
    const raw = localStorage.getItem(KEY_STATS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { played: 0, won: 0, currentStreak: 0, maxStreak: 0, lastWonDate: null, distribution: {} };
}

function saveStats(stats) {
  localStorage.setItem(KEY_STATS, JSON.stringify(stats));
}

function recordResult(solved, guessNum) {
  const stats = loadStats();
  stats.played++;
  if (solved) {
    stats.won++;
    // Streak: increment only if consecutive days
    const yesterday = new Date(new Date() - 86_400_000).toISOString().split('T')[0];
    if (stats.lastWonDate === yesterday || stats.lastWonDate === activeDate) {
      stats.currentStreak++;
    } else if (stats.lastWonDate !== activeDate) {
      stats.currentStreak = 1;
    }
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    stats.lastWonDate = activeDate;
    const key = String(guessNum);
    stats.distribution[key] = (stats.distribution[key] || 0) + 1;
  } else {
    if (stats.lastWonDate !== activeDate) stats.currentStreak = 0;
    stats.distribution['X'] = (stats.distribution['X'] || 0) + 1;
  }
  saveStats(stats);
}

// ── Puzzle loading ────────────────────────────────────────────────────────────
async function fetchPuzzles() {
  const res = await fetch('puzzles.json');
  if (!res.ok) throw new Error('Could not load puzzles.json');
  return res.json();
}

function getPuzzleForDate(date) {
  const exact = puzzles.find(p => p.date === date);
  if (exact) return exact;
  // Cycle through puzzles for dates beyond the list
  const offset = daysBetween(LAUNCH_DATE, date);
  return puzzles[((offset % puzzles.length) + puzzles.length) % puzzles.length];
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function buildHopCard(hop, index, animate) {
  const solveHop = state.solved && index === state.guesses.length;
  const classes = ['hop-card'];
  if (index === 0)  classes.push('hop-card--root');
  if (solveHop)     classes.push('hop-card--solved');
  if (animate)      classes.push('hop-card--entering');
  const card = el('div', classes.join(' '));

  if (index === 0) {
    const lbl = el('div', 'hop-label');
    lbl.textContent = 'Root';
    card.appendChild(lbl);
  }

  if (solveHop) {
    const badge = el('div', 'hop-solve-badge');
    badge.textContent = '✓ Solved';
    card.appendChild(badge);
  }

  const badge = el('span', 'lang-badge');
  badge.style.backgroundColor = langColor(hop.language);
  badge.textContent = hop.language;
  card.appendChild(badge);

  const form = el('div', 'hop-form');
  form.textContent = hop.form;
  card.appendChild(form);

  const meaning = el('div', 'hop-meaning');
  meaning.textContent = `"${hop.meaning}"`;
  card.appendChild(meaning);

  return card;
}

function renderChain() {
  const container = $('chain-container');
  container.innerHTML = '';
  const count = (state.solved || state.lost) ? puzzle.hops.length : state.hopsVisible;
  for (let i = 0; i < count; i++) {
    container.appendChild(buildHopCard(puzzle.hops[i], i, false));
  }
}

function appendHopAnimated() {
  const container = $('chain-container');
  const index = state.hopsVisible - 1;
  const card = buildHopCard(puzzle.hops[index], index, true);
  container.appendChild(card);
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function renderWrongGuesses() {
  const container = $('wrong-guesses');
  container.innerHTML = '';
  if (!state.guesses.length && !state.solved) return;
  const lbl = el('div', 'wrong-label');
  lbl.textContent = 'Previous guesses:';
  container.appendChild(lbl);
  const tags = el('div', 'wrong-tags');
  state.guesses.forEach(g => {
    const tag = el('span', g === null ? 'wrong-tag wrong-tag--skip' : 'wrong-tag');
    tag.textContent = g === null ? '— skipped' : g;
    tags.appendChild(tag);
  });
  if (state.solved) {
    const tag = el('span', 'wrong-tag wrong-tag--correct');
    tag.textContent = puzzle.answer.toUpperCase();
    tags.appendChild(tag);
  }
  container.appendChild(tags);
}

function renderInputVisibility() {
  const area = $('input-area');
  if (state.solved || state.lost) {
    area.classList.add('hidden');
  } else {
    area.classList.remove('hidden');
    $('guess-input').focus({ preventScroll: true });
  }
}

// ── Share ─────────────────────────────────────────────────────────────────────
// One emoji + color per hop position (independent of outcome)
const HOP_EMOJI  = ['🟨', '🟩', '🟧', '🟥', '🟪'];
const HOP_COLOR  = ['#fbbf24', '#4ade80', '#fb923c', '#f87171', '#c084fc'];
const BASE_BARS  = 3; // squares on the root row; grows by 1 per hop

function shareRowParts(i) {
  const hopCount   = puzzle.hops.length;
  const wrongCount = state.guesses.length;
  const solvedHere = state.solved && i === wrongCount;
  const reached    = i <= wrongCount;

  const emoji  = reached ? HOP_EMOJI[Math.min(i, HOP_EMOJI.length - 1)] : '⬛';
  const bars   = BASE_BARS + i;
  const label  = solvedHere          ? `Solved in ${wrongCount + 1}!`
               : !state.solved && i === hopCount - 1 && reached ? 'X'
               : i === 0             ? 'Root'
               :                      `+${i} hop${i > 1 ? 's' : ''}`;

  return { emoji, bars, label, color: HOP_COLOR[Math.min(i, HOP_COLOR.length - 1)], reached };
}

function buildShareText() {
  const hopCount  = puzzle.hops.length;
  const wrongCount = state.guesses.length;
  const score     = state.solved ? `${wrongCount + 1}/${hopCount}` : `X/${hopCount}`;

  let grid = '';
  for (let i = 0; i < hopCount; i++) {
    const { emoji, bars, label } = shareRowParts(i);
    grid += `${emoji.repeat(bars)}  ${label}\n`;
  }

  const challengeUrl = `https://brucearmstrong.net/rootle/?puzzle=${puzzle.id}`;
  return `Rootle #${puzzle.id} (${score})\n\n${grid}\n${challengeUrl}`;
}

function renderShareGrid() {
  const container = $('share-grid');
  container.innerHTML = '';

  for (let i = 0; i < puzzle.hops.length; i++) {
    const { color, bars, label, reached } = shareRowParts(i);

    const row = el('div', 'share-row');

    const bar = el('div', 'share-bar');
    bar.style.width = `${bars * 14}px`;
    bar.style.background = reached ? color : '#6b7280';
    bar.style.opacity    = reached ? '1' : '0.35';
    row.appendChild(bar);

    const lEl = el('span', 'share-label');
    lEl.textContent = label;
    row.appendChild(lEl);

    container.appendChild(row);
  }
}

// ── Result overlay ────────────────────────────────────────────────────────────
function showResult() {
  const wrongCount = state.guesses.length;
  const guessNum   = wrongCount + (state.solved ? 1 : 0);

  if (state.solved) {
    $('result-emoji').textContent  = guessNum === 1 ? '🏆' : guessNum === 2 ? '✨' : '🎉';
    $('result-title').textContent  = guessNum === 1 ? 'Brilliant!' : `Solved in ${guessNum}!`;
  } else {
    $('result-emoji').textContent  = '📚';
    $('result-title').textContent  = 'Better luck tomorrow!';
  }

  $('result-answer').textContent = `The word was ${puzzle.answer}`;
  renderShareGrid();

  // "Next puzzle" button only for archive dates
  const nextBtn = $('next-btn');
  if (activeDate < todayStr()) {
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => {
      const nextDate = getNextDate(activeDate);
      if (nextDate) loadPuzzleForDate(nextDate);
    };
  } else {
    nextBtn.classList.add('hidden');
  }

  $('result-overlay').classList.remove('hidden');
}

function getNextDate(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  const next = d.toISOString().split('T')[0];
  return next <= todayStr() ? next : null;
}

// ── Game actions ──────────────────────────────────────────────────────────────
function skipHop() {
  if (state.solved || state.lost) return;

  state.guesses.push(null);

  if (state.hopsVisible < puzzle.hops.length) {
    state.hopsVisible++;
    saveGameState();
    renderWrongGuesses();
    appendHopAnimated();
  } else {
    state.lost = true;
    saveGameState();
    recordResult(false, 0);
    renderWrongGuesses();
    renderInputVisibility();
    setTimeout(showResult, 600);
  }
}

function shakeInput() {
  const inp = $('guess-input');
  inp.classList.remove('shake');
  void inp.offsetWidth; // force reflow
  inp.classList.add('shake');
  inp.addEventListener('animationend', () => inp.classList.remove('shake'), { once: true });
}

function submitGuess() {
  if (state.solved || state.lost) return;
  const raw = $('guess-input').value.trim();
  if (!raw) return;

  const guess = raw.toUpperCase();

  if (state.guesses.includes(guess)) {
    shakeInput();
    return;
  }

  $('guess-input').value = '';

  if (guess === puzzle.answer.toUpperCase()) {
    const guessNum = state.guesses.length + 1;
    state.solved = true;
    saveGameState();
    recordResult(true, guessNum);
    renderChain();
    renderWrongGuesses();
    renderInputVisibility();
    setTimeout(showResult, 600);
  } else {
    state.guesses.push(guess);

    if (state.hopsVisible < puzzle.hops.length) {
      state.hopsVisible++;
      saveGameState();
      shakeInput();
      renderWrongGuesses();
      appendHopAnimated();
    } else {
      state.lost = true;
      saveGameState();
      recordResult(false, 0);
      renderWrongGuesses();
      renderInputVisibility();
      setTimeout(showResult, 600);
    }
  }
}

// ── Modal system ──────────────────────────────────────────────────────────────
function showModal(html) {
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}

function hideModal() {
  $('modal-overlay').classList.add('hidden');
}

// ── Help ──────────────────────────────────────────────────────────────────────
function showHelp() {
  showModal(`
    <h2>How to Play</h2>
    <div class="help-steps">
      <div class="help-step">
        <span class="step-num">1</span>
        <p>You see the <strong>oldest known root</strong> of a word — its language, ancient form, and meaning.</p>
      </div>
      <div class="help-step">
        <span class="step-num">2</span>
        <p>Guess the <strong>modern English word</strong> it eventually became.</p>
      </div>
      <div class="help-step">
        <span class="step-num">3</span>
        <p>Wrong? The <strong>next hop</strong> in the etymology chain is revealed as a clue.</p>
      </div>
      <div class="help-step">
        <span class="step-num">4</span>
        <p>Not sure? Hit <strong>Skip</strong> to reveal the next clue without guessing — but it costs a hop.</p>
      </div>
      <div class="help-step">
        <span class="step-num">5</span>
        <p>Fewer hops used = better score. <strong>One puzzle per day.</strong></p>
      </div>
    </div>
    <div class="help-example">
      <div class="example-label">Example</div>
      <div class="example-chain">
        <div>Proto-Indo-European &nbsp;<em>*sal-*</em> &nbsp;"salt"</div>
        <div>&#8659; Latin &nbsp;<em>salarium</em> &nbsp;"salt allowance"</div>
        <div>&#8659; Old French &nbsp;<em>salaire</em> &nbsp;"wages"</div>
        <div>&#8659; <strong>SALARY</strong></div>
      </div>
    </div>
  `);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function showStats() {
  const stats  = loadStats();
  const winPct = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;

  const dist   = stats.distribution;
  const maxHops = puzzle ? puzzle.hops.length : 4;
  const maxVal  = Math.max(...Object.values(dist).map(Number), 1);

  let distHtml = '';
  for (let i = 1; i <= maxHops; i++) {
    const val   = dist[String(i)] || 0;
    const w     = Math.max(Math.round((val / maxVal) * 100), val > 0 ? 8 : 0);
    distHtml += `
      <div class="dist-row">
        <span class="dist-key">${i}</span>
        <div class="dist-bar-wrap">
          <div class="dist-bar" style="width:${w}%">${val}</div>
        </div>
      </div>`;
  }
  if (dist['X']) {
    const val = dist['X'];
    const w   = Math.max(Math.round((val / maxVal) * 100), 8);
    distHtml += `
      <div class="dist-row">
        <span class="dist-key">✗</span>
        <div class="dist-bar-wrap">
          <div class="dist-bar dist-bar--fail" style="width:${w}%">${val}</div>
        </div>
      </div>`;
  }

  showModal(`
    <h2>Statistics</h2>
    <div class="stats-grid">
      <div class="stat"><div class="stat-num">${stats.played}</div><div class="stat-label">Played</div></div>
      <div class="stat"><div class="stat-num">${winPct}%</div><div class="stat-label">Win %</div></div>
      <div class="stat"><div class="stat-num">${stats.currentStreak}</div><div class="stat-label">Streak</div></div>
      <div class="stat"><div class="stat-num">${stats.maxStreak}</div><div class="stat-label">Best</div></div>
    </div>
    <h3>Guess Distribution</h3>
    <div class="dist-chart">${distHtml || '<p style="color:var(--text-muted);font-size:.85rem">No games played yet.</p>'}</div>
  `);
}

// ── Archive ───────────────────────────────────────────────────────────────────
function showArchive() {
  const today = todayStr();
  const available = puzzles
    .filter(p => p.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));

  const rows = available.map(p => {
    const s   = loadGameState(p.date);
    const icon        = s.solved ? '✓' : s.lost ? '✗' : '○';
    const statusClass = s.solved ? ' archive-status--won' : s.lost ? ' archive-status--lost' : '';
    const cur  = p.date === activeDate ? ' archive-current' : '';
    return `<div class="archive-row${cur}" data-date="${p.date}">
      <span class="archive-status${statusClass}">${icon}</span>
      <span class="archive-date">${p.date}</span>
      <span class="archive-num">#${p.id}</span>
    </div>`;
  }).join('');

  showModal(`
    <h2>Archive</h2>
    <div class="archive-list">${rows || '<p style="color:var(--text-muted);font-size:.85rem">No past puzzles yet.</p>'}</div>
  `);

  $('modal-content').querySelectorAll('.archive-row').forEach(row => {
    row.addEventListener('click', () => {
      loadPuzzleForDate(row.dataset.date);
      hideModal();
    });
  });
}

// ── Load puzzle by ID (challenge links) ───────────────────────────────────────
function loadPuzzleById(id) {
  const p = puzzles.find(p => p.id === Number(id));
  if (p) loadPuzzleForDate(p.date);
  else   loadPuzzleForDate(todayStr());
}

// ── Load puzzle for a date ────────────────────────────────────────────────────
function loadPuzzleForDate(date) {
  activeDate = date;
  puzzle     = getPuzzleForDate(date);
  state      = loadGameState(date);

  // Guard: clamp hopsVisible in case of corrupt saved state
  state.hopsVisible = Math.max(1, Math.min(state.hopsVisible, puzzle.hops.length));

  $('puzzle-num').textContent = `#${puzzle.id}`;
  $('result-overlay').classList.add('hidden');

  renderChain();
  renderWrongGuesses();
  renderInputVisibility();

  if (state.solved || state.lost) showResult();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function syncAppHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  $('app').style.height = h + 'px';
}

async function init() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppHeight);
  } else {
    window.addEventListener('resize', syncAppHeight);
  }
  syncAppHeight();

  try {
    puzzles = await fetchPuzzles();
  } catch (err) {
    $('chain-container').innerHTML = '<p style="color:var(--lose);padding:16px">Failed to load puzzles. Refresh to try again.</p>';
    return;
  }

  // Theme toggle
  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function updateThemeBtn() {
    $('btn-theme').textContent = isDark() ? '☀️' : '🌙';
  }
  $('btn-theme').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('rootle_theme', next);
    updateThemeBtn();
  });
  updateThemeBtn();

  // Header buttons
  $('btn-help').addEventListener('click', showHelp);
  $('btn-stats').addEventListener('click', showStats);
  $('btn-archive').addEventListener('click', showArchive);

  // Input
  $('submit-btn').addEventListener('click', submitGuess);
  $('skip-btn').addEventListener('click', skipHop);
  $('guess-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitGuess();
  });

  // Result overlay
  $('share-btn').addEventListener('click', async () => {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
      const btn = $('share-btn');
      btn.textContent = 'Copied! ✓';
      setTimeout(() => { btn.textContent = 'Share 📋'; }, 2000);
    } catch {
      alert(text);
    }
  });

  $('result-stats-btn').addEventListener('click', () => {
    $('result-overlay').classList.add('hidden');
    showStats();
  });

  // Modal
  $('modal-close').addEventListener('click', hideModal);
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) hideModal();
  });

  $('result-close').addEventListener('click', () => $('result-overlay').classList.add('hidden'));
  $('result-overlay').addEventListener('click', e => {
    if (e.target === $('result-overlay')) $('result-overlay').classList.add('hidden');
  });

  // Load puzzle — respect ?puzzle=N challenge links, else today's
  const urlId = new URLSearchParams(location.search).get('puzzle');
  if (urlId) loadPuzzleById(urlId);
  else       loadPuzzleForDate(todayStr());

  // Show help on first visit
  if (!localStorage.getItem(KEY_SEEN_HELP)) {
    showHelp();
    localStorage.setItem(KEY_SEEN_HELP, '1');
  }
}

document.addEventListener('DOMContentLoaded', init);
