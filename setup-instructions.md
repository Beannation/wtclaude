# Setup Instructions — Preparing the Code Chat

Follow these steps to set up the vibe-coding environment before pasting the kickoff prompt.

---

## Step 1: Create the project folder

Open your terminal and create the project directory:

```bash
mkdir -p ~/projects/wtclaude
cd ~/projects/wtclaude
```

## Step 2: Copy the handoff files into the project

Copy this entire `wtclaude-phase0-handoff` folder into your project:

```bash
cp -r "/Users/peterbean/Library/Application Support/Claude/local-agent-mode-sessions/70933dd6-f129-4954-ad27-59b7441ac16d/8f490b3c-f04c-44c1-8641-6a098d2c5d8d/local_30b1ad30-f75e-4488-8725-2092cc9b2147/outputs/wtclaude-phase0-handoff/"* ~/projects/wtclaude/
```

Your project folder should now look like:

```
~/projects/wtclaude/
├── CLAUDE.md                    # Claude Code reads this automatically
├── phase-0-build-plan.md        # (will be moved to research-context/)
├── kickoff-prompt.md            # The prompt you'll paste
├── setup-instructions.md        # This file
└── research-context/
    ├── feasibility-research-log.md
    ├── feasibility-report.md
    ├── approved-new-ideas.md
    ├── jsonl-bug-opportunity-deep-dive.md
    ├── market-research-report.md
    ├── cost-calc.py
    ├── claude-usage-estimator-handoff.md
    └── claude-usage-estimator-iteration-log.md
```

Move the build plan into research-context so it's alongside the other docs:

```bash
mv ~/projects/wtclaude/phase-0-build-plan.md ~/projects/wtclaude/research-context/
```

## Step 3: Initialize git

```bash
cd ~/projects/wtclaude
git init
git add CLAUDE.md research-context/
git commit -m "Initial commit: project context and research docs"
```

## Step 4: About CLAUDE.md

The `CLAUDE.md` file is placed at the project root. When you open Claude Code in this directory, it automatically reads `CLAUDE.md` at the start of every session. This gives Claude persistent context about:

- What the project is and why it exists
- Architecture constraints and technical decisions
- What NOT to build (prevents scope creep)
- File structure conventions
- Testing priorities

You don't need to do anything special — just having the file at the project root is enough. Claude Code detects and reads it automatically.

**If Claude Code asks to approve the CLAUDE.md file on first run, approve it.** This is a one-time trust prompt.

## Step 5: Open Claude Code in the project directory

```bash
cd ~/projects/wtclaude
claude
```

Claude Code will:
1. Detect and read `CLAUDE.md` automatically
2. Have access to all files in the project folder

## Step 6: Paste the kickoff prompt

Open `kickoff-prompt.md` and copy the text between the `---` markers. Paste it as your first message in the Claude Code chat.

Claude will:
1. Read the three key files (CLAUDE.md, build plan, JSONL deep dive)
2. Confirm its understanding of the collector's job
3. Start building Stage 1

## Step 7: How to work through the stages

The build plan has 5 stages. Work through them sequentially:

**Stage 1 (Days 1-3): Collector + CLI**
- Let Claude build the collector and CLI commands
- Test: configure your Claude Code settings.json, run a session, run `wtclaude today` and `wtclaude compare`
- Verify the numbers look right before proceeding

**Stage 2 (Days 3-5): Comparison Cards + Referral**
- Shareable comparison card generator
- Invite link system
- Landing page
- Test: generate a comparison card, verify it looks good

**Stage 3 (Days 5-8): Supabase Backend + Cloud Sync**
- You'll need a Supabase account (free tier: supabase.com)
- Create a new project, then let Claude set up the schema
- Test: enable sync, verify data appears in Supabase dashboard

**Stage 4 (Days 8-12): Web Dashboard**
- You'll need a Vercel account (Pro tier: $20/mo for commercial use)
- Let Claude scaffold and build the React dashboard
- Test: open dashboard, verify all views render with your data

**Stage 5 (Days 12-14): Polish + Launch Prep**
- Edge cases, performance, install flow testing
- README finalization, launch asset creation
- Test: full end-to-end flow from fresh install

## Tips for Vibe-Coding with Claude Code

1. **Let Claude build complete files.** Don't ask for code snippets — ask for complete, working files. "Build the collector script" not "show me how to parse stdin."

2. **Test at each stage.** Don't rush through all 5 stages. Test Stage 1 thoroughly before asking Claude to start Stage 2. Real bugs found early are easy; real bugs found in Stage 5 are painful.

3. **Reference the build plan.** If Claude goes off-track or starts building something from the "do not build" list, point it back to the build plan. Say: "Check the build plan — that's deferred to Phase 1."

4. **Use the CLAUDE.md as guardrails.** If a session gets long and Claude seems to lose context, you can say "Re-read CLAUDE.md" to reset its understanding of constraints.

5. **Commit frequently.** After each working component, commit to git. This gives you rollback points if something breaks.

6. **The collector is the hardest part.** Getting per-turn delta computation right, handling edge cases (session resume, /compact, model switches), and keeping it under 50ms — this is where bugs will hide. Spend extra time testing this.

## Accounts You'll Need

| Service | Tier | Cost | When |
|---------|------|------|------|
| GitHub | Free | $0 | Stage 1 (for repo) |
| Supabase | Free | $0 | Stage 3 (backend) |
| Vercel | Pro | $20/mo | Stage 4 (dashboard hosting) |
| npm | Free | $0 | Stage 1 (package publishing) |
| Resend or Postmark | Free tier | $0 | Stage 4 (monthly report emails, optional) |
| Domain (wtclaude.com or similar) | — | ~$12/year | Stage 2 (landing page) |

## After Phase 0 Launches

Come back to this Cowork session (or start a new one referencing the research docs) to plan Phase 1: the estimation engine, Guardian foundations, and the paid tier. All the research for those features is already done and documented in the `research-context/` folder.
