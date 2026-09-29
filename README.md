# WTClaude

Billing-grade cost tracking for Claude Code.

> **WTClaude is an independent, open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic.** "Claude" is a trademark of Anthropic, PBC.

Most Claude Code trackers read the local session logs (the JSONL files), which don't carry billing-grade cost — so their totals can drift from your bill. **WTClaude reads the statusline instead — the same source behind your bill** — so your `today` / `week` / `month` cost is **billing-grade in the terminal**.

![wtclaude compare — your real, billing-grade cost next to a session-log estimate, and the gap](docs/compare.gif)

## See your own gap

```bash
npm i -g wtclaude
wtclaude setup
wtclaude compare
```

`wtclaude compare` shows your real, billing-grade number next to the number a log-based tracker would show you, and the gap between them. How big that gap is depends entirely on how you use Claude Code — so the point is to see *yours*.

## Why the logs drift

Claude Code writes its JSONL session logs during streaming, before the API response finalizes, so token counts in the logs can be incomplete or placeholder values that never get corrected. Independent research has documented cases where this significantly undercounts real usage ([gille.ai](https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/)), and there are open reports of the underlying behavior (`anthropics/claude-code#28197`, `ryoppippi/ccusage#866`). Because those logs were never the billing source, any tool reconstructing cost from them is estimating.

WTClaude reads the **statusline** — the same cumulative, finalized data behind the `/cost` command and your bill — so in the terminal it's billing-grade.

> **Scope, precisely:** billing-grade applies to Claude Code **in the terminal**, where the statusline is available. For the desktop app, Cowork, or Chat, that source isn't exposed locally, so WTClaude labels those as honest estimates — never billing-grade.

## Install

```bash
npm i -g wtclaude
wtclaude setup
```

Install globally: Claude Code runs the collector on every status update, so it needs a stable path. (`npx wtclaude setup` runs from npm's temporary cache, so setup won't point Claude Code there; it tells you to install globally instead.)

`wtclaude setup` does three things:
1. Creates the `~/.wtclaude/` data directory
2. Adds the statusline collector to your Claude Code settings
3. You're done — start a new Claude Code session

## Usage

After using Claude Code with the collector active:

```bash
# Today's usage (tokens, cost, model breakdown)
wtclaude today

# Last 7 or 30 days
wtclaude week
wtclaude month

# THE moment: see how wrong your old tracker was
wtclaude compare

# What would today cost on a different plan?
wtclaude whatif --plan

# What if you'd used a different model?
wtclaude whatif --model haiku

# End-of-day summary: total cost with its basis, costliest turn, cache-read share of input-side tokens
wtclaude debrief
```

## How It Works

1. Claude Code pipes a JSON payload to `wtclaude-collector` on every status update
2. The collector computes per-turn deltas from the cumulative totals
3. Per-turn records are appended to `~/.wtclaude/sessions/{session_id}.ndjson`
4. CLI commands read these local files to show usage summaries

**Local-first by default:** out of the box there's no cloud and no account — your usage data stays on your machine. Cloud sync and the web dashboard are entirely **opt-in**; until you turn them on, nothing leaves your machine.

## Cloud sync (optional)

Everything above works fully offline. Cloud sync is **opt-in** and off until you turn it on — and there are **no keys to paste.** WTClaude runs the backend; the CLI ships a browser-safe publishable key (it can't bypass row-level security, and every privileged write happens server-side). Turning sync on lets you see your usage in the web dashboard and across machines.

```bash
# See exactly what sync would send, then opt in (one push runs on confirm)
wtclaude sync --enable

# Push on demand, any time
wtclaude sync

# Status: on/off, last sync, the start of your anonymous ID
wtclaude sync --status

# Turn it back off (your local data and config are kept; data already synced stays in the cloud)
wtclaude sync --disable
```

Before anything leaves your machine, `--enable` shows a preview of exactly what's uploaded. Nothing uploads until you confirm (use `--enable --yes` for non-interactive setups). Each per-turn record carries only:

- Turn number and timestamp
- Model id (e.g. claude-opus-5-5)
- Token counts: input, output, cache read and cache write, per turn and running totals
- Context-window use %
- Cost: the billing-grade figure, or a list-rate estimate for a turn without one
- Speed tier, usage pool and billing basis
- Git branch names, as salted hashes
- Project folder, as a salted hash (never the path)
- Cost-center labels you set
- Device id (random, one per install)
- Task category and edit-target hash (salted)
- Lines added and removed
- Durations: wall-clock and API time
- Effort, thinking and long-context flags
- Claude Code version
- Rate-limit % and reset times

Also sent:

- Your anonymous id, with every upload (it is the key to your cloud row)
- Session ids (the random id Claude Code gives each session)
- Per-session totals: tokens, cost, turn counts, models used, start and end time
- Badges you have earned, with the date
- Your leaderboard-sharing setting (on or off), once you set it

Never sent: prompts, responses, code, file contents, file names, folder paths, raw branch names, your email. Branch names are hashed with a random per-install salt that stays on your machine (without one, no branch is sent); your local records keep branch names as they are.

Once enabled, WTClaude also pushes opportunistically in the background when your local data changes — debounced and non-blocking. Set `WTCLAUDE_NO_AUTOSYNC=1` to disable just the background push, or `wtclaude sync --disable` to stop sync entirely. Turning sync off doesn't delete what was already uploaded, and deleting it isn't self-serve yet. Don't post your anonymous id anywhere public: it opens your dashboard.

Your anonymous id is the key to your cloud data, so the CLI shows only its first 8 characters, except in the dashboard link it prints when no browser opens. `wtclaude dashboard` opens the dashboard and links that browser for you.

<details>
<summary><strong>Advanced / self-host</strong></summary>

Instead of the hosted backend, you can point the CLI at your own Supabase project by adding its **publishable** key to `~/.wtclaude/config.json` (these override the shipped defaults):

```json
{
  "supabase_url": "https://YOUR-PROJECT.supabase.co",
  "supabase_publishable_key": "sb_publishable_..."
}
```

Use the browser-safe publishable key (`sb_publishable_…`) only — never a secret/service key in the CLI. Then run `wtclaude sync --enable`.
</details>

## Why Not Just Fix JSONL?

It's an upstream bug in Claude Code (filed Feb 2026, still unfixed). The JSONL write path logs during streaming for crash-resistance — but never updates with the real numbers after the response completes. Cache metrics happen to be accurate because they're in the initial response header.

Anthropic's own tools (`/cost`, `/usage`) use the accurate internal state, not JSONL. WTClaude taps into that same accurate source.

## What's exact, what's an estimate, and what it can't see

The headline cost for **terminal Claude Code** is billing-grade: it's the cost
figure Claude Code itself reports, not a number we recompute. Cowork and Chat
figures are clearly-labeled estimates.

WTClaude sees local Claude Code sessions on this machine. Sessions that run on
Anthropic's infrastructure — claude.ai, the desktop and mobile apps,
`claude --cloud`, scheduled routines — aren't visible to it, and it can't tell
that one happened.

Anything denominated in usage credits is priced at standard API list rates;
pre-purchased bundles cut the effective rate by up to 30% and local data can't see
which bundle you hold, so those figures can overstate your real cost.

Full detail — cache pricing, credit expiry, the paused Agent-SDK split, which
Claude Code versions changed what, and the questions we deliberately refuse to
answer because Anthropic hasn't stated them: **[docs/DATA-NOTES.md](docs/DATA-NOTES.md)**.

## Data Storage

```
~/.wtclaude/
├── config.json                    # Preferences
├── sessions/{session_id}.ndjson   # Per-turn records
├── daily/{YYYY-MM-DD}.json        # Daily aggregates
└── comparisons/{date}.json        # Cached JSONL comparisons
```

## Development

```bash
npm ci
npm test          # the CLI and collector suite (src/ and bin/), Node 18 or newer
```

`npm test` needs only the root install and runs on any Node the CLI supports
(`engines: >=18`), from any shell, Windows `cmd.exe` included: `bin/run-tests.js`
lists the test files itself. Extra flags pass through
(`npm test -- --test-name-pattern=sync`), and file paths replace the list
(`npm test -- src/sync/index.test.js`). The tests never read your own `~/.claude`
or `~/.wtclaude`: each one runs against a scratch home directory.

The dashboard (`web/`) and the website (`site/`) have their own suites.
`npm run test:all` runs all three. It needs Node 22.18 or newer (the site tests
import TypeScript directly) and the web and site dependencies:

```bash
npm ci --prefix web && npm ci --prefix site
npm run test:all
```

## License

MIT © Peter Bean. WTClaude is an independent, open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic.
