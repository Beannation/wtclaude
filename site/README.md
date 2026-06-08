# WTClaude — Wave-1 marketing site

Static Astro + Tailwind site for the June-9 Wave-1 launch. Built from the canonical
GTM copy spec (`../../website-copy-wave1.md`) — **copy is GTM-owned; do not edit strings here,
flag to the PMO instead.**

## Pages in this wave
- `/` — Home / umbrella
- `/developers` — CLI Dev landing (the Wave-1 workhorse)
- `/blog/the-june-15-split` — the explainer post
- `/docs` — install + CLI reference + FAQ
- Per-persona pages (Complete User, SMB) → nav stubs → "coming soon" email capture.

## Run it
```bash
npm install
npm run dev      # local dev at http://localhost:4321
npm run build    # static output → ./dist
```

## Launch gates baked into config (`src/config.ts`)
- `SHOW_DASHBOARD_LINK = false` — no live-dashboard link until Build confirms **SEC Phase C** is deployed.
- `DUAL_POOL_ACTIVATION_DATE = 2026-06-15` — drives the date-gated June-15 banner + countdown.
- `SHOW_FAST_MODE` / `FAST_MODE_BADGE` — gates the fast-mode copy (BUILD-022 / D-8 Jun-8 check). Flip one constant to pull it everywhere.
- `SHOW_TASKS_FEATURE = false` — the task-category breakdown is coming-soon, never marketed as live.

## Notes
- Replaces the old `../landing/index.html` (old "lying to you 100×" messaging). Not yet deleted — pending Peter's go-ahead.
- Analytics: Umami (self-hosted) — event wiring in `src/lib/analytics.ts`; set `PUBLIC_UMAMI_*` env to activate.
- Fonts self-hosted via Fontsource (no Google Fonts).
- Countdown + copy buttons are vanilla-JS islands (no React) to keep page weight < 500KB.
