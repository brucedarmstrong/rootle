# Rootle — Adding New Puzzles

Puzzles live in `puzzles.json`. Each entry needs an `id`, `date`, `answer`, and a `hops` array (oldest root first, modern English word excluded). The pipeline in `scripts/` automates fetching etymology from Etymonline and extracting hops via Claude AI.

## Prerequisites

```bash
cd scripts
npm install                          # one-time
export ANTHROPIC_API_KEY=sk-ant-...  # get from console.anthropic.com
```

## Step 1 — Add words to the candidate list

Open `scripts/words.txt` and add one word per line (lowercase). These are candidates — not every word will produce a good puzzle.

Good puzzle words are **common in everyday English** with a **surprising origin** and a clear chain of **2–4 hops**. Words that come from proper names (sandwich, jeans) or have only 1 hop tend to get filtered out automatically.

## Step 2 — Run the scraper

```bash
cd scripts
node scrape.js                  # process all words in words.txt
node scrape.js panic alcohol    # or process specific words only
```

The scraper fetches each word from Etymonline, sends the prose to Claude, and appends results to `candidates.json`. It skips words already in `candidates.json`, so it's safe to stop and resume mid-run.

Cost: roughly **$0.003 per word** with Claude Opus.

## Step 3 — Review candidates.json

Open `scripts/candidates.json`. Each entry looks like:

```json
{
  "word": "PANIC",
  "suitable": true,
  "reason": "Common word with delightfully unexpected origin from Pan the god",
  "hops": [
    { "language": "Greek",  "form": "panikon",  "meaning": "pertaining to Pan, god of woods" },
    { "language": "French", "form": "panique",  "meaning": "sudden contagious fright" }
  ]
}
```

Things to check and fix by hand if needed:

- **Hop meanings that give away the answer** — e.g. if the meaning says "sudden fright" for PANIC that's fine, but a meaning that literally says the English word is a spoiler.
- **Redundant hops** — if two adjacent hops are nearly identical, delete the weaker one.
- **Wrong `suitable` flag** — flip it to `false` to exclude a word, or `true` to include one Claude marked as unsuitable.
- **Inaccurate etymology** — Claude extracts from Etymonline prose faithfully, but spot-check anything that looks off.

You don't need to touch entries you're happy with.

## Step 4 — Promote to puzzles.json

```bash
node promote.js --dry-run       # preview what would be added and when
node promote.js                 # write to puzzles.json
node promote.js PANIC ALCOHOL   # promote specific words only
```

`promote.js` skips words already in `puzzles.json` and assigns dates sequentially after the last existing puzzle. Run `--dry-run` first to confirm the ordering looks right.

## Step 5 — Deploy

From the project root:

```bash
rsync -av puzzles.json root@brucearmstrong.net:/var/www/brucearmstrong.net/public_html/rootle/
```

Then commit:

```bash
git add puzzles.json && git commit -m "Add N new puzzles through YYYY-MM-DD"
```

---

## Reviewing puzzles with the admin UI

`admin.html` is a local-only review tool — it is not deployed to the server.

1. Start the local server from the project root: `python3 -m http.server 8765`
2. Open **http://localhost:8765/admin.html**
3. Each puzzle shows the answer and the full hop chain
4. Use the keyboard to review:
   - **→ or Enter** — keep
   - **← or Backspace** — reject
5. To stop early, click the **💾 Save & Quit** button (top-right of the action bar) — unreviewed puzzles are treated as kept
6. At the end (or after Save & Quit), click **Download updated puzzles.json**
7. Copy the downloaded file to the project root, then deploy:

```bash
rsync -av puzzles.json root@brucearmstrong.net:/var/www/brucearmstrong.net/public_html/rootle/
git add puzzles.json && git commit -m "Puzzle review pass"
git push
```

The downloaded file has IDs and dates automatically re-sequenced to fill any gaps left by rejected puzzles.

---

## Adding a puzzle manually

Skip the scraper and add directly to `puzzles.json`. The `id` should be one higher than the current last entry, and the `date` one day after:

```json
{
  "id": 70,
  "date": "2026-07-28",
  "answer": "CHAOS",
  "hops": [
    { "language": "Proto-Indo-European", "form": "*ghieh-*", "meaning": "to yawn, gape wide open" },
    { "language": "Greek",              "form": "khaos",    "meaning": "abyss, vast gaping emptiness" },
    { "language": "Latin",              "form": "chaos",    "meaning": "formless void at creation" }
  ]
}
```

Then deploy as in Step 5.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `scrape.js` skips a word with "fetch failed" | Etymonline may be blocking that URL. Add the puzzle manually. |
| Claude returns non-JSON | Re-run `node scrape.js <word>` — occasional API hiccup. |
| Word resolves to wrong Etymonline entry | Some words have multiple entries (e.g. *tattoo* the military signal vs. the body art). Add manually with the correct hops. |
| `promote.js` says "no eligible candidates" | Check that `suitable: true` and the word isn't already in `puzzles.json`. |
