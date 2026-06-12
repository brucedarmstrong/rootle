#!/usr/bin/env node
/**
 * Rootle etymology pipeline
 *
 * Usage:
 *   node scrape.js                  # process all words in words.txt
 *   node scrape.js salary panic     # process specific words
 *
 * Requires: ANTHROPIC_API_KEY env var
 * Output: candidates.json (review this, then run promote.js)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

// ── Fetch & parse Etymonline ──────────────────────────────────────────────────

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function extractProse(html) {
  // Anchor on the main prose-lg section
  const proseIdx = html.indexOf('prose-lg dark:prose-dark max-w-none');
  if (proseIdx === -1) return null;

  // Skip past the h2 heading
  const h2End = html.indexOf('</h2>', proseIdx);
  if (h2End === -1) return null;

  // Grab a window after the heading and pull <p> tags
  const window = html.slice(h2End, h2End + 6000);
  const paragraphs = [];
  const pRegex = /<p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRegex.exec(window)) !== null) {
    const text = decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim();
    if (text.length > 40) paragraphs.push(text);
  }

  // First two paragraphs are the core etymology
  return paragraphs.slice(0, 2).join('\n\n') || null;
}

async function fetchEtymology(word) {
  const url = `https://www.etymonline.com/word/${encodeURIComponent(word.toLowerCase())}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) throw new Error('404 Not Found');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const prose = extractProse(html);
  if (!prose) throw new Error('Could not locate etymology section');
  return prose;
}

// ── Claude extraction ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You build content for Rootle, a daily word etymology puzzle game.

Players see a word's oldest known root and guess the modern English word. Wrong guesses reveal the next hop in the chain. The puzzle should feel like a satisfying "aha!" moment.

Given etymology prose for a word, extract the most interesting 2–4 language hops from oldest root to just before modern English.

Respond with ONLY a JSON object — no markdown fences, no explanation:
{
  "suitable": true/false,
  "reason": "one sentence",
  "hops": [
    { "language": "...", "form": "...", "meaning": "..." }
  ]
}

Rules for hops:
- Oldest first; do NOT include the modern English word itself as a hop
- "language": use standard names like "Proto-Indo-European", "Sanskrit", "Arabic", "Greek", "Latin", "Old Norse", "Old French", "Italian", "Spanish", "Middle English"
- "form": the word/root as written in that language; use *asterisks* for reconstructed PIE roots (e.g., *sal-*)
- "meaning": brief and vivid — what the form actually meant (under 10 words)
- Skip redundant near-duplicates; prefer hops that show a surprising shift in meaning or language
- For compound words formed by merging two roots (e.g. MALARIA from Latin "mala" + "aria"), combine them into a single hop showing the merged form and unified meaning (e.g. { "language": "Italian", "form": "mala aria", "meaning": "bad air" }). Do NOT list the component roots as separate hops.
- suitable = the word is common in everyday English AND the origin is genuinely surprising AND there are 3–4 clear, interesting hops (words with only 2 hops are NOT suitable)`;

async function extractHops(word, prose) {
  const msg = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Word: ${word.toUpperCase()}\n\nEtymology prose:\n${prose}`,
    }],
  });

  const raw = msg.content[0].text.trim();
  // Strip any accidental markdown fences
  const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const wordsArg = process.argv.slice(2);
  const words = wordsArg.length
    ? wordsArg
    : fs.readFileSync(path.join(__dir, 'words.txt'), 'utf8')
        .split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);

  // Load existing candidates so we can resume without re-scraping
  const outPath = path.join(__dir, 'candidates.json');
  let existing = [];
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  }
  const done = new Set(existing.map(e => e.word.toLowerCase()));

  const results = [...existing];
  let newCount = 0;
  let errorCount = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (done.has(word)) {
      console.log(`[${i+1}/${words.length}] ${word} — already done, skipping`);
      continue;
    }

    process.stdout.write(`[${i+1}/${words.length}] ${word}... `);

    try {
      const prose = await fetchEtymology(word);
      const { suitable, reason, hops } = await extractHops(word, prose);

      results.push({ word: word.toUpperCase(), suitable, reason, hops, prose });
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

      const mark = suitable && hops.length >= 3 ? '✓' : '–';
      console.log(`${mark} ${suitable ? `suitable (${hops.length} hops)` : `skip: ${reason}`}`);
      newCount++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      errorCount++;
    }

    if (i < words.length - 1) await sleep(1500);
  }

  console.log(`\nDone. ${newCount} new, ${errorCount} errors. Results in candidates.json`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
