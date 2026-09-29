-- 009.test.sql — migration 009 on a scratch Postgres (run by supabase/tests/run.sh
-- after 001-008 + seed-pre009.sql + 009). Every scenario catches its own error
-- and records a FAIL, so a baseline run without 009 lists what 009 fixes.
-- Synthetic ids only. Times are fixed instants (no dependence on today's date).

-- Fixed ids.
--   A 1111… pre-009 seed          B 2222… contract-A sends    C 3333… chunking
--   D 4444… old client, raw branch E 5555… heal on re-send    F 6666… local days
--   G 7777… sparks / rate limits   L1 8888… / L2 9999… leaderboard
--   H 1212… deploy order           N 1313… / P 1414… calls with nothing to store
--   X 1515… turns the CLI leaves unpriced (excluded)
--   R 1616… legacy $0 anchors (seeded pre-009)   S 1717… legacy $0 from a 0.3.1 client after 009
--   T 1818… session money precision
--   W 1919…, K1 2020…, K2 2121…, K3 2323…, K4 2424…, K5 2525… the limit gauge rule

-- Lookups into dashboard_local() payloads.
create or replace function wtc_test.day(p_days jsonb, p_date text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_days) e where e->>'date' = p_date;
$$;
create or replace function wtc_test.sess(p_sessions jsonb, p_sid text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_sessions) e where e->>'session_id' = p_sid;
$$;

-- ── Backfill and cleanup of the pre-009 seed ────────────────────────────────
do $$
declare s sessions;
begin
  s := wtc_test.session_row('11111111-1111-4111-8111-111111111111', 'pre-split');
  perform wtc_test.eq('QA-0928-35 backfill: lines_added = sum over all 100 stored turns', s.lines_added, 300);
  perform wtc_test.eq('QA-0928-35 backfill: lines_removed', s.lines_removed, 100);
  perform wtc_test.eq('QA-0928-35 backfill: duration_ms', s.duration_ms, 100000::bigint);
  perform wtc_test.eq('QA-0928-35 backfill: api_duration_ms', s.api_duration_ms, 50000::bigint);
exception when others then perform wtc_test.check('QA-0928-35 backfill', false, sqlerrm);
end $$;

do $$
begin
  perform wtc_test.eq('decision-1 cleanup: no raw branch left in turns',
    (select count(*) from turns where git_branch is not null and git_branch !~ '^#[0-9a-f]{12}$'), 0::bigint);
  perform wtc_test.eq('decision-1 cleanup: no raw branch left in sessions',
    (select count(*) from sessions where git_branch is not null and git_branch !~ '^#[0-9a-f]{12}$'), 0::bigint);
  perform wtc_test.eq('decision-1 cleanup: salted-hash branches kept (turns)',
    (select count(*) from turns where git_branch = '#0123456789ab'), 5::bigint);
  perform wtc_test.eq('decision-1 cleanup: salted-hash branch kept (session)',
    (wtc_test.session_row('11111111-1111-4111-8111-111111111111', 'pre-hashed')).git_branch, '#0123456789ab');
exception when others then perform wtc_test.check('decision-1 cleanup', false, sqlerrm);
end $$;

-- A consistency check: total = anchored + estimated_only, to the micro-dollar (the
-- total was numeric(10,4) before 009, so 008 rounded T's 12.344997 day to
-- 12.3450). The backfill cannot price a legacy turn (rates live in the CLI's
-- pricing JSON), so what heals QA-0928-34 is the re-send below.
do $$
begin
  perform wtc_test.eq('QA-0928-34 daily rows are consistent: total = anchored + estimated_only (6 decimals)',
    (select count(*) from daily_summaries
      where estimated_cost_usd <> anchored_cost_usd + estimated_only_cost_usd), 0::bigint);
exception when others then perform wtc_test.check('QA-0928-34 daily consistency', false, sqlerrm);
end $$;

-- ── The QA's own repro: a legacy estimate-only day (users A, H) ─────────────
-- A's pre-legacy session (UTC day 03-03) is the 05-25 case: four turns with no
-- cost_usd, the estimate only in the session summary. 009 alone leaves the day at
-- $0; the 0.3.2 CLI's one-time full re-send carries cost_estimate_usd per turn,
-- and the RPC fills it into the stored rows. (3-arg call, as the deployed
-- sync-data makes, so a baseline run shows what 008 does with the same re-send.)
do $$
declare r jsonb; d daily_summaries; s sessions; u uuid := wtc_test.user_id('11111111-1111-4111-8111-111111111111');
begin
  perform wtc_test.eq('QA-0928-34 before the re-send: the legacy day is $0 in the cloud',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-03'), 0::numeric);
  r := sync_user_batch('11111111-1111-4111-8111-111111111111',
    jsonb_build_array(wtc_test.session('pre-legacy',
      wtc_test.turns(1, 4, '2026-03-03 10:00Z', null, '{"cost_estimate_usd":0.26}'))), '[]'::jsonb);
  perform wtc_test.eq('QA-0928-34 the re-send fills the 4 stored turns', (r->>'turns_updated')::int, 4);
  perform wtc_test.eq('QA-0928-34 the reply says which missing fields a re-send fills',
    r->'fills_missing', '["cost_estimate_usd", "git_branch"]'::jsonb);
  select * into d from daily_summaries where user_id = u and date = '2026-03-03';
  perform wtc_test.eq('QA-0928-34 after the re-send: legacy day total = the CLI estimate', d.estimated_cost_usd, 1.04::numeric);
  perform wtc_test.eq('QA-0928-34 after the re-send: all of it labelled estimate', d.estimated_only_cost_usd, 1.04::numeric);
  perform wtc_test.eq('QA-0928-34 after the re-send: nothing counted billing-grade', d.anchored_cost_usd, 0::numeric);
  s := wtc_test.session_row('11111111-1111-4111-8111-111111111111', 'pre-legacy');
  perform wtc_test.eq('QA-0928-34 after the re-send: session total = daily total', s.estimated_cost_usd, 1.04::numeric);
  perform wtc_test.eq('QA-0928-34 after the re-send: session cost_basis estimate', s.cost_basis, 'estimate');
exception when others then perform wtc_test.check('QA-0928-34 legacy day re-send', false, sqlerrm);
end $$;

-- Why 009 must be live before any 0.3.2 CLI syncs: H's one-time re-send reached
-- the 008 server (seed), which kept neither the estimates nor the hashed branch,
-- and 009's cleanup then nulled the raw branch. Only a re-send AFTER 009 heals it.
do $$
declare r jsonb; u uuid := wtc_test.user_id('12121212-1212-4121-8121-121212121212');
begin
  perform wtc_test.eq('deploy order: a re-send that reached 008 left the day at $0',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-03'), 0::numeric);
  perform wtc_test.eq('deploy order: ... and no branch once the cleanup ran',
    (select count(git_branch) from turns where user_id = u), 0::bigint);
  r := sync_user_batch('12121212-1212-4121-8121-121212121212',
    jsonb_build_array(wtc_test.session('h-legacy',
      wtc_test.turns(1, 4, '2026-03-03 12:00Z', null, '{"cost_estimate_usd":0.25,"git_branch":"#dddddddddddd"}'))), '[]'::jsonb);
  perform wtc_test.eq('deploy order: a re-send after 009 heals the day',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-03'), 1.00::numeric);
  perform wtc_test.eq('deploy order: ... and the hashed branch',
    (select count(*) from turns where user_id = u and git_branch = '#dddddddddddd'), 4::bigint);
exception when others then perform wtc_test.check('deploy order', false, sqlerrm);
end $$;

-- ── Legacy $0 anchors (RC finding; the server half of QA-0928-52) ───────────
-- The CLI's rule (hasCostAnchor): a stored cost_usd 0 with no cumulative cost is
-- not a figure Claude Code reported, so the turn is unanchored. The cloud keeps
-- one invariant for it: cost_usd is NULL for every unanchored turn, so every
-- aggregate's `cost_usd is null` split stays right.
-- User R (seeded through 008): the backfill un-anchors the legacy rows; the 0.3.2
-- CLI's one-time re-send then fills the estimate (the RC repro: $1.51 mixed).
do $$
declare r jsonb; s sessions; d daily_summaries; j jsonb;
        v_id text := '16161616-1616-4161-8161-161616161616'; u uuid := wtc_test.user_id('16161616-1616-4161-8161-161616161616');
begin
  s := wtc_test.session_row(v_id, 'r-legacy0');
  perform wtc_test.eq('legacy $0 backfill: the 0/null row is stored unanchored (cost_usd NULL)',
    (select cost_usd from turns where session_id = s.id and turn_number = 2), null::numeric);
  perform wtc_test.eq('legacy $0 backfill: the real anchors keep their cost',
    (select sum(cost_usd) from turns where session_id = s.id), 0.75::numeric);
  perform wtc_test.eq('legacy $0 backfill: a session with an unanchored turn is no longer billing-grade', s.cost_basis, 'mixed');
  perform wtc_test.eq('legacy $0 backfill: an all-legacy $0 session is an estimate',
    (wtc_test.session_row(v_id, 'r-all0')).cost_basis, 'estimate');
  perform wtc_test.eq('legacy $0 backfill: a real $0 anchor (with a cumulative cost) stays anchored',
    (select count(cost_usd) from turns t where t.session_id = (wtc_test.session_row(v_id, 'r-real0')).id), 2::bigint);
  perform wtc_test.eq('legacy $0 backfill: ... and its session stays billing-grade',
    (wtc_test.session_row(v_id, 'r-real0')).cost_basis, 'billing-grade');
  select * into d from daily_summaries where user_id = u and date = '2026-03-13';
  perform wtc_test.eq('legacy $0 backfill: the day''s anchored cost = the real anchors', d.anchored_cost_usd, 0.85::numeric);

  -- The 0.3.2 CLI's full re-send: the legacy row goes up as cost_usd null with
  -- its list-rate estimate; the real anchors as before.
  r := sync_user_batch(v_id, jsonb_build_array(wtc_test.session('r-legacy0', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 10:00Z', 0.50, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.50}'),
      wtc_test.turn(2, '2026-03-13 10:01Z', null,
        '{"model":"claude-opus-5-5","cost_usd":null,"cumulative_cost_usd":null,"cost_estimate_usd":0.76,"input_tokens":90000,"output_tokens":20000}'),
      wtc_test.turn(3, '2026-03-13 10:02Z', 0.25, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.75}')))),
    '[]'::jsonb, '{}'::jsonb);
  perform wtc_test.eq('legacy $0 re-send: fills the one legacy turn', (r->>'turns_updated')::int, 1);
  s := wtc_test.session_row(v_id, 'r-legacy0');
  perform wtc_test.eq('legacy $0 re-send: the turn keeps no $0 anchor',
    (select cost_usd from turns where session_id = s.id and turn_number = 2), null::numeric);
  perform wtc_test.eq('legacy $0 re-send: the turn stores the estimate',
    (select cost_estimate_usd from turns where session_id = s.id and turn_number = 2), 0.76::numeric);
  perform wtc_test.eq('legacy $0 re-send: session total = the CLI''s $1.51', s.estimated_cost_usd, 1.51::numeric);
  perform wtc_test.eq('legacy $0 re-send: session anchored $0.75', s.anchored_cost_usd, 0.75::numeric);
  perform wtc_test.eq('legacy $0 re-send: session estimate $0.76', s.estimated_only_cost_usd, 0.76::numeric);
  perform wtc_test.eq('legacy $0 re-send: session basis mixed', s.cost_basis, 'mixed');
  j := dashboard_local(u, '2026-03-13', 'UTC');
  perform wtc_test.eq('legacy $0 re-send: daily_local total = $1.61 (1.51 + the real-$0 session''s 0.10)',
    (wtc_test.day(j->'daily_local', '2026-03-13')->>'total_usd')::numeric, 1.61);
  perform wtc_test.eq('legacy $0 re-send: daily_local estimate = $0.76',
    (wtc_test.day(j->'daily_local', '2026-03-13')->>'estimate_usd')::numeric, 0.76);
  perform wtc_test.eq('legacy $0 re-send: the window session total = $1.51',
    (wtc_test.sess(j->'sessions', 'r-legacy0')->>'window_total_usd')::numeric, 1.51);
  select * into d from daily_summaries where user_id = u and date = '2026-03-13';
  perform wtc_test.eq('legacy $0 re-send: UTC daily estimated_only = $0.76', d.estimated_only_cost_usd, 0.76::numeric);
  perform wtc_test.eq('legacy $0 re-send: UTC daily total = $1.61', d.estimated_cost_usd, 1.61::numeric);
exception when others then perform wtc_test.check('legacy $0 anchors (backfill + re-send)', false, sqlerrm);
end $$;

-- User S: a 0.3.1 CLI keeps syncing after 009 (old clients do), then upgrades.
do $$
declare r jsonb; s sessions; v_id text := '17171717-1717-4171-8171-171717171717';
        v_031 jsonb := jsonb_build_array(
          wtc_test.turn(1, '2026-03-13 14:00Z', 0.50, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.50}'),
          wtc_test.turn(2, '2026-03-13 14:01Z', 0, '{"model":"claude-opus-5-5","cumulative_cost_usd":null}'),
          wtc_test.turn(3, '2026-03-13 14:02Z', 0.25, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.75}'));
begin
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-031', v_031)), '[]'::jsonb);
  s := wtc_test.session_row(v_id, 's-031');
  perform wtc_test.eq('legacy $0 from a 0.3.1 client after 009: stored unanchored',
    (select cost_usd from turns where session_id = s.id and turn_number = 2), null::numeric);
  perform wtc_test.eq('legacy $0 from a 0.3.1 client after 009: session not billing-grade', s.cost_basis, 'mixed');
  -- The stored row cannot tell an absent cumulative key from a null one, so both
  -- un-anchor a $0. (Every collector since 0.1.0 writes the key; the CLI's
  -- key-less exception has no real rows to send.)
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-nokey',
    jsonb_build_array(wtc_test.turn(1, '2026-03-13 15:00Z', 0)))), '[]'::jsonb);
  perform wtc_test.eq('legacy $0 with no cumulative key: stored unanchored',
    (select count(cost_usd) from turns t where t.session_id = (wtc_test.session_row(v_id, 's-nokey')).id), 0::bigint);
  -- A real $0 anchor from the 0.3.2 CLI (it sends cost_usd 0 only with a cumulative cost).
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-real0',
    jsonb_build_array(wtc_test.turn(1, '2026-03-13 16:00Z', 0, '{"cumulative_cost_usd":3.5}')))), '[]'::jsonb);
  perform wtc_test.eq('a real $0 anchor (with a cumulative cost) is stored as $0',
    (select cost_usd from turns t where t.session_id = (wtc_test.session_row(v_id, 's-real0')).id), 0::numeric);
  perform wtc_test.eq('... and its session is billing-grade', (wtc_test.session_row(v_id, 's-real0')).cost_basis, 'billing-grade');

  -- Then the 0.3.2 CLI's re-send heals it.
  r := sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-031', jsonb_build_array(
      v_031->0,
      wtc_test.turn(2, '2026-03-13 14:01Z', null, '{"model":"claude-opus-5-5","cost_usd":null,"cumulative_cost_usd":null,"cost_estimate_usd":0.76}'),
      v_031->2))), '[]'::jsonb, '{}'::jsonb);
  perform wtc_test.eq('legacy $0 (0.3.1 after 009) re-send: fills the turn', (r->>'turns_updated')::int, 1);
  s := wtc_test.session_row(v_id, 's-031');
  perform wtc_test.eq('legacy $0 (0.3.1 after 009) re-send: session $1.51', s.estimated_cost_usd, 1.51::numeric);
  perform wtc_test.eq('legacy $0 (0.3.1 after 009) re-send: basis mixed', s.cost_basis, 'mixed');

  -- A branch fill never gives an ANCHORED stored turn an estimate (the fill used
  -- to write cost_estimate_usd whenever the git_branch half fired).
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-anch',
    jsonb_build_array(wtc_test.turn(1, '2026-03-13 17:00Z', 0.40, '{"cumulative_cost_usd":0.40}')))), '[]'::jsonb);
  r := sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-anch', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 17:00Z', null, '{"cost_usd":null,"cost_estimate_usd":0.9,"git_branch":"#abababababab"}')))),
    '[]'::jsonb, '{}'::jsonb);
  s := wtc_test.session_row(v_id, 's-anch');
  perform wtc_test.eq('branch fill on an anchored turn: the branch is filled', (r->>'turns_updated')::int, 1);
  perform wtc_test.eq('branch fill on an anchored turn: no estimate is stored',
    (select cost_estimate_usd from turns where session_id = s.id), null::numeric);
  perform wtc_test.eq('branch fill on an anchored turn: the anchor stays',
    (select cost_usd from turns where session_id = s.id), 0.40::numeric);

  -- A legacy $0 row the one-off cleanup never saw (written by the 008 RPC in the
  -- moment between the RPC swap and the cleanup; made directly here): the
  -- re-send's fill un-anchors it and stores the estimate.
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-late',
    jsonb_build_array(wtc_test.turn(1, '2026-03-13 18:00Z', 0.30, '{"cumulative_cost_usd":0.30}')))), '[]'::jsonb);
  s := wtc_test.session_row(v_id, 's-late');
  insert into turns (session_id, user_id, turn_number, "timestamp", model, cost_usd, cumulative_cost_usd)
  values (s.id, s.user_id, 2, '2026-03-13 18:01Z', 'claude-opus-5-5', 0, null);
  r := sync_user_batch(v_id, jsonb_build_array(wtc_test.session('s-late', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 18:00Z', 0.30, '{"cumulative_cost_usd":0.30}'),
      wtc_test.turn(2, '2026-03-13 18:01Z', null, '{"cost_usd":null,"cumulative_cost_usd":null,"cost_estimate_usd":0.44}')))),
    '[]'::jsonb, '{}'::jsonb);
  s := wtc_test.session_row(v_id, 's-late');
  perform wtc_test.eq('uncleaned legacy $0 row: the re-send fills it', (r->>'turns_updated')::int, 1);
  perform wtc_test.eq('uncleaned legacy $0 row: un-anchored',
    (select cost_usd from turns where session_id = s.id and turn_number = 2), null::numeric);
  perform wtc_test.eq('uncleaned legacy $0 row: session $0.74', s.estimated_cost_usd, 0.74::numeric);
  perform wtc_test.eq('uncleaned legacy $0 row: session basis mixed', s.cost_basis, 'mixed');
exception when others then perform wtc_test.check('legacy $0 anchors (0.3.1 after 009)', false, sqlerrm);
end $$;

-- ── Session money precision (RC finding; user T) ────────────────────────────
-- Session and daily totals keep 6 decimals like the turns, so the dashboard and
-- the CLI round the same exact sum (12.344997 → $12.34, never $12.35).
do $$
declare s sessions; v_id text := '18181818-1818-4181-8181-181818181818'; u uuid := wtc_test.user_id('18181818-1818-4181-8181-181818181818');
begin
  perform wtc_test.eq('precision: sessions.estimated_cost_usd is numeric(12,6)',
    (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'sessions'::regclass and attname = 'estimated_cost_usd'), 'numeric(12,6)');
  perform wtc_test.eq('precision: daily_summaries.estimated_cost_usd is numeric(12,6)',
    (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'daily_summaries'::regclass and attname = 'estimated_cost_usd'), 'numeric(12,6)');
  -- Pre-009 row: 008 stored 12.3450; its own 6-decimal split says 12.344997.
  perform wtc_test.eq('precision backfill: a pre-009 session total gets its exact value back',
    (wtc_test.session_row(v_id, 't-pre')).estimated_cost_usd, 12.344997::numeric);
  perform wtc_test.eq('precision backfill: ... which rounds to the CLI''s cents',
    round((wtc_test.session_row(v_id, 't-pre')).estimated_cost_usd, 2), 12.34::numeric);
  perform wtc_test.eq('precision backfill: a total that is not a rounding of its split is left alone',
    (wtc_test.session_row(v_id, 't-forged')).estimated_cost_usd, 5::numeric);
  perform wtc_test.eq('precision backfill: the day total keeps 6 decimals',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-14'), 13.344997::numeric);

  -- After 009, from the stored turns.
  perform sync_user_batch(v_id, jsonb_build_array(
    wtc_test.session('t-new', jsonb_build_array(
      wtc_test.turn(1, '2026-03-15 10:00Z', 5.000001), wtc_test.turn(2, '2026-03-15 10:01Z', 5.000001),
      wtc_test.turn(3, '2026-03-15 10:02Z', 2.344995))),
    wtc_test.session('t-est', wtc_test.turns(1, 2, '2026-03-15 11:00Z', null, '{"cost_estimate_usd":0.061742}'))),
    '[]'::jsonb, '{}'::jsonb);
  s := wtc_test.session_row(v_id, 't-new');
  perform wtc_test.eq('precision: session total = the exact sum of its turns', s.estimated_cost_usd, 12.344997::numeric);
  perform wtc_test.eq('precision: an estimate-only session keeps 6 decimals',
    (wtc_test.session_row(v_id, 't-est')).estimated_cost_usd, 0.123484::numeric);
  perform wtc_test.eq('precision: the UTC day total keeps 6 decimals',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-15'), 12.468481::numeric);
exception when others then perform wtc_test.check('session money precision', false, sqlerrm);
end $$;

-- ── Contract-A sends (user B) ───────────────────────────────────────────────
create table if not exists wtc_test.payloads (name text primary key, body jsonb);
insert into wtc_test.payloads values
  ('b1', jsonb_build_array(wtc_test.session('b-1',
           wtc_test.turns(1, 8, '2026-03-02 12:00Z', 0.01)
           || wtc_test.turns(9, 2, '2026-03-02 12:30Z', null, '{"cost_estimate_usd":0.05}'))))
on conflict (name) do nothing;

do $$
declare r jsonb; d daily_summaries; u uuid;
begin
  r := sync_user_batch('22222222-2222-4222-8222-222222222222',
         (select body from wtc_test.payloads where name = 'b1'),
         '[{"badge_type":"first_session","earned_at":"2026-03-02T12:00:00Z"}]'::jsonb,
         '{"sharing_enabled":true}'::jsonb);
  u := wtc_test.user_id('22222222-2222-4222-8222-222222222222');
  perform wtc_test.eq('QA-0928-204 first send: turns_inserted = 10', (r->>'turns_inserted')::int, 10);
  perform wtc_test.eq('QA-0928-204 first send: turns_skipped = 0', (r->>'turns_skipped')::int, 0);
  perform wtc_test.eq('QA-0928-204 first send: badges_inserted = 1', (r->>'badges_inserted')::int, 1);
  perform wtc_test.eq('QA-0928-39 profile {sharing_enabled:true} sets the flag',
    (select sharing_enabled from users where id = u), true);
  perform wtc_test.eq('QA-0928-34 cost_estimate_usd stored for the 2 unanchored turns',
    (select sum(cost_estimate_usd) from turns where user_id = u), 0.10::numeric);
  select * into d from daily_summaries where user_id = u and date = '2026-03-02';
  perform wtc_test.eq('QA-0928-34 daily anchored_cost_usd = sum(cost_usd)', d.anchored_cost_usd, 0.08::numeric);
  perform wtc_test.eq('QA-0928-34 daily estimated_only_cost_usd = the estimates', d.estimated_only_cost_usd, 0.10::numeric);
  perform wtc_test.eq('QA-0928-34 daily estimated_cost_usd (total) = anchored + estimate', d.estimated_cost_usd, 0.18::numeric);
exception when others then perform wtc_test.check('QA-0928-34/39/204 contract-A first send', false, sqlerrm);
end $$;

do $$
declare r jsonb; u uuid;
begin
  r := sync_user_batch('22222222-2222-4222-8222-222222222222',
         (select body from wtc_test.payloads where name = 'b1'),
         '[{"badge_type":"first_session","earned_at":"2026-03-02T12:00:00Z"}]'::jsonb,
         '{"sharing_enabled":true}'::jsonb);
  u := wtc_test.user_id('22222222-2222-4222-8222-222222222222');
  perform wtc_test.eq('QA-0928-204 re-send: turns_inserted = 0', (r->>'turns_inserted')::int, 0);
  perform wtc_test.eq('QA-0928-204 re-send: turns_skipped = 10', (r->>'turns_skipped')::int, 10);
  perform wtc_test.eq('QA-0928-204 re-send: turns_synced counts new turns only', (r->>'turns_synced')::int, 0);
  perform wtc_test.eq('QA-0928-204 re-send: badges_inserted = 0', (r->>'badges_inserted')::int, 0);
  perform wtc_test.eq('QA-0928-204 re-send: badges_skipped = 1', (r->>'badges_skipped')::int, 1);
  perform wtc_test.eq('QA-0928-204 re-send: still 10 stored turns', (select count(*) from turns where user_id = u), 10::bigint);
  perform wtc_test.eq('QA-0928-204 re-send: daily total unchanged',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-02'), 0.18::numeric);
exception when others then perform wtc_test.check('QA-0928-204 re-send', false, sqlerrm);
end $$;

-- ── A session split across two calls equals one full call (user C) ──────────
-- 3-arg calls (the deployed edge function's shape) so the baseline shows the bug.
do $$
declare a sessions; b sessions; v_all jsonb := wtc_test.turns(1, 100, '2026-03-04 10:00Z', 0.01);
begin
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-split', v_all, wtc_test.turns(1, 50, '2026-03-04 10:00Z', 0.01))), '[]'::jsonb);
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-split', v_all, wtc_test.turns(51, 50, '2026-03-04 10:50Z', 0.01))), '[]'::jsonb);
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-full', v_all)), '[]'::jsonb);
  a := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-split');
  b := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-full');
  perform wtc_test.eq('QA-0928-35 split session: lines_added = full session', a.lines_added, b.lines_added);
  perform wtc_test.eq('QA-0928-35 split session: lines_added = 300', a.lines_added, 300);
  perform wtc_test.eq('QA-0928-35 split session: lines_removed = full session', a.lines_removed, b.lines_removed);
  perform wtc_test.eq('QA-0928-35 split session: duration_ms = full session', a.duration_ms, b.duration_ms);
  perform wtc_test.eq('QA-0928-35 split session: api_duration_ms = 50000', a.api_duration_ms, 50000::bigint);
exception when others then perform wtc_test.check('QA-0928-35 split session', false, sqlerrm);
end $$;

do $$
declare s sessions;
begin
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-attr', wtc_test.turns(1, 10, '2026-03-04 14:00Z', 0.01),
      wtc_test.turns(1, 5, '2026-03-04 14:00Z', 0.01, '{"device_id":"dev-A","git_branch":"#aaaaaaaaaaaa","cost_center":"cc1","project_hash":"ph-A"}'))),
    '[]'::jsonb);
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-attr', wtc_test.turns(1, 10, '2026-03-04 14:00Z', 0.01),
      wtc_test.turns(6, 5, '2026-03-04 14:05Z', 0.01, '{"device_id":null,"git_branch":null,"cost_center":null,"project_hash":null}'))),
    '[]'::jsonb);
  s := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-attr');
  perform wtc_test.eq('QA-0928-35 a chunk without device keeps the session device_id', s.device_id, 'dev-A');
  perform wtc_test.eq('QA-0928-35 a chunk without branch keeps the session git_branch', s.git_branch, '#aaaaaaaaaaaa');
  perform wtc_test.eq('QA-0928-35 a chunk without cost_center keeps it', s.cost_center, 'cc1');
  perform wtc_test.eq('QA-0928-35 a chunk without project_hash keeps it', s.project_hash, 'ph-A');
exception when others then perform wtc_test.check('QA-0928-35 attributes', false, sqlerrm);
end $$;

-- ── QA-0928-124: session totals come from the stored turns (user C) ─────────
-- The summary a request carries no longer sets a known session's totals, so a
-- request cannot rewrite them; they are the sums over the turns the cloud holds
-- (turns are never overwritten), exactly as lines and durations are.
do $$
declare s sessions; f sessions; v_all jsonb := wtc_test.turns(1, 100, '2026-03-05 10:00Z', 0.01);
begin
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(jsonb_build_object('session_id', 'c-full', 'turns', '[]'::jsonb,
      'summary', jsonb_build_object('cost', 999, 'anchored_cost', 999, 'estimated_cost', 0, 'turn_count', 1,
        'input_tokens', 0, 'output_tokens', 0, 'cache_read_tokens', 0, 'cache_write_tokens', 0,
        'models', '{"forged": 1}'::jsonb, 'started_at', '2020-01-01T00:00:00Z', 'ended_at', '2020-01-01T00:00:01Z'))),
    '[]'::jsonb);
  s := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-full');
  perform wtc_test.eq('QA-0928-124 a forged summary cannot rewrite the session cost', s.estimated_cost_usd, 1.00::numeric);
  perform wtc_test.eq('QA-0928-124 ... nor its anchored cost', s.anchored_cost_usd, 1.00::numeric);
  perform wtc_test.eq('QA-0928-124 ... nor turn_count', s.turn_count, 100);
  perform wtc_test.eq('QA-0928-124 ... nor tokens', s.total_input_tokens, 10000::bigint);
  perform wtc_test.eq('QA-0928-124 ... nor models_used', s.models_used, '{"claude-sonnet-4-6": 100}'::jsonb);
  perform wtc_test.eq('QA-0928-124 ... nor started_at', s.started_at, '2026-03-04 10:00Z'::timestamptz);
  perform wtc_test.eq('QA-0928-124 ... nor ended_at', s.ended_at, '2026-03-04 11:39Z'::timestamptz);

  -- New turns 11-12 that try to re-label the session: the first stored value stays.
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-attr', wtc_test.turns(11, 2, '2026-03-04 14:10Z', 0.01,
      '{"device_id":"dev-EVIL","git_branch":"#eeeeeeeeeeee","cost_center":"cc-evil","project_hash":"ph-evil"}'))),
    '[]'::jsonb);
  s := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-attr');
  perform wtc_test.eq('QA-0928-124 a later chunk cannot re-label the device', s.device_id, 'dev-A');
  perform wtc_test.eq('QA-0928-124 ... nor the branch', s.git_branch, '#aaaaaaaaaaaa');
  perform wtc_test.eq('QA-0928-124 ... nor the cost center', s.cost_center, 'cc1');
  perform wtc_test.eq('QA-0928-124 ... nor the project', s.project_hash, 'ph-A');
  perform wtc_test.eq('QA-0928-124 totals cover every stored turn (10 + 2), not the request''s summary', s.turn_count, 12);
  perform wtc_test.eq('QA-0928-124 cost covers every stored turn', s.estimated_cost_usd, 0.12::numeric);

  -- Half of a session sent: the cloud's totals are what it holds; the rest adds up.
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-half', v_all, wtc_test.turns(1, 50, '2026-03-05 10:00Z', 0.01))), '[]'::jsonb);
  s := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-half');
  perform wtc_test.eq('QA-0928-124 half a session stored: turn_count = 50', s.turn_count, 50);
  perform wtc_test.eq('QA-0928-124 half a session stored: cost = 0.50', s.estimated_cost_usd, 0.50::numeric);
  perform sync_user_batch('33333333-3333-4333-8333-333333333333',
    jsonb_build_array(wtc_test.session('c-half', v_all, wtc_test.turns(51, 50, '2026-03-05 10:50Z', 0.01))), '[]'::jsonb);
  s := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-half');
  f := wtc_test.session_row('33333333-3333-4333-8333-333333333333', 'c-full');
  perform wtc_test.eq('QA-0928-124 both halves: turn_count = the full send', s.turn_count, f.turn_count);
  perform wtc_test.eq('QA-0928-124 both halves: cost = the full send', s.estimated_cost_usd, f.estimated_cost_usd);
  perform wtc_test.eq('QA-0928-124 both halves: tokens = the full send', s.total_cache_read, f.total_cache_read);
exception when others then perform wtc_test.check('QA-0928-124 session totals from stored turns', false, sqlerrm);
end $$;

-- An honest full send: the stored-turn totals equal the CLI's summary (user B).
do $$
declare s sessions;
begin
  s := wtc_test.session_row('22222222-2222-4222-8222-222222222222', 'b-1');
  perform wtc_test.eq('QA-0928-124 stored-turn totals = the CLI summary: total', s.estimated_cost_usd, 0.18::numeric);
  perform wtc_test.eq('QA-0928-124 ... anchored', s.anchored_cost_usd, 0.08::numeric);
  perform wtc_test.eq('QA-0928-124 ... estimate', s.estimated_only_cost_usd, 0.10::numeric);
  perform wtc_test.eq('QA-0928-124 ... turn_count', s.turn_count, 10);
  perform wtc_test.eq('QA-0928-124 ... cost_basis', s.cost_basis, 'mixed');
exception when others then perform wtc_test.check('QA-0928-124 honest send', false, sqlerrm);
end $$;

-- A call with nothing to store creates no user; one with a profile flag does.
do $$
declare r jsonb;
begin
  r := sync_user_batch('13131313-1313-4131-8131-131313131313', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);
  perform sync_user_batch('13131313-1313-4131-8131-131313131313', null, null, null);
  perform wtc_test.eq('QA-0928-124 a call with nothing to store creates no user',
    (select count(*) from users where anonymous_id = '13131313-1313-4131-8131-131313131313'), 0::bigint);
  perform wtc_test.eq('QA-0928-124 ... and reports nothing stored', (r->>'synced')::int, 0);
  perform sync_user_batch('14141414-1414-4141-8141-141414141414', '[]'::jsonb, '[]'::jsonb, '{"sharing_enabled":true}'::jsonb);
  perform wtc_test.eq('QA-0928-39 a profile-only call still records the opt-in',
    (select sharing_enabled from users where anonymous_id = '14141414-1414-4141-8141-141414141414'), true);
exception when others then perform wtc_test.check('QA-0928-124 nothing to store', false, sqlerrm);
end $$;

-- ── Turns the CLI leaves unpriced (user X; orchestrator ruling, contract A) ──
-- An unanchored turn on a model the rate sheet can't price is 'excluded' by the
-- CLI (turnCostBasis): it goes up with cost_estimate_usd NULL, adds $0, and the
-- session summary counts it in excluded_turns (optional; only a number counts).
-- A $0 session with excluded turns is never labelled billing-grade.
create or replace function wtc_test.with_excluded(p_session jsonb, p_excluded jsonb)
returns jsonb language sql as $$
  select jsonb_set(p_session, '{summary,excluded_turns}', p_excluded);
$$;

do $$
declare r jsonb; s sessions; u uuid; v_id text := '15151515-1515-4151-8151-151515151515';
        v_x jsonb := '{"model":"partner.unknown-model-v1"}';
        v_a0 jsonb := '{"cumulative_cost_usd":12.5}';  -- makes a $0 cost_usd a real anchor
begin
  -- Every turn excluded: stored with no estimate; the session is an estimate at $0.
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.with_excluded(
    wtc_test.session('x-all', wtc_test.turns(1, 2, '2026-03-07 09:00Z', null, v_x)), '2')), '[]'::jsonb);
  u := wtc_test.user_id(v_id);
  s := wtc_test.session_row(v_id, 'x-all');
  perform wtc_test.eq('ruling: excluded turns are stored with no estimate',
    (select count(cost_estimate_usd) from turns where session_id = s.id), 0::bigint);
  perform wtc_test.eq('ruling: an all-excluded session costs $0', s.estimated_cost_usd, 0::numeric);
  perform wtc_test.eq('ruling: an all-excluded $0 session is an estimate, not billing-grade', s.cost_basis, 'estimate');
  perform wtc_test.eq('ruling: its day adds $0',
    (select estimated_cost_usd from daily_summaries where user_id = u and date = '2026-03-07'), 0::numeric);
  r := sync_user_batch(v_id, jsonb_build_array(wtc_test.with_excluded(
    wtc_test.session('x-all', wtc_test.turns(1, 2, '2026-03-07 09:00Z', null, v_x)), '2')), '[]'::jsonb);
  perform wtc_test.eq('ruling: re-sending an excluded turn (still no estimate) fills nothing', (r->>'turns_updated')::int, 0);

  -- The excluded turns haven't arrived yet (a later chunk): the stored turn is a
  -- real $0 anchor (with a cumulative cost), so the stored turns alone would read
  -- billing-grade.
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.with_excluded(
    wtc_test.session('x-chunk', wtc_test.turns(1, 1, '2026-03-07 10:00Z', 0, v_a0)), '3')), '[]'::jsonb);
  perform wtc_test.eq('ruling: summary.excluded_turns > 0 at $0 is an estimate, not billing-grade',
    (wtc_test.session_row(v_id, 'x-chunk')).cost_basis, 'estimate');
  -- A session entry with no turns at all, and the summary saying some are excluded.
  perform sync_user_batch(v_id, jsonb_build_array(wtc_test.with_excluded(
    jsonb_build_object('session_id', 'x-none', 'turns', '[]'::jsonb,
      'summary', jsonb_build_object('cost', 0, 'anchored_cost', 0, 'estimated_cost', 0, 'turn_count', 2)), '2')), '[]'::jsonb);
  perform wtc_test.eq('ruling: no stored turns, excluded_turns 2, $0: estimate',
    (wtc_test.session_row(v_id, 'x-none')).cost_basis, 'estimate');

  -- excluded_turns is optional: absent, 0 or not a number leaves the label to the
  -- stored turns (and never fails the sync).
  perform sync_user_batch(v_id, jsonb_build_array(
    wtc_test.session('x-absent', wtc_test.turns(1, 1, '2026-03-07 11:00Z', 0, v_a0)),
    wtc_test.with_excluded(wtc_test.session('x-zero', wtc_test.turns(1, 1, '2026-03-07 11:10Z', 0, v_a0)), '0'),
    wtc_test.with_excluded(wtc_test.session('x-text', wtc_test.turns(1, 1, '2026-03-07 11:20Z', 0, v_a0)), '"abc"'),
    wtc_test.with_excluded(wtc_test.session('x-obj',  wtc_test.turns(1, 1, '2026-03-07 11:30Z', 0, v_a0)), '{"n":1}')),
    '[]'::jsonb);
  perform wtc_test.eq('ruling: no excluded_turns key (older CLI): label from the stored turns',
    (wtc_test.session_row(v_id, 'x-absent')).cost_basis, 'billing-grade');
  perform wtc_test.eq('ruling: excluded_turns 0: label from the stored turns',
    (wtc_test.session_row(v_id, 'x-zero')).cost_basis, 'billing-grade');
  perform wtc_test.eq('ruling: a non-numeric excluded_turns is ignored (string)',
    (wtc_test.session_row(v_id, 'x-text')).cost_basis, 'billing-grade');
  perform wtc_test.eq('ruling: a non-numeric excluded_turns is ignored (object)',
    (wtc_test.session_row(v_id, 'x-obj')).cost_basis, 'billing-grade');
exception when others then perform wtc_test.check('ruling: excluded turns', false, sqlerrm);
end $$;

-- ── Old client sending a raw branch name (user D) ───────────────────────────
do $$
declare s sessions;
begin
  perform sync_user_batch('44444444-4444-4444-8444-444444444444',
    jsonb_build_array(wtc_test.session('d-raw', wtc_test.turns(1, 3, '2026-03-05 10:00Z', 0.01, '{"git_branch":"main"}'))),
    '[]'::jsonb);
  s := wtc_test.session_row('44444444-4444-4444-8444-444444444444', 'd-raw');
  perform wtc_test.eq('decision-1: a raw branch from an old client is not stored (turns)',
    (select count(*) from turns where session_id = s.id and git_branch is not null), 0::bigint);
  perform wtc_test.eq('decision-1: a raw branch from an old client is not stored (session)', s.git_branch, null::text);
exception when others then perform wtc_test.check('decision-1 raw branch from old client', false, sqlerrm);
end $$;

-- ── Profile flag semantics (user B) ─────────────────────────────────────────
do $$
declare v_id text := '22222222-2222-4222-8222-222222222222';
begin
  perform sync_user_batch(v_id, '[]'::jsonb, '[]'::jsonb, '{"sharing_enabled":false}'::jsonb);
  perform wtc_test.eq('QA-0928-39 {sharing_enabled:false} withdraws the opt-in',
    (select sharing_enabled from users where anonymous_id = v_id), false);
  perform sync_user_batch(v_id, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);
  perform wtc_test.eq('QA-0928-39 no profile key leaves the flag alone',
    (select sharing_enabled from users where anonymous_id = v_id), false);
  perform sync_user_batch(v_id, '[]'::jsonb, '[]'::jsonb, '{"sharing_enabled":true}'::jsonb);
  perform sync_user_batch(v_id, '[]'::jsonb, '[]'::jsonb, '{"sharing_enabled":"no"}'::jsonb);
  perform wtc_test.eq('QA-0928-39 a non-boolean flag is ignored',
    (select sharing_enabled from users where anonymous_id = v_id), true);
  perform sync_user_batch(v_id, '[]'::jsonb, '[]'::jsonb);
  perform sync_user_batch(v_id, '[]'::jsonb);
  perform wtc_test.eq('compat: 3-arg and 2-arg calls still resolve and leave the flag alone',
    (select sharing_enabled from users where anonymous_id = v_id), true);
exception when others then perform wtc_test.check('QA-0928-39 profile', false, sqlerrm);
end $$;

-- ── Non-UUID anonymous id ───────────────────────────────────────────────────
do $$
declare refused boolean := false;
begin
  begin
    perform sync_user_batch('x', '[]'::jsonb, '[]'::jsonb);
  exception when others then refused := true;
  end;
  perform wtc_test.eq('QA-0928-124 sync_user_batch refuses a non-UUID id', refused, true);
  perform wtc_test.eq('QA-0928-124 no users row for a non-UUID id',
    (select count(*) from users where anonymous_id = 'x'), 0::bigint);
exception when others then perform wtc_test.check('QA-0928-124 non-UUID id', false, sqlerrm);
end $$;

-- ── A re-send fills in what a stored row lacks, and nothing else (user E) ───
do $$
declare r jsonb; u uuid; v_id text := '55555555-5555-4555-8555-555555555555';
begin
  perform sync_user_batch(v_id,
    jsonb_build_array(wtc_test.session('e-1', wtc_test.turns(1, 3, '2026-03-06 10:00Z', null))), '[]'::jsonb);
  r := sync_user_batch(v_id,
    jsonb_build_array(wtc_test.session('e-1', wtc_test.turns(1, 3, '2026-03-06 10:00Z', null,
      '{"cost_estimate_usd":0.02,"git_branch":"#bbbbbbbbbbbb"}'))), '[]'::jsonb);
  u := wtc_test.user_id(v_id);
  perform wtc_test.eq('heal: re-send inserts no turn', (r->>'turns_inserted')::int, 0);
  perform wtc_test.eq('heal: re-send fills 3 stored turns', (r->>'turns_updated')::int, 3);
  perform wtc_test.eq('heal: estimates filled', (select sum(cost_estimate_usd) from turns where user_id = u), 0.06::numeric);
  perform wtc_test.eq('heal: hashed branch filled', (select count(*) from turns where user_id = u and git_branch = '#bbbbbbbbbbbb'), 3::bigint);
  perform wtc_test.eq('heal: daily estimate follows',
    (select estimated_only_cost_usd from daily_summaries where user_id = u and date = '2026-03-06'), 0.06::numeric);
  r := sync_user_batch(v_id,
    jsonb_build_array(wtc_test.session('e-1', wtc_test.turns(1, 3, '2026-03-06 10:00Z', null,
      '{"cost_estimate_usd":0.99,"git_branch":"#cccccccccccc"}'))), '[]'::jsonb);
  perform wtc_test.eq('heal: a stored value is never overwritten (count)', (r->>'turns_updated')::int, 0);
  perform wtc_test.eq('heal: a stored estimate is never overwritten', (select sum(cost_estimate_usd) from turns where user_id = u), 0.06::numeric);
  perform wtc_test.eq('heal: a stored branch is never overwritten', (select count(*) from turns where user_id = u and git_branch = '#bbbbbbbbbbbb'), 3::bigint);
  perform sync_user_batch(v_id,
    jsonb_build_array(wtc_test.session('e-2', wtc_test.turns(1, 2, '2026-03-06 11:00Z', 0.03, '{"cost_estimate_usd":0.5}'))), '[]'::jsonb);
  perform wtc_test.eq('contract A: an anchored turn keeps no estimate',
    (select count(cost_estimate_usd) from turns t join sessions s on s.id = t.session_id where s.user_id = u and s.session_id = 'e-2'), 0::bigint);
exception when others then perform wtc_test.check('heal on re-send', false, sqlerrm);
end $$;

-- ── Local days, windows, sessions, sparks, rate limits (users F, G) ─────────
-- F's turns (UTC → America/New_York EDT (DST from 03-08) / Asia/Tokyo):
--   f-mid      #1 03-09 14:59Z $0.20 → NY 03-09 10:59 Mon · TYO 03-09 23:59 Mon
--              #2 03-10 02:30Z $0.10 → NY 03-09 22:30 Mon · TYO 03-10 11:30 Tue
--              #3 03-10 15:00Z $0.05 → NY 03-10 11:00 Tue · TYO 03-11 00:00 Wed
--   f-straddle #1 03-08 20:00Z $1.00 → NY 03-08 16:00 Sun · TYO 03-09 05:00 Mon
--              #2 03-10 16:00Z $0.25 → NY 03-10 12:00 Tue · TYO 03-11 01:00 Wed
--   f-est      #1 03-11 04:00Z est $0.40 (no anchor) → NY 03-11 00:00 Wed · TYO 03-11 13:00 Wed
do $$
begin
  perform sync_user_batch('66666666-6666-4666-8666-666666666666', jsonb_build_array(
    wtc_test.session('f-mid', jsonb_build_array(
      wtc_test.turn(1, '2026-03-09 14:59Z', 0.20), wtc_test.turn(2, '2026-03-10 02:30Z', 0.10),
      wtc_test.turn(3, '2026-03-10 15:00Z', 0.05))),
    wtc_test.session('f-straddle', jsonb_build_array(
      wtc_test.turn(1, '2026-03-08 20:00Z', 1.00), wtc_test.turn(2, '2026-03-10 16:00Z', 0.25))),
    wtc_test.session('f-est', jsonb_build_array(
      wtc_test.turn(1, '2026-03-11 04:00Z', null, '{"cost_estimate_usd":0.40}')))), '[]'::jsonb);
  -- G: a 1,733-turn session (past PostgREST's 1,000-row cap) with an old snapshot on every turn,
  -- then a later, shorter session whose last snapshot is the true latest; a
  -- final turn with no snapshot is the latest activity.
  perform sync_user_batch('77777777-7777-4777-8777-777777777777', jsonb_build_array(
    wtc_test.session('g-long',
      wtc_test.turns(1, 1732, '2026-03-10 05:00Z', 0.001,
        '{"rate_limit_5h_pct":43,"rate_limit_7d_pct":6,"rate_limit_5h_resets_at":1773190800,"rate_limit_7d_resets_at":1773700000}')
      || jsonb_build_array(wtc_test.turn(1733, '2026-03-11 09:52Z', 0.5,
        '{"rate_limit_5h_pct":43,"rate_limit_7d_pct":6,"rate_limit_5h_resets_at":1773190800,"rate_limit_7d_resets_at":1773700000}'))),
    wtc_test.session('g-short',
      wtc_test.turns(1, 30, '2026-03-12 10:00Z', 0.002,
        '{"rate_limit_5h_pct":2,"rate_limit_7d_pct":7,"rate_limit_5h_resets_at":1773320400,"rate_limit_7d_resets_at":1773700000}')
      || jsonb_build_array(wtc_test.turn(31, '2026-03-12 10:30Z', 0.002)))), '[]'::jsonb);
exception when others then perform wtc_test.check('fixture F/G', false, sqlerrm);
end $$;

do $$
declare j jsonb; u uuid := wtc_test.user_id('66666666-6666-4666-8666-666666666666');
begin
  j := dashboard_local(u, '2026-03-10', 'America/New_York');
  perform wtc_test.eq('contract B: meta tz echoes a valid zone', j->>'tz', 'America/New_York');
  perform wtc_test.eq('contract B: window_start', j->>'window_start', '2026-03-10');
  perform wtc_test.eq('QA-0928-32 NY window from 03-10 local: 2 local days', jsonb_array_length(j->'daily_local'), 2);
  perform wtc_test.eq('QA-0928-32 NY 03-10 total_usd', (wtc_test.day(j->'daily_local', '2026-03-10')->>'total_usd')::numeric, 0.30);
  perform wtc_test.eq('QA-0928-32 NY 03-10 turn_count', (wtc_test.day(j->'daily_local', '2026-03-10')->>'turn_count')::int, 2);
  perform wtc_test.eq('QA-0928-32 NY 03-10 session_count', (wtc_test.day(j->'daily_local', '2026-03-10')->>'session_count')::int, 2);
  perform wtc_test.eq('QA-0928-34 NY 03-11 estimate_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'estimate_usd')::numeric, 0.40);
  perform wtc_test.eq('QA-0928-34 NY 03-11 anchored_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'anchored_usd')::numeric, 0);
  perform wtc_test.eq('QA-0928-34 NY 03-11 total_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'total_usd')::numeric, 0.40);
  perform wtc_test.eq('contract B: daily_local models_used',
    wtc_test.day(j->'daily_local', '2026-03-10')->'models_used', '{"claude-sonnet-4-6": 2}'::jsonb);

  -- QA-0928-33: the straddling session is listed, with only its in-window spend.
  perform wtc_test.eq('QA-0928-33 NY window lists 3 sessions (incl. the straddler)', jsonb_array_length(j->'sessions'), 3);
  perform wtc_test.eq('QA-0928-33 straddler window_total_usd = in-window turns only',
    (wtc_test.sess(j->'sessions', 'f-straddle')->>'window_total_usd')::numeric, 0.25);
  perform wtc_test.eq('QA-0928-33 straddler started_before_window',
    (wtc_test.sess(j->'sessions', 'f-straddle')->>'started_before_window')::boolean, true);
  perform wtc_test.eq('QA-0928-33 straddler keeps its whole-session total',
    (wtc_test.sess(j->'sessions', 'f-straddle')->>'estimated_cost_usd')::numeric, 1.25);
  perform wtc_test.eq('QA-0928-33 in-window session not flagged',
    (wtc_test.sess(j->'sessions', 'f-est')->>'started_before_window')::boolean, false);
  perform wtc_test.eq('QA-0928-33 estimate-only session window_total_usd',
    (wtc_test.sess(j->'sessions', 'f-est')->>'window_total_usd')::numeric, 0.40);
  perform wtc_test.eq('QA-0928-33 sessions window totals = daily_local totals',
    (select sum((e->>'window_total_usd')::numeric) from jsonb_array_elements(j->'sessions') e),
    (select sum((e->>'total_usd')::numeric) from jsonb_array_elements(j->'daily_local') e));

  -- QA-0928-29: hour-of-week buckets from turns in local time.
  perform wtc_test.eq('QA-0928-29 NY hourly buckets', j->'hourly_local',
    '[{"dow":2,"hour":11,"total_usd":0.050000,"anchored_usd":0.050000,"estimate_usd":0,"turn_count":1},
      {"dow":2,"hour":12,"total_usd":0.250000,"anchored_usd":0.250000,"estimate_usd":0,"turn_count":1},
      {"dow":3,"hour":0,"total_usd":0.400000,"anchored_usd":0,"estimate_usd":0.400000,"turn_count":1}]'::jsonb);
exception when others then perform wtc_test.check('contract B NY window', false, sqlerrm);
end $$;

do $$
declare j jsonb; u uuid := wtc_test.user_id('66666666-6666-4666-8666-666666666666');
begin
  -- QA-0928-32: the 22:30 EDT turn belongs to NY's 03-09, not UTC's 03-10.
  j := dashboard_daily_local(u, '2026-03-09', 'America/New_York');
  perform wtc_test.eq('QA-0928-32 22:30 EDT turn counts on the NY local day 03-09',
    (wtc_test.day(j, '2026-03-09')->>'total_usd')::numeric, 0.30);
  perform wtc_test.eq('QA-0928-32 (the UTC table puts it on 03-10)',
    (select sum(estimated_cost_usd) from daily_summaries where user_id = u and date = '2026-03-09'), 0.20::numeric);

  -- Tokyo: the window starts 2026-03-09 15:00Z, one minute after f-mid #1.
  j := dashboard_local(u, '2026-03-10', 'Asia/Tokyo');
  perform wtc_test.eq('QA-0928-32 Tokyo window: no 03-09 row (14:59Z is 23:59 JST the day before)',
    wtc_test.day(j->'daily_local', '2026-03-09'), null::jsonb);
  perform wtc_test.eq('QA-0928-32 Tokyo 03-10 total_usd', (wtc_test.day(j->'daily_local', '2026-03-10')->>'total_usd')::numeric, 0.10);
  perform wtc_test.eq('QA-0928-32 Tokyo 03-11 anchored_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'anchored_usd')::numeric, 0.30);
  perform wtc_test.eq('QA-0928-32 Tokyo 03-11 estimate_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'estimate_usd')::numeric, 0.40);
  perform wtc_test.eq('QA-0928-32 Tokyo 03-11 total_usd', (wtc_test.day(j->'daily_local', '2026-03-11')->>'total_usd')::numeric, 0.70);
  perform wtc_test.eq('QA-0928-32 Tokyo 03-11 session_count', (wtc_test.day(j->'daily_local', '2026-03-11')->>'session_count')::int, 3);
  perform wtc_test.eq('QA-0928-29 Tokyo Wed 00:00 bucket',
    (select (e->>'total_usd')::numeric from jsonb_array_elements(j->'hourly_local') e where e->>'dow' = '3' and e->>'hour' = '0'), 0.05);

  -- An unknown or non-IANA zone falls back to UTC (and the payload says so).
  perform wtc_test.eq('contract B: invalid tz -> UTC', dashboard_local(u, '2026-03-10', 'Not/AZone')->>'tz', 'UTC');
  perform wtc_test.eq('contract B: offset string -> UTC', dashboard_local(u, '2026-03-10', '+05:00')->>'tz', 'UTC');
  perform wtc_test.eq('contract B: POSIX string -> UTC', dashboard_local(u, '2026-03-10', 'XYZ+5')->>'tz', 'UTC');
  perform wtc_test.eq('contract B: missing tz -> UTC', dashboard_local(u, '2026-03-10', null)->>'tz', 'UTC');
  j := dashboard_local(u, '2026-03-10', 'UTC');
  perform wtc_test.eq('contract B: UTC 03-10 total_usd', (wtc_test.day(j->'daily_local', '2026-03-10')->>'total_usd')::numeric, 0.40);
exception when others then perform wtc_test.check('contract B local days', false, sqlerrm);
end $$;

do $$
declare j jsonb; u uuid := wtc_test.user_id('77777777-7777-4777-8777-777777777777'); v_long text; v_short text;
begin
  j := dashboard_local(u, '2026-03-10', 'UTC');
  v_long  := (wtc_test.session_row('77777777-7777-4777-8777-777777777777', 'g-long')).id::text;
  v_short := (wtc_test.session_row('77777777-7777-4777-8777-777777777777', 'g-short')).id::text;
  perform wtc_test.eq('QA-0928-31 1,733-turn session spark = last 60 turns', jsonb_array_length(j->'sparks'->v_long->'cost'), 60);
  perform wtc_test.eq('QA-0928-31 token spark = last 60 turns', jsonb_array_length(j->'sparks'->v_long->'tok'), 60);
  perform wtc_test.eq('QA-0928-31 spark ends at the session''s last turn', (j->'sparks'->v_long->'cost'->>59)::numeric, 0.5);
  perform wtc_test.eq('QA-0928-31 short session spark = all 31 turns', jsonb_array_length(j->'sparks'->v_short->'cost'), 31);
  perform wtc_test.eq('QA-0928-31 rate_limits from the truly latest snapshot (time, not turn number)',
    j->'rate_limits'->>'captured_at', '2026-03-12T10:29:00+00:00');
  perform wtc_test.eq('QA-0928-31 latest 5h reading', (j->'rate_limits'->'five_hour'->>'used_percentage')::numeric, 2);
  perform wtc_test.eq('QA-0928-31 latest 7d reading', (j->'rate_limits'->'seven_day'->>'used_percentage')::numeric, 7);
  perform wtc_test.eq('QA-0928-127 last_activity_at = newest stored turn', (j->>'last_activity_at')::timestamptz, '2026-03-12 10:30Z'::timestamptz);
  perform wtc_test.eq('QA-0928-127 total_sessions', (j->>'total_sessions')::int, 2);
  perform wtc_test.eq('QA-0928-26 first_activity_at = oldest stored turn', (j->>'first_activity_at')::timestamptz, '2026-03-10 05:00Z'::timestamptz);
  j := dashboard_local(u, '2026-03-12', 'UTC');
  perform wtc_test.eq('QA-0928-26 first_activity_at is from any window, not the requested one',
    (j->>'first_activity_at')::timestamptz, '2026-03-10 05:00Z'::timestamptz);
  j := dashboard_local(u, '2026-04-01', 'UTC');
  perform wtc_test.eq('QA-0928-127 an empty window still says when the cloud last saw activity',
    (j->>'last_activity_at')::timestamptz, '2026-03-12 10:30Z'::timestamptz);
  perform wtc_test.eq('QA-0928-31 an empty window still carries the latest limit reading',
    (j->'rate_limits'->'five_hour'->>'used_percentage')::numeric, 2);
  perform wtc_test.eq('empty window: no sessions', jsonb_array_length(j->'sessions'), 0);
  perform wtc_test.eq('QA-0928-26 an empty window still says when tracking began',
    (j->>'first_activity_at')::timestamptz, '2026-03-10 05:00Z'::timestamptz);
  -- A user with no stored turn (a profile-only sync): first/last activity are null.
  j := dashboard_local(wtc_test.user_id('14141414-1414-4141-8141-141414141414'), '2026-03-10', 'UTC');
  perform wtc_test.eq('QA-0928-26 no stored turn: first_activity_at is null', j->'first_activity_at', 'null'::jsonb);
  perform wtc_test.eq('QA-0928-127 no stored turn: last_activity_at is null', j->'last_activity_at', 'null'::jsonb);
exception when others then perform wtc_test.check('contract B sparks/rate limits', false, sqlerrm);
end $$;

-- ── The limit gauge reads like `wtclaude limit` (users W, K1-K5) ────────────
-- QA-0928-61 (RC 0.3.2): the CLI's rule (src/utils/sessions.js latestRateLimit),
-- per limit on its own: the newest window (the latest resets_at) and the highest
-- percentage any row reported for it, a reset within 5 minutes counting as the
-- same window; with no reset time on any row, the newest row's percentage.
-- captured_at is the newest row with either reading. The newest row by time is
-- NOT the reading: a lagging concurrent session's newer row can carry an older,
-- lower one. W is the web stream's fixture (web/src/lib/rateLimits.test.js pins
-- the same rows to the CLI at 33% / 48%); newest-by-time read 32% / 9% there.
do $$
declare
  r5 timestamptz := '2026-09-28 15:10:00Z'; r7 timestamptz := '2026-10-04 23:00:00Z';
begin
  perform sync_user_batch('19191919-1919-4191-8191-191919191919', jsonb_build_array(
    wtc_test.session('w-lead', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 13:40:00Z', 0.01, wtc_test.rl(33, r5, 12, r7)),
      wtc_test.turn(2, '2026-09-28 13:42:25Z', 0.01, wtc_test.rl(33, r5, 48, r7)))),
    wtc_test.session('w-lag', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 13:42:27Z', 0.01, wtc_test.rl(32, '2026-09-28 15:10:30Z', 9, '2026-09-28 01:00:00Z')),
      wtc_test.turn(2, '2026-09-28 13:43:00Z', 0.01)))), '[]'::jsonb);
  -- K1: no reset time on any row → the newest row's reading, reset unknown.
  perform sync_user_batch('20202020-2020-4202-8202-202020202020', jsonb_build_array(
    wtc_test.session('k1', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 10:00Z', 0.01, wtc_test.rl(40, null, 70, null)),
      wtc_test.turn(2, '2026-09-28 10:05Z', 0.01, wtc_test.rl(20, null, 65, null))))), '[]'::jsonb);
  -- K2: 5-hour readings only; the newer one has no reset time, so it is not in
  -- the newest window.
  perform sync_user_batch('21212121-2121-4212-8212-212121212121', jsonb_build_array(
    wtc_test.session('k2', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 09:00Z', 0.01, wtc_test.rl(50, r5, null, null)),
      wtc_test.turn(2, '2026-09-28 09:10Z', 0.01, wtc_test.rl(70, null, null, null))))), '[]'::jsonb);
  -- K3: the 5-minute edge. 5 min before the newest reset is the same window,
  -- 5 min 1 s is not; of two rows with the top reading, the earlier one's reset.
  -- 7-day: every row is in the newest window and the top one is not the newest.
  perform sync_user_batch('23232323-2323-4232-8232-232323232323', jsonb_build_array(
    wtc_test.session('k3', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 11:00Z', 0.01, wtc_test.rl(90, r5 - interval '301 seconds', 40, r7)),
      wtc_test.turn(2, '2026-09-28 11:01Z', 0.01, wtc_test.rl(60, r5 - interval '300 seconds', 45, r7 - interval '60 seconds')),
      wtc_test.turn(3, '2026-09-28 11:02Z', 0.01, wtc_test.rl(60, r5 - interval '120 seconds', 44, r7)),
      wtc_test.turn(4, '2026-09-28 11:03Z', 0.01, wtc_test.rl(10, r5, 41, r7 + interval '30 seconds'))))), '[]'::jsonb);
  -- K4: resets_at 0 is no reset time (the CLI's normalizeResetsAt), not 1970.
  perform sync_user_batch('24242424-2424-4242-8242-242424242424', jsonb_build_array(
    wtc_test.session('k4', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 10:00Z', 0.01, wtc_test.rl(80, 'epoch', 80, 'epoch')),
      wtc_test.turn(2, '2026-09-28 10:05Z', 0.01, wtc_test.rl(30, 'epoch', 30, 'epoch'))))), '[]'::jsonb);
  -- K5: a stored 'NaN' is no reading (the CLI skips a non-finite %); it never
  -- reaches the payload (jsonb would carry it as the string "NaN").
  perform sync_user_batch('25252525-2525-4252-8252-252525252525', jsonb_build_array(
    wtc_test.session('k5', jsonb_build_array(
      wtc_test.turn(1, '2026-09-28 10:00Z', 0.01, wtc_test.rl(25, r5, 5, null)),
      wtc_test.turn(2, '2026-09-28 10:01Z', 0.01,
        wtc_test.rl(null, r5, null, null) || '{"rate_limit_5h_pct":"NaN","rate_limit_7d_pct":"NaN"}'::jsonb)))), '[]'::jsonb);
exception when others then perform wtc_test.check('fixture W/K', false, sqlerrm);
end $$;

do $$
declare
  u uuid := wtc_test.user_id('19191919-1919-4191-8191-191919191919'); j jsonb; t turns;
  r5 timestamptz := '2026-09-28 15:10:00Z';
begin
  -- The fixture really separates the two rules: the newest row with a reading
  -- is the lagging session's.
  select * into t from turns where user_id = u and (rate_limit_5h_pct is not null or rate_limit_7d_pct is not null)
   order by "timestamp" desc limit 1;
  perform wtc_test.eq('QA-0928-61 fixture W: newest row by time reads 32% / 9%',
    array[t.rate_limit_5h_pct, t.rate_limit_7d_pct], array[32, 9]::numeric[]);
  j := dashboard_rate_limits(u);
  perform wtc_test.eq('QA-0928-61 W: 5h = the highest reading in the newest window (33%, not 32%)',
    (j->'five_hour'->>'used_percentage')::numeric, 33);
  perform wtc_test.eq('QA-0928-61 W: 5h resets_at comes from the row that reported it',
    (j->'five_hour'->>'resets_at')::timestamptz, r5);
  perform wtc_test.eq('QA-0928-61 W: 7d = the newest window''s highest (48%, not the lagging 9%)',
    (j->'seven_day'->>'used_percentage')::numeric, 48);
  perform wtc_test.eq('QA-0928-61 W: 7d resets_at is the newest window',
    (j->'seven_day'->>'resets_at')::timestamptz, '2026-10-04 23:00Z'::timestamptz);
  perform wtc_test.eq('QA-0928-61 W: captured_at = the newest row with a reading (not the later turn without one)',
    (j->>'captured_at')::timestamptz, '2026-09-28 13:42:27Z'::timestamptz);
  perform wtc_test.eq('QA-0928-61 W: source', j->>'source', 'payload');
  perform wtc_test.eq('QA-0928-61 W: get-dashboard''s dashboard_local carries this reading',
    dashboard_local(u, '2026-09-01', 'UTC')->'rate_limits', j);
exception when others then perform wtc_test.check('QA-0928-61 limit gauge rule (W)', false, sqlerrm);
end $$;

do $$
declare j jsonb; r5 timestamptz := '2026-09-28 15:10:00Z';
begin
  j := dashboard_rate_limits(wtc_test.user_id('20202020-2020-4202-8202-202020202020'));
  perform wtc_test.eq('QA-0928-61 K1: no reset times → the newest row''s readings',
    array[(j->'five_hour'->>'used_percentage')::numeric, (j->'seven_day'->>'used_percentage')::numeric], array[20, 65]::numeric[]);
  perform wtc_test.eq('QA-0928-61 K1: reset time unknown stays null',
    array[j->'five_hour'->'resets_at', j->'seven_day'->'resets_at'], array['null'::jsonb, 'null'::jsonb]);

  j := dashboard_rate_limits(wtc_test.user_id('21212121-2121-4212-8212-212121212121'));
  perform wtc_test.eq('QA-0928-61 K2: a row without a reset time is outside the newest window',
    (j->'five_hour'->>'used_percentage')::numeric, 50);
  perform wtc_test.eq('QA-0928-61 K2: K2 5h resets_at', (j->'five_hour'->>'resets_at')::timestamptz, r5);
  perform wtc_test.eq('QA-0928-61 K2: a limit with no reading stays null, never 0',
    j->'seven_day', '{"used_percentage": null, "resets_at": null}'::jsonb);

  j := dashboard_rate_limits(wtc_test.user_id('23232323-2323-4232-8232-232323232323'));
  perform wtc_test.eq('QA-0928-61 K3: a reset 5 min before the newest is the same window; 5 min 1 s is not',
    (j->'five_hour'->>'used_percentage')::numeric, 60);
  perform wtc_test.eq('QA-0928-61 K3: tied top readings → the earlier row''s reset',
    (j->'five_hour'->>'resets_at')::timestamptz, r5 - interval '300 seconds');
  perform wtc_test.eq('QA-0928-61 K3: 7d = the highest reading in the newest window (45%), not the newest row''s (41%)',
    (j->'seven_day'->>'used_percentage')::numeric, 45);
  perform wtc_test.eq('QA-0928-61 K3: 7d resets_at comes from the row that reported it',
    (j->'seven_day'->>'resets_at')::timestamptz, '2026-10-04 22:59:00Z'::timestamptz);

  j := dashboard_rate_limits(wtc_test.user_id('24242424-2424-4242-8242-242424242424'));
  perform wtc_test.eq('QA-0928-61 K4: resets_at 0 counts as unknown → the newest row''s readings',
    array[(j->'five_hour'->>'used_percentage')::numeric, (j->'seven_day'->>'used_percentage')::numeric], array[30, 30]::numeric[]);
  perform wtc_test.eq('QA-0928-61 K4: and its reset time is null, not 1970',
    array[j->'five_hour'->'resets_at', j->'seven_day'->'resets_at'], array['null'::jsonb, 'null'::jsonb]);
  perform wtc_test.eq('QA-0928-61 turns without any reading → rate_limits null',
    dashboard_rate_limits(wtc_test.user_id('66666666-6666-4666-8666-666666666666')), null::jsonb);
exception when others then perform wtc_test.check('QA-0928-61 limit gauge rule (K1-K4)', false, sqlerrm);
end $$;

do $$
declare j jsonb;
begin
  j := dashboard_rate_limits(wtc_test.user_id('25252525-2525-4252-8252-252525252525'));
  perform wtc_test.eq('QA-0928-61 K5: a NaN reading is skipped in the newest window',
    (j->'five_hour'->>'used_percentage')::numeric, 25);
  perform wtc_test.eq('QA-0928-61 K5: a NaN newest reading with no reset time reads as none (null)',
    j->'seven_day'->'used_percentage', 'null'::jsonb);
exception when others then perform wtc_test.check('QA-0928-61 limit gauge rule (K5)', false, sqlerrm);
end $$;

-- ── Leaderboard (users B, L1, L2) ───────────────────────────────────────────
do $$
declare j jsonb;
begin
  perform sync_user_batch('88888888-8888-4888-8888-888888888888',
    jsonb_build_array(wtc_test.session('l1', wtc_test.turns(1, 20, '2026-03-03 09:00Z', 0.01))),
    '[]'::jsonb, '{"sharing_enabled":true}'::jsonb);
  perform sync_user_batch('99999999-9999-4999-8999-999999999999',
    jsonb_build_array(wtc_test.session('l2', wtc_test.turns(1, 50, '2026-03-03 09:00Z', 0.01))),
    '[]'::jsonb, '{"sharing_enabled":false}'::jsonb);
  j := leaderboard_totals('2026-03-01', 10);
  perform wtc_test.eq('QA-0928-128 only opted-in users are ranked', jsonb_array_length(j), 2);
  perform wtc_test.eq('QA-0928-128 rank 1 = most tokens among opted-in',
    (j->0->>'user_id')::uuid, wtc_test.user_id('88888888-8888-4888-8888-888888888888'));
  perform wtc_test.eq('QA-0928-128 totals summed in SQL', (j->0->>'total_tokens')::bigint, 20 * 1160::bigint);
  perform wtc_test.eq('QA-0928-128 limit applies', jsonb_array_length(leaderboard_totals('2026-03-01', 1)), 1);
  perform wtc_test.eq('QA-0928-128 period start filters days', jsonb_array_length(leaderboard_totals('2026-04-01', 10)), 0);
exception when others then perform wtc_test.check('QA-0928-128 leaderboard', false, sqlerrm);
end $$;

-- ── Invariants over everything stored above ─────────────────────────────────
do $$
begin
  perform wtc_test.eq('invariant: no stored turn is a legacy $0 anchor (cost_usd 0, no cumulative cost)',
    (select count(*) from turns where cost_usd = 0 and cumulative_cost_usd is null), 0::bigint);
  perform wtc_test.eq('invariant: an anchored turn never carries an estimate',
    (select count(*) from turns where cost_usd is not null and cost_estimate_usd is not null), 0::bigint);
  perform wtc_test.eq('invariant: no session is billing-grade while it holds an unanchored turn',
    (select count(*) from sessions s where s.cost_basis = 'billing-grade'
        and exists (select 1 from turns t where t.session_id = s.id and t.cost_usd is null)), 0::bigint);
exception when others then perform wtc_test.check('invariants', false, sqlerrm);
end $$;

-- ── Phase-C: service_role only ──────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'sync_user_batch(text,jsonb,jsonb,jsonb)', 'recompute_daily_summaries(uuid)', 'dashboard_tz(text)',
    'dashboard_session_ids(uuid,date,text)', 'dashboard_daily_local(uuid,date,text)',
    'dashboard_hourly_local(uuid,date,text)', 'dashboard_sessions(uuid,date,text)',
    'dashboard_sparks(uuid,date,text,integer)', 'dashboard_rate_limits(uuid)',
    'dashboard_last_activity(uuid)', 'dashboard_first_activity(uuid)', 'dashboard_local(uuid,date,text)',
    'leaderboard_totals(date,integer)'] loop
    perform wtc_test.check('Phase-C grants: ' || f,
      not has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('authenticated', f, 'execute')
      and has_function_privilege('service_role', f, 'execute'));
  end loop;
  perform wtc_test.eq('only the 4-arg sync_user_batch exists',
    (select count(*) from pg_proc where proname = 'sync_user_batch'), 1::bigint);
exception when others then perform wtc_test.check('Phase-C grants', false, sqlerrm);
end $$;
