-- 003_dashboard_fields.sql
-- Persist the rich per-turn / per-session fields the CLI already syncs (the
-- collector's billing-grade cost anchor + BUILD-022 speed tier + BUILD-023
-- "statusline data surface v2") so the M9 dashboard can render cost-by-source,
-- the limit gauge, devices, peak heatmaps, etc. from synced data.
--
-- The CLI sync payload ALREADY carries these (src/sync builds them from the full
-- collector records); 001's sync-data simply dropped them on insert. This adds
-- the columns; the updated sync-data edge function fills them.
--
-- Deploy ordering: run AFTER 002. New columns inherit table-level grants, and
-- 002 revoked all anon/authenticated access + set default privileges to revoke,
-- so these columns are server-side-only (edge functions / service_role) with no
-- further grant changes. PRIVACY: every field is a count / flag / salted hash —
-- never a path, filename, or content (Decision #5 intact).

-- ── turns ──────────────────────────────────────────────────────────────────
alter table turns add column if not exists cost_usd numeric(12,6);
alter table turns add column if not exists cumulative_cost_usd numeric(12,6);
alter table turns add column if not exists speed_tier text;
alter table turns add column if not exists speed_tier_source text;   -- 'payload' (billing-grade) | 'inferred'
alter table turns add column if not exists usage_pool text;
alter table turns add column if not exists billing_basis text;
alter table turns add column if not exists git_branch text;
alter table turns add column if not exists project_hash text;        -- salted hash, never the path
alter table turns add column if not exists cost_center text;
alter table turns add column if not exists device_id text;
alter table turns add column if not exists task_category text;       -- null on current payloads
alter table turns add column if not exists edit_target_hash text;    -- salted hash, never the filename
alter table turns add column if not exists lines_added int;
alter table turns add column if not exists lines_removed int;
alter table turns add column if not exists duration_ms bigint;
alter table turns add column if not exists api_duration_ms bigint;
alter table turns add column if not exists effort_level text;
alter table turns add column if not exists thinking_enabled boolean;
alter table turns add column if not exists exceeds_200k_tokens boolean;
alter table turns add column if not exists cc_version text;
-- rate_limits snapshot — the shared OVERALL plan limit (5h + 7d). Latest turn
-- drives the Overview limit gauge.
alter table turns add column if not exists rate_limit_5h_pct numeric(5,2);
alter table turns add column if not exists rate_limit_5h_resets_at timestamptz;
alter table turns add column if not exists rate_limit_7d_pct numeric(5,2);
alter table turns add column if not exists rate_limit_7d_resets_at timestamptz;

-- ── sessions ─────────────────────────────────────────────────────────────────
alter table sessions add column if not exists anchored_cost_usd numeric(12,6) default 0;
alter table sessions add column if not exists estimated_only_cost_usd numeric(12,6) default 0;
alter table sessions add column if not exists fast_cost_usd numeric(12,6) default 0;
alter table sessions add column if not exists fast_turns int default 0;
alter table sessions add column if not exists cost_basis text;       -- 'billing-grade' | 'mixed' | 'estimate'
alter table sessions add column if not exists git_branch text;
alter table sessions add column if not exists cost_center text;
alter table sessions add column if not exists device_id text;
alter table sessions add column if not exists lines_added int default 0;
alter table sessions add column if not exists lines_removed int default 0;
alter table sessions add column if not exists duration_ms bigint default 0;
alter table sessions add column if not exists api_duration_ms bigint default 0;

create index if not exists idx_sessions_device on sessions(user_id, device_id);

-- ── daily_summaries ──────────────────────────────────────────────────────────
alter table daily_summaries add column if not exists anchored_cost_usd numeric(12,6) default 0;
alter table daily_summaries add column if not exists estimated_only_cost_usd numeric(12,6) default 0;
alter table daily_summaries add column if not exists fast_cost_usd numeric(12,6) default 0;
alter table daily_summaries add column if not exists lines_added bigint default 0;
alter table daily_summaries add column if not exists lines_removed bigint default 0;
alter table daily_summaries add column if not exists duration_ms bigint default 0;
alter table daily_summaries add column if not exists api_duration_ms bigint default 0;

-- ── users ────────────────────────────────────────────────────────────────────
-- Display currency preference already lives in users.preferences (jsonb); no
-- column needed. Re-assert deny grants on the (unchanged) table set as a no-op
-- safety net in case this migration is applied before 002 in a fresh project.
revoke all on table turns           from anon, authenticated;
revoke all on table sessions        from anon, authenticated;
revoke all on table daily_summaries from anon, authenticated;
