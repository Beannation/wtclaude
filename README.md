# WTClaude

Billing-grade cost tracking for Claude Code.

> **WTClaude is an independent, open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic.** "Claude" is a trademark of Anthropic, PBC.

Most Claude Code trackers read the local session logs (the JSONL files), which don't carry billing-grade cost — so their totals can drift from your bill. **WTClaude reads the statusline instead — the same source behind your bill** — so your `today` / `week` / `month` cost is **billing-grade in the terminal**.

![wtclaude compare — your real, billing-grade cost next to a session-log estimate, and the gap](docs/compare.gif)

## See your own gap

```bash
npx wtclaude setup
wtclaude compare
```

`wtclaude compare` shows your real, billing-grade number next to the number a log-based tracker would show you, and the gap between them. How big that gap is depends entirely on how you use Claude Code — so the point is to see *yours*.

## Why the logs drift

Claude Code writes its JSONL session logs during streaming, before the API response finalizes, so token counts in the logs can be incomplete or placeholder values that never get corrected. Independent research has documented cases where this significantly undercounts real usage ([gille.ai](https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/)), and there are open reports of the underlying behavior (`anthropics/claude-code#28197`, `ryoppippi/ccusage#866`). Because those logs were never the billing source, any tool reconstructing cost from them is estimating.

WTClaude reads the **statusline** — the same cumulative, finalized data behind the `/cost` command and your bill — so in the terminal it's billing-grade.

> **Scope, precisely:** billing-grade applies to Claude Code **in the terminal**, where the statusline is available. For the desktop app, Cowork, or Chat, that source isn't exposed locally, so WTClaude labels those as honest estimates — never billing-grade.

## Install

```bash
npx wtclaude setup
```

This does three things:
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

# End-of-day summary with costliest turn and tips
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

# Status: on/off, last sync, your anonymous ID
wtclaude sync --status

# Turn it back off (your local data and config are kept)
wtclaude sync --disable
```

Before anything leaves your machine, `--enable` shows a preview of exactly what's uploaded: **counts, flags, and salted hashes only — never prompts, code, file names, or project paths.** Nothing uploads until you confirm (use `--enable --yes` for non-interactive setups). Once enabled, WTClaude also pushes opportunistically in the background when your local data changes — debounced and non-blocking. Set `WTCLAUDE_NO_AUTOSYNC=1` to disable just the background push, or `wtclaude sync --disable` to stop sync entirely.

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

## Data Storage

```
~/.wtclaude/
├── config.json                    # Preferences
├── sessions/{session_id}.ndjson   # Per-turn records
├── daily/{YYYY-MM-DD}.json        # Daily aggregates
└── comparisons/{date}.json        # Cached JSONL comparisons
```

## License

MIT © Peter Bean. WTClaude is an independent, open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic.
