-- 009_sync_accuracy_local_days.sql
-- BUILD-018 (release 0.3.2) server fixes from the 2026-09-28 clickthrough QA:
--   • QA-0928-34 — daily totals dropped estimate-only turns and
--     estimated_only_cost_usd was always 0. Turns now carry cost_estimate_usd (the
--     CLI's list-rate estimate, sent only for a turn WITHOUT a cost_usd anchor);
--     daily anchored = sum(cost_usd), estimated_only = sum(cost_estimate_usd) over
--     unanchored turns, estimated_cost_usd (the total) = their sum.
--   • QA-0928-35 — session lines/durations were summed over the LAST request's
--     turns only (each chunk overwrote them) and a chunk without a branch/device
--     nulled the session's. Now recomputed from the session's STORED turns after
--     every insert; grouping attributes are the first non-null over those turns.
--   • QA-0928-203 — two concurrent first syncs for a new id failed on
--     users_anonymous_id_key. Get-or-create is now insert … on conflict do nothing,
--     and the user row is locked so one user's syncs run one at a time.
--   • QA-0928-204 — the RPC counted re-sent duplicates as synced. It now returns
--     inserted vs skipped counts for turns and badges.
--   • Orchestrator ruling (contract A amended, 2026-09-28) — a turn the CLI
--     excludes (unanchored, on a model its rate sheet can't price) goes up with
--     cost_estimate_usd NULL and adds $0; the session summary may carry
--     excluded_turns. A $0 session with excluded_turns > 0 is stored as
--     cost_basis 'estimate', never 'billing-grade' (008 labelled any $0 summary
--     billing-grade).
--   • QA-0928-39 — `share --enable/--disable` never reached the cloud. The RPC
--     takes p_profile and sets users.sharing_enabled when the key is present.
--   • QA-0928-124 — any string created a cloud user, and a request's summary
--     could rewrite a stored session's totals to any value. The RPC now refuses an
--     anonymous id that is not a UUID (the edge function answers 400 first),
--     creates no user for a call with nothing to store, and derives EVERY session
--     total (cost split, tokens, turn count, models, times, grouping attributes,
--     lines, durations) from the session's stored turns, which are insert-only.
--     Not built (Peter's decisions): per-id/IP rate limits, a per-install write
--     secret separate from the read id.
--   • Peter's decision 1 (2026-09-28) — sync sends a SALTED HASH of the git branch
--     ('#' + 12 hex), never the raw name. The RPC stores only that shape (an older
--     CLI's raw branch is dropped to NULL), and the one-off cleanup below nulls every
--     raw branch already stored.
--   • QA-0928-31/32/33/127/29 — SQL helpers behind get-dashboard's new fields
--     (contract B): local-day and hour-of-week buckets in the viewer's time zone,
--     sessions with any turn in the window plus their in-window totals, sparks with
--     no 1,000-row cap, the current rate-limit reading, last activity.
--   • QA-0928-61 (RC 0.3.2) — that rate-limit reading follows `wtclaude limit`'s
--     rule (the newest window's highest reading, per limit), not the newest row
--     by time, which a lagging concurrent session could pull a point or more low.
--   • QA-0928-26 — the user's first stored turn (any window), so /whatif can
--     project from the days since tracking began, as the CLI does.
--   • QA-0928-128 — leaderboard aggregation in SQL, opted-in users only.
--   • RC check (2026-09-28), legacy $0 anchors — the server half of QA-0928-52.
--     Collectors before 0.3.2 stored a payload with no cost block as cost_usd 0
--     with cumulative_cost_usd null, and the CLI now reads such a row as
--     unanchored (hasCostAnchor). The cloud follows the same rule with one
--     invariant: cost_usd is NULL for every unanchored turn. The RPC stores an
--     incoming 0-with-no-cumulative as NULL (0.3.1 clients keep sending it), the
--     one-off cleanup below un-anchors the rows already stored, and sessions that
--     claim billing-grade while holding such a turn are relabelled. The 0.3.2
--     re-send then fills the turn's estimate. Before this, the row kept its $0
--     anchor, every aggregate skipped the estimate, and the re-send was spent.
--     A branch fill also no longer writes an estimate onto an anchored turn.
--   • RC check (2026-09-28), session money precision — sessions.estimated_cost_usd
--     and daily_summaries.estimated_cost_usd were numeric(10,4), so an exact
--     12.344997 was stored as 12.3450 and shown a cent above the CLI. Both are
--     now numeric(12,6), like the turns and the anchored/estimated split.
--
-- Signature change: sync_user_batch(text, jsonb, jsonb) becomes
-- sync_user_batch(text, jsonb, jsonb default '[]', jsonb default '{}'). The 3-arg
-- version is dropped first (keeping both would make a 3-arg call ambiguous); the
-- defaults mean the deployed sync-data (which sends p_anonymous_id, p_sessions,
-- p_badges) still resolves to it, so the function redeploy can follow at any time.
-- The NEW edge functions (p_profile, dashboard_local, leaderboard_totals) need this
-- migration first.
--
-- Deploy ordering: AFTER 008. Idempotent; safe to re-run (the backfill and
-- cleanup converge, and the two columns are widened only once; a re-run changes
-- nothing). The widening rewrites sessions and daily_summaries under a brief
-- exclusive lock, once.
-- Deploy it (with the new sync-data) BEFORE the 0.3.2 npm publish. The 0.3.2
-- CLI re-sends the whole history once, and that re-send is what fills legacy
-- estimate-only turns and hashed branches; the 008 RPC keeps neither. Per the
-- orchestrator ruling the CLI holds that re-send (sync-state version < 2) until
-- a sync-data reply carries fills_missing with 'cost_estimate_usd', which only
-- this RPC behind the new sync-data returns, and syncs incrementally until
-- then, so a 0.3.2 sync that reaches 008 first no longer spends it.
-- PRIVACY: cost_estimate_usd is a number; git_branch is now only a salted hash.
-- Phase-C: unchanged — anon/authenticated get NO table or function access; every
-- function below is executable by service_role only (the edge functions).

-- ── (1) turns.cost_estimate_usd ──────────────────────────────────────────────
alter table turns add column if not exists cost_estimate_usd numeric(12,6);

-- The dashboard helpers read one user's turns by time; the rate-limit and
-- last-activity lookups read the newest first.
create index if not exists idx_turns_user_ts on turns(user_id, "timestamp");

-- Session and daily totals at 6 decimals, like the turns and the anchored /
-- estimated split columns (RC check: numeric(10,4) rounded 12.344997 to 12.3450,
-- a cent above the CLI's $12.34). Only when not already widened, so a re-run
-- neither rewrites nor locks the tables. No view depends on these columns in the
-- migrations; the deploy checklist checks the live project for one first.
do $$
begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.sessions'::regclass and attname = 'estimated_cost_usd') <> 'numeric(12,6)' then
    alter table sessions alter column estimated_cost_usd type numeric(12,6);
  end if;
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.daily_summaries'::regclass and attname = 'estimated_cost_usd') <> 'numeric(12,6)' then
    alter table daily_summaries alter column estimated_cost_usd type numeric(12,6);
  end if;
end $$;

-- ── Daily summaries (UTC days), shared by the RPC and the backfill ───────────
-- Full recompute of one user's rows, split by (date, usage_pool).
create or replace function recompute_daily_summaries(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  delete from daily_summaries where user_id = p_user_id;

  insert into daily_summaries (
    user_id, date, usage_pool,
    total_input_tokens, total_output_tokens, total_cache_read, total_cache_write,
    session_count, turn_count, models_used,
    estimated_cost_usd, anchored_cost_usd, estimated_only_cost_usd, fast_cost_usd,
    lines_added, lines_removed, duration_ms, api_duration_ms
  )
  with day_turns as (
    select
      (t."timestamp" at time zone 'UTC')::date as d,
      coalesce(t.usage_pool, 'interactive')  as pool,
      t.session_id, t.model, t.cost_usd, t.cost_estimate_usd, t.speed_tier,
      t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_write_tokens,
      t.lines_added, t.lines_removed, t.duration_ms, t.api_duration_ms
    from turns t
    where t.user_id = p_user_id
  ),
  models_agg as (
    select d, pool, jsonb_object_agg(coalesce(model, 'unknown'), cnt) as models
    from (
      select d, pool, model, count(*) as cnt from day_turns group by d, pool, model
    ) per_model
    group by d, pool
  )
  select
    p_user_id, dt.d, dt.pool,
    coalesce(sum(dt.input_tokens), 0), coalesce(sum(dt.output_tokens), 0),
    coalesce(sum(dt.cache_read_tokens), 0), coalesce(sum(dt.cache_write_tokens), 0),
    count(distinct dt.session_id), count(*),
    coalesce(ma.models, '{}'::jsonb),
    -- QA-0928-34: total = billing-grade anchor + the labelled estimate for
    -- unanchored turns (sum(cost_usd) alone skipped them).
    coalesce(sum(dt.cost_usd), 0)
      + coalesce(sum(dt.cost_estimate_usd) filter (where dt.cost_usd is null), 0),
    coalesce(sum(dt.cost_usd), 0),
    coalesce(sum(dt.cost_estimate_usd) filter (where dt.cost_usd is null), 0),
    coalesce(sum(dt.cost_usd) filter (where dt.speed_tier = 'fast'), 0),
    coalesce(sum(dt.lines_added), 0), coalesce(sum(dt.lines_removed), 0),
    coalesce(sum(dt.duration_ms), 0), coalesce(sum(dt.api_duration_ms), 0)
  from day_turns dt
  join models_agg ma on ma.d = dt.d and ma.pool = dt.pool
  group by dt.d, dt.pool, ma.models;
end;
$$;

-- ── (2) sync_user_batch ──────────────────────────────────────────────────────
drop function if exists sync_user_batch(text, jsonb);
drop function if exists sync_user_batch(text, jsonb, jsonb);

create or replace function sync_user_batch(
  p_anonymous_id text,
  p_sessions     jsonb,
  p_badges       jsonb default '[]'::jsonb,
  p_profile      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_user_id          uuid;
  v_session          jsonb;
  v_sum              jsonb;
  v_turns            jsonb;
  v_badge            jsonb;
  v_session_db_id    uuid;
  v_rows             int;
  v_ins              int;
  v_upd              int;
  v_session_count    int := 0;
  v_turns_received   int := 0;
  v_turns_inserted   int := 0;
  v_turns_updated    int := 0;
  v_badges_received  int := 0;
  v_badges_inserted  int := 0;
  v_excluded         numeric;
begin
  -- QA-0928-124: the CLI's id is always a UUID (randomUUID); anything else is not
  -- ours. The edge function answers 400 before this; this is the backstop.
  if p_anonymous_id is null
     or p_anonymous_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid anonymous ID' using errcode = '22023';
  end if;

  -- QA-0928-203: race-free get-or-create, then lock the row so two syncs for one
  -- user run one after the other (the daily recompute deletes and re-inserts the
  -- user's rows, which two concurrent recomputes would collide on).
  -- A call with nothing to store (no sessions, badges or profile flag) creates no
  -- user (QA-0928-124); for an unknown id v_user_id stays NULL and nothing runs.
  if coalesce(jsonb_array_length(p_sessions), 0) > 0
     or coalesce(jsonb_array_length(p_badges), 0) > 0
     or jsonb_typeof(coalesce(p_profile, '{}'::jsonb) -> 'sharing_enabled') = 'boolean' then
    insert into users(anonymous_id) values (p_anonymous_id) on conflict (anonymous_id) do nothing;
  end if;
  select id into v_user_id from users where anonymous_id = p_anonymous_id for update;

  -- QA-0928-39: the opt-in rides the sync; absent key = leave the flag alone.
  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb) -> 'sharing_enabled') = 'boolean' then
    update users set sharing_enabled = (p_profile ->> 'sharing_enabled')::boolean
     where id = v_user_id
       and sharing_enabled is distinct from (p_profile ->> 'sharing_enabled')::boolean;
  end if;

  for v_session in select jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) loop
    v_session_count := v_session_count + 1;
    v_sum   := coalesce(v_session->'summary', '{}'::jsonb);
    v_turns := coalesce(v_session->'turns', '[]'::jsonb);
    -- Turns the CLI leaves unpriced in this session (optional; a number or nothing).
    v_excluded := case when jsonb_typeof(v_sum->'excluded_turns') = 'number'
                       then (v_sum->>'excluded_turns')::numeric else 0 end;

    -- The row only; every total is derived from the stored turns below. The
    -- summary's times are used only while the session has no stored turn.
    insert into sessions (user_id, session_id, started_at, ended_at)
    values (v_user_id, v_session->>'session_id',
            (v_sum->>'started_at')::timestamptz, (v_sum->>'ended_at')::timestamptz)
    on conflict (user_id, session_id) do update set session_id = excluded.session_id
    returning id into v_session_db_id;

    -- turns: idempotent on (session_id, turn_number). A re-sent turn is never
    -- overwritten, except that a field the stored row LACKS is filled in: the
    -- estimate of an unanchored turn, and the hashed branch (rows synced before
    -- 009 had none, or had a raw name the cleanup nulled). cost_usd stays NULL
    -- when there is no billing-grade anchor; cost_estimate_usd is kept only then.
    -- The CLI's anchor rule (hasCostAnchor, QA-0928-52): cost_usd 0 with no
    -- cumulative cost is a pre-0.3.2 collector's "no cost block" row, not a figure
    -- Claude Code reported, so it is stored as NULL (a 0.3.1 client still sends
    -- it). A stored row can't tell an absent cumulative key from a null one; every
    -- collector since 0.1.0 writes the key, so both mean "no anchor" here. A fill
    -- never gives an anchored turn an estimate, and un-anchors a legacy $0 row
    -- the one-off cleanup below has not reached yet.
    -- A turn number repeated inside one request is taken once.
    v_turns_received := v_turns_received + jsonb_array_length(v_turns);
    with ins as (
      insert into turns (
        session_id, user_id, turn_number, "timestamp", model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cumulative_input, cumulative_output, cumulative_cache_read, cumulative_cache_write,
        used_percentage, cost_usd, cumulative_cost_usd, cost_estimate_usd, speed_tier, speed_tier_source,
        usage_pool, billing_basis, git_branch, project_hash, cost_center, device_id,
        task_category, edit_target_hash, lines_added, lines_removed, duration_ms, api_duration_ms,
        effort_level, thinking_enabled, exceeds_200k_tokens, cc_version,
        rate_limit_5h_pct, rate_limit_5h_resets_at, rate_limit_7d_pct, rate_limit_7d_resets_at
      )
      select
        v_session_db_id, v_user_id, (v->>'turn')::int, (v->>'ts')::timestamptz, v->>'model',
        coalesce((v->>'input_tokens')::int, 0), coalesce((v->>'output_tokens')::int, 0),
        coalesce((v->>'cache_read_tokens')::int, 0), coalesce((v->>'cache_write_tokens')::int, 0),
        coalesce((v->>'cumulative_input')::bigint, 0), coalesce((v->>'cumulative_output')::bigint, 0),
        coalesce((v->>'cumulative_cache_read')::bigint, 0), coalesce((v->>'cumulative_cache_write')::bigint, 0),
        (v->>'used_percentage')::numeric, c.cost_usd, (v->>'cumulative_cost_usd')::numeric,
        case when c.cost_usd is null then (v->>'cost_estimate_usd')::numeric end,
        v->>'speed_tier', v->>'speed_tier_source',
        v->>'usage_pool', v->>'billing_basis',
        case when v->>'git_branch' ~ '^#[0-9a-f]{12}$' then v->>'git_branch' end,
        v->>'project_hash',
        v->>'cost_center', v->>'device_id', v->>'task_category', v->>'edit_target_hash',
        (v->>'lines_added')::int, (v->>'lines_removed')::int,
        (v->>'duration_ms')::bigint, (v->>'api_duration_ms')::bigint,
        v->>'effort_level', (v->>'thinking_enabled')::boolean, (v->>'exceeds_200k_tokens')::boolean,
        v->>'cc_version',
        (v->>'rate_limit_5h_pct')::numeric, to_timestamp((v->>'rate_limit_5h_resets_at')::double precision),
        (v->>'rate_limit_7d_pct')::numeric, to_timestamp((v->>'rate_limit_7d_resets_at')::double precision)
      from (
        select distinct on ((e->>'turn')::int) e as v
        from jsonb_array_elements(v_turns) with ordinality as x(e, ord)
        order by (e->>'turn')::int, ord
      ) dedup
      cross join lateral (
        select case when (v->>'cost_usd')::numeric = 0 and v->>'cumulative_cost_usd' is null then null
                    else (v->>'cost_usd')::numeric end as cost_usd
      ) c
      on conflict (session_id, turn_number) do update set
        cost_usd = case when turns.cost_usd = 0 and turns.cumulative_cost_usd is null then null
                        else turns.cost_usd end,
        cost_estimate_usd = case when turns.cost_usd is null
                                   or (turns.cost_usd = 0 and turns.cumulative_cost_usd is null)
                                 then coalesce(turns.cost_estimate_usd, excluded.cost_estimate_usd)
                                 else turns.cost_estimate_usd end,
        git_branch = coalesce(turns.git_branch, excluded.git_branch)
      where ((turns.cost_usd is null or (turns.cost_usd = 0 and turns.cumulative_cost_usd is null))
             and turns.cost_estimate_usd is null and excluded.cost_estimate_usd is not null)
         or (turns.git_branch is null and excluded.git_branch is not null)
      returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted), count(*) filter (where not inserted)
      into v_ins, v_upd from ins;
    v_turns_inserted := v_turns_inserted + v_ins;
    v_turns_updated  := v_turns_updated + v_upd;

    -- Session totals over ALL the session's stored turns, never the request's
    -- summary or slice: lines and durations (QA-0928-35: each chunk overwrote them
    -- with its own), and cost, tokens, turn count, models, times and grouping
    -- attributes (QA-0928-124: any request could rewrite them). Stored turns are
    -- never overwritten (a re-send only fills missing fields), so a request can add
    -- to a session but not rewrite it. Like the CLI's summarizeTurns: total = the
    -- billing-grade anchor + the labelled estimate of unanchored turns; attributes
    -- are the first non-null by turn number, as one full send would give.
    update sessions s set
      started_at = coalesce(agg.first_ts, s.started_at), ended_at = coalesce(agg.last_ts, s.ended_at),
      total_input_tokens = agg.inp, total_output_tokens = agg.outp,
      total_cache_read = agg.cr, total_cache_write = agg.cw,
      models_used = coalesce(agg.models, '{}'::jsonb), turn_count = agg.n,
      estimated_cost_usd = agg.anchored + agg.estimate, anchored_cost_usd = agg.anchored,
      estimated_only_cost_usd = agg.estimate, fast_cost_usd = agg.fast, fast_turns = agg.fast_n,
      -- an unanchored turn without a stored estimate adds $0, so the turn counts
      -- (not only the dollar split) decide whether the session is billing-grade.
      -- A $0 session whose summary counts excluded turns (unpriced by the CLI,
      -- sent with no estimate) is an estimate, even before those turns arrive.
      cost_basis = case
        when v_excluded > 0 and agg.anchored + agg.estimate = 0 then 'estimate'
        when agg.n > 0 and agg.n_anchored = 0 then 'estimate'
        when agg.anchored + agg.estimate > 0 and agg.anchored / (agg.anchored + agg.estimate) < 0.01 then 'estimate'
        when agg.n > agg.n_anchored or agg.fast_n > 0 then 'mixed'
        else 'billing-grade' end,
      project_hash = coalesce(agg.project_hash, s.project_hash),
      git_branch = coalesce(agg.git_branch, s.git_branch),
      cost_center = coalesce(agg.cost_center, s.cost_center),
      device_id = coalesce(agg.device_id, s.device_id),
      lines_added = agg.la, lines_removed = agg.lr,
      duration_ms = agg.dur, api_duration_ms = agg.api
    from (
      select count(*)::int as n, count(t.cost_usd)::int as n_anchored,
             min(t."timestamp") as first_ts, max(t."timestamp") as last_ts,
             coalesce(sum(t.input_tokens), 0) as inp, coalesce(sum(t.output_tokens), 0) as outp,
             coalesce(sum(t.cache_read_tokens), 0) as cr, coalesce(sum(t.cache_write_tokens), 0) as cw,
             coalesce(sum(t.cost_usd), 0) as anchored,
             coalesce(sum(t.cost_estimate_usd) filter (where t.cost_usd is null), 0) as estimate,
             coalesce(sum(coalesce(t.cost_usd, t.cost_estimate_usd)) filter (where t.speed_tier = 'fast'), 0) as fast,
             count(*) filter (where t.speed_tier = 'fast')::int as fast_n,
             (select jsonb_object_agg(m, c) from (
                select coalesce(model, 'unknown') as m, count(*) as c
                from turns where session_id = v_session_db_id group by 1) per_model) as models,
             (array_agg(t.project_hash order by t.turn_number) filter (where t.project_hash is not null))[1] as project_hash,
             (array_agg(t.git_branch   order by t.turn_number) filter (where t.git_branch   is not null))[1] as git_branch,
             (array_agg(t.cost_center  order by t.turn_number) filter (where t.cost_center  is not null))[1] as cost_center,
             (array_agg(t.device_id    order by t.turn_number) filter (where t.device_id    is not null))[1] as device_id,
             coalesce(sum(t.lines_added), 0) as la, coalesce(sum(t.lines_removed), 0) as lr,
             coalesce(sum(t.duration_ms), 0) as dur, coalesce(sum(t.api_duration_ms), 0) as api
      from turns t where t.session_id = v_session_db_id
    ) agg
    where s.id = v_session_db_id;
  end loop;

  -- Earned badges (migration 008). Idempotent — earned_at is written once and kept.
  for v_badge in select jsonb_array_elements(coalesce(p_badges, '[]'::jsonb)) loop
    if coalesce(v_badge->>'badge_type', '') = '' then continue; end if;
    v_badges_received := v_badges_received + 1;
    insert into badges (user_id, badge_type, earned_at)
    values (
      v_user_id,
      v_badge->>'badge_type',
      coalesce((v_badge->>'earned_at')::timestamptz, now())
    )
    on conflict (user_id, badge_type) do nothing;
    get diagnostics v_rows = row_count;
    v_badges_inserted := v_badges_inserted + v_rows;
  end loop;

  -- Daily summaries are derived purely from `turns`: recompute only when this
  -- call stored or filled in a turn (a re-send of known turns changes nothing).
  if v_turns_inserted + v_turns_updated > 0 then
    perform recompute_daily_summaries(v_user_id);
  end if;

  -- QA-0928-204: say what was stored, not what was sent. turns_synced keeps its
  -- name for older callers and now counts NEW turns only.
  -- fills_missing (QA-0928-34): the stored-turn fields a re-send fills in. Only
  -- this RPC says so (the 008 one and the pre-009 sync-data reply don't), so the
  -- CLI can hold its one-time full re-send, which heals legacy estimate-only
  -- turns and hashed branches, until the server it reaches can use it.
  return jsonb_build_object(
    'synced',          v_session_count,
    'turns_synced',    v_turns_inserted,
    'turns_received',  v_turns_received,
    'turns_inserted',  v_turns_inserted,
    'turns_skipped',   v_turns_received - v_turns_inserted,
    'turns_updated',   v_turns_updated,
    'badges_synced',   v_badges_inserted,
    'badges_received', v_badges_received,
    'badges_inserted', v_badges_inserted,
    'badges_skipped',  v_badges_received - v_badges_inserted,
    'fills_missing',   jsonb_build_array('cost_estimate_usd', 'git_branch')
  );
end;
$$;

-- ── (4) Privacy cleanup (Peter's decision 1) ────────────────────────────────
-- Raw branch names synced before 0.3.2 are removed; the salted-hash shape stays.
-- Local data is untouched (the CLI keeps raw names on the user's machine).
update turns    set git_branch = null where git_branch is not null and git_branch !~ '^#[0-9a-f]{12}$';
update sessions set git_branch = null where git_branch is not null and git_branch !~ '^#[0-9a-f]{12}$';

-- ── (3) Backfill ─────────────────────────────────────────────────────────────
-- Legacy $0 anchors (RC check; QA-0928-52): a stored cost_usd 0 with no
-- cumulative cost is unanchored, so it becomes NULL, the invariant the RPC keeps
-- from here on. Runs after the RPC is replaced, so a 0.3.1 sync that lands in
-- between is covered too; the daily recompute below then counts these turns as
-- unanchored. Their estimates arrive with the 0.3.2 CLI's one-time re-send.
update turns set cost_usd = null where cost_usd = 0 and cumulative_cost_usd is null;

-- A session that holds an unanchored stored turn is not billing-grade (008 took
-- the label from the request's summary, which counted a legacy $0 row as an
-- anchor, and called any $0 summary billing-grade). The same rule the RPC
-- applies: no anchored turn = 'estimate', otherwise at most 'mixed'. It only
-- downgrades, so a re-run changes nothing.
update sessions s
   set cost_basis = case when agg.n_anchored = 0 then 'estimate' else 'mixed' end
  from (select session_id, count(*) as n, count(cost_usd) as n_anchored from turns group by session_id) agg
 where s.id = agg.session_id
   and agg.n > agg.n_anchored
   and (s.cost_basis = 'billing-grade' or (agg.n_anchored = 0 and s.cost_basis = 'mixed'));

-- Session money precision (RC check): a total 008 rounded to 4 decimals gets its
-- exact value back from the session's own 6-decimal split, but only when the
-- stored total is exactly that split rounded, i.e. only a precision difference.
update sessions
   set estimated_cost_usd = anchored_cost_usd + estimated_only_cost_usd
 where estimated_cost_usd is distinct from anchored_cost_usd + estimated_only_cost_usd
   and estimated_cost_usd = round(anchored_cost_usd + estimated_only_cost_usd, 4);

-- QA-0928-35: every session's lines/durations from its stored turns (chunked
-- syncs before 009 left per-chunk values).
-- Session cost/token/turn totals are NOT recomputed from the stored turns here: a
-- legacy estimate-only turn has no stored estimate yet (only the CLI can price
-- it), so recomputing now would drop the estimate its session summary carries.
-- The RPC derives them from the stored turns the next time the session is sent,
-- i.e. on the 0.3.2 CLI's one-time full re-send, which fills those estimates in
-- the same call.
update sessions s set
  lines_added = agg.la, lines_removed = agg.lr,
  duration_ms = agg.dur, api_duration_ms = agg.api
from (
  select session_id,
         coalesce(sum(lines_added), 0) as la, coalesce(sum(lines_removed), 0) as lr,
         coalesce(sum(duration_ms), 0) as dur, coalesce(sum(api_duration_ms), 0) as api
  from turns group by session_id
) agg
where s.id = agg.session_id
  and (s.lines_added, s.lines_removed, s.duration_ms, s.api_duration_ms)
      is distinct from (agg.la::int, agg.lr::int, agg.dur, agg.api);

-- QA-0928-34: every user's daily summaries under the new cost split.
do $$
declare r record;
begin
  for r in select id from users loop
    perform recompute_daily_summaries(r.id);
  end loop;
end $$;

-- ── (5) get-dashboard helpers (contract B) ───────────────────────────────────
-- Window = turns at/after local midnight of p_start in p_tz, i.e. the instant
-- (p_start::timestamp at time zone p_tz); a turn's local day is
-- (timestamp at time zone p_tz)::date. p_tz must be a zone name already passed
-- through dashboard_tz() (dashboard_local does this); the helpers don't re-check.

-- An IANA zone Postgres knows, else 'UTC'. (A POSIX string such as 'XYZ+5' would
-- be accepted by AT TIME ZONE with inverted sign rules, so only names count.)
create or replace function dashboard_tz(p_tz text)
returns text
language sql stable
as $$
  select case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
$$;

-- Sessions to show for the window: any session with a turn in it (QA-0928-33:
-- not only those that started in it), plus any that started in it.
create or replace function dashboard_session_ids(p_user_id uuid, p_start date, p_tz text)
returns setof uuid
language sql stable
as $$
  select distinct t.session_id from turns t
   where t.user_id = p_user_id and t."timestamp" >= (p_start::timestamp at time zone p_tz)
  union
  select s.id from sessions s
   where s.user_id = p_user_id and s.started_at >= (p_start::timestamp at time zone p_tz);
$$;

-- QA-0928-32: days in the viewer's zone, from turns (daily_summaries stays UTC).
create or replace function dashboard_daily_local(p_user_id uuid, p_start date, p_tz text)
returns jsonb
language sql stable
as $$
  with wt as (
    select (t."timestamp" at time zone p_tz)::date as d, coalesce(t.usage_pool, 'interactive') as pool, t.*
    from turns t
    where t.user_id = p_user_id and t."timestamp" >= (p_start::timestamp at time zone p_tz)
  ),
  models as (
    select d, pool, jsonb_object_agg(m, n) as models_used
    from (select d, pool, coalesce(model, 'unknown') as m, count(*) as n from wt group by 1, 2, 3) x
    group by d, pool
  ),
  agg as (
    select d, pool,
           count(*) as turn_count, count(distinct session_id) as session_count,
           coalesce(sum(cost_usd), 0) as anchored,
           coalesce(sum(cost_estimate_usd) filter (where cost_usd is null), 0) as estimate,
           coalesce(sum(cost_usd) filter (where speed_tier = 'fast'), 0) as fast,
           coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
           coalesce(sum(cache_read_tokens), 0) as cache_read_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
           coalesce(sum(lines_added), 0) as lines_added, coalesce(sum(lines_removed), 0) as lines_removed,
           coalesce(sum(duration_ms), 0) as duration_ms, coalesce(sum(api_duration_ms), 0) as api_duration_ms
    from wt group by d, pool
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(a.d, 'YYYY-MM-DD'), 'usage_pool', a.pool,
           'turn_count', a.turn_count, 'session_count', a.session_count,
           'anchored_usd', a.anchored, 'estimate_usd', a.estimate, 'total_usd', a.anchored + a.estimate,
           'fast_usd', a.fast,
           'input_tokens', a.input_tokens, 'output_tokens', a.output_tokens,
           'cache_read_tokens', a.cache_read_tokens, 'cache_write_tokens', a.cache_write_tokens,
           'lines_added', a.lines_added, 'lines_removed', a.lines_removed,
           'duration_ms', a.duration_ms, 'api_duration_ms', a.api_duration_ms,
           'models_used', m.models_used
         ) order by a.d, a.pool), '[]'::jsonb)
  from agg a join models m on m.d = a.d and m.pool = a.pool;
$$;

-- QA-0928-29: when money was spent — turn cost by local weekday (0 = Sunday) and
-- hour, not each session's whole cost at its start hour.
create or replace function dashboard_hourly_local(p_user_id uuid, p_start date, p_tz text)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'dow', h.dow, 'hour', h.hour, 'total_usd', h.anchored + h.estimate,
           'anchored_usd', h.anchored, 'estimate_usd', h.estimate, 'turn_count', h.n
         ) order by h.dow, h.hour), '[]'::jsonb)
  from (
    select extract(dow from lt)::int as dow, extract(hour from lt)::int as hour,
           coalesce(sum(cost_usd), 0) as anchored,
           coalesce(sum(cost_estimate_usd) filter (where cost_usd is null), 0) as estimate,
           count(*) as n
    from (
      select t."timestamp" at time zone p_tz as lt, t.cost_usd, t.cost_estimate_usd
      from turns t
      where t.user_id = p_user_id and t."timestamp" >= (p_start::timestamp at time zone p_tz)
    ) x
    group by 1, 2
  ) h;
$$;

-- QA-0928-33: the window's sessions (every stored column, as before) plus what
-- each spent INSIDE the window, and whether it started before the window.
create or replace function dashboard_sessions(p_user_id uuid, p_start date, p_tz text)
returns jsonb
language sql stable
as $$
  with w as (
    select t.session_id, count(*) as n,
           coalesce(sum(t.cost_usd), 0) as anchored,
           coalesce(sum(t.cost_estimate_usd) filter (where t.cost_usd is null), 0) as estimate,
           coalesce(sum(t.input_tokens), 0) as input_tokens, coalesce(sum(t.output_tokens), 0) as output_tokens,
           coalesce(sum(t.cache_read_tokens), 0) as cache_read_tokens, coalesce(sum(t.cache_write_tokens), 0) as cache_write_tokens
    from turns t
    where t.user_id = p_user_id and t."timestamp" >= (p_start::timestamp at time zone p_tz)
    group by t.session_id
  )
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
           'window_total_usd', coalesce(w.anchored, 0) + coalesce(w.estimate, 0),
           'window_anchored_usd', coalesce(w.anchored, 0),
           'window_estimate_usd', coalesce(w.estimate, 0),
           'window_turn_count', coalesce(w.n, 0),
           'window_input_tokens', coalesce(w.input_tokens, 0),
           'window_output_tokens', coalesce(w.output_tokens, 0),
           'window_cache_read_tokens', coalesce(w.cache_read_tokens, 0),
           'window_cache_write_tokens', coalesce(w.cache_write_tokens, 0),
           'started_before_window', coalesce(s.started_at < (p_start::timestamp at time zone p_tz), false)
         ) order by s.started_at desc nulls last, s.id), '[]'::jsonb)
  from sessions s
  left join w on w.session_id = s.id
  where s.user_id = p_user_id
    and s.id in (select dashboard_session_ids(p_user_id, p_start, p_tz));
$$;

-- QA-0928-31: per-session cost/token sparks for the window's sessions, the last
-- p_points turns of each (by turn number), with no PostgREST row cap.
create or replace function dashboard_sparks(p_user_id uuid, p_start date, p_tz text, p_points int default 60)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_object_agg(y.session_id, jsonb_build_object('cost', y.cost, 'tok', y.tok)), '{}'::jsonb)
  from (
    select x.session_id,
           jsonb_agg(round(coalesce(x.cost_usd, x.cost_estimate_usd, 0), 4) order by x.turn_number) as cost,
           jsonb_agg(coalesce(x.input_tokens, 0) + coalesce(x.output_tokens, 0) order by x.turn_number) as tok
    from (
      select t.session_id, t.turn_number, t.cost_usd, t.cost_estimate_usd, t.input_tokens, t.output_tokens,
             row_number() over (partition by t.session_id order by t.turn_number desc) as rn
      from turns t
      where t.user_id = p_user_id
        and t.session_id in (select dashboard_session_ids(p_user_id, p_start, p_tz))
    ) x
    where x.rn <= greatest(p_points, 1)
    group by x.session_id
  ) y;
$$;

-- QA-0928-31 / QA-0928-61: the current plan-limit reading over all the user's
-- turns (any window), by the rule `wtclaude limit` uses (src/utils/sessions.js
-- latestRateLimit; the web copy is web/src/lib/rateLimits.js). The newest row by
-- time is NOT the reading: concurrent sessions report the same window, and a
-- lagging session's newer row can carry an older, lower percentage. So per limit
-- (5-hour, 7-day, independently), over rows with that limit's percentage:
--   • the newest window is the latest resets_at, and a reset within 5 minutes
--     of it is the same window; the reading is the highest percentage any row
--     reported for that window, with that row's resets_at (on a tie, the
--     earlier row's, as the CLI's scan of a session's turns finds it first);
--   • with no reset time on any row, the newest row's percentage, reset null.
-- A resets_at at or before the epoch is no reset time, and a NaN percentage is
-- no reading (the CLI's normalizeResetsAt and its finite check). captured_at is
-- the newest row with either reading. A limit with no reading stays null (the
-- gauge shows "—"). NULL when no turn has a reading.
-- Cost: one pass over the user's turns for the newest windows, then one top-1
-- pass per limit (the no-reset fallback walks idx_turns_user_ts backwards).
create or replace function dashboard_rate_limits(p_user_id uuid)
returns jsonb
language sql stable
as $$
  with n as (
    select max(t."timestamp") filter (where t.rate_limit_5h_pct is not null or t.rate_limit_7d_pct is not null) as captured_at,
           bool_or(t.rate_limit_5h_pct is not null) as has5,
           bool_or(t.rate_limit_7d_pct is not null) as has7,
           max(t.rate_limit_5h_resets_at) filter (where t.rate_limit_5h_pct is not null
                                                   and t.rate_limit_5h_resets_at > to_timestamp(0)) as w5,
           max(t.rate_limit_7d_resets_at) filter (where t.rate_limit_7d_pct is not null
                                                   and t.rate_limit_7d_resets_at > to_timestamp(0)) as w7
    from turns t
    where t.user_id = p_user_id
  )
  select jsonb_build_object(
    'source', 'payload',
    'captured_at', n.captured_at,
    'five_hour', coalesce(case
      when not n.has5 then null
      when n.w5 is null then (
        select jsonb_build_object('used_percentage', nullif(t.rate_limit_5h_pct, 'NaN'), 'resets_at', null)
        from turns t
        where t.user_id = p_user_id and t.rate_limit_5h_pct is not null
        order by t."timestamp" desc, t.turn_number desc limit 1)
      else (
        select jsonb_build_object('used_percentage', t.rate_limit_5h_pct, 'resets_at', t.rate_limit_5h_resets_at)
        from turns t
        where t.user_id = p_user_id and t.rate_limit_5h_pct <> 'NaN'
          and t.rate_limit_5h_resets_at > to_timestamp(0)
          and t.rate_limit_5h_resets_at >= n.w5 - interval '5 minutes'
        order by t.rate_limit_5h_pct desc, t."timestamp", t.turn_number limit 1)
      end, jsonb_build_object('used_percentage', null, 'resets_at', null)),
    'seven_day', coalesce(case
      when not n.has7 then null
      when n.w7 is null then (
        select jsonb_build_object('used_percentage', nullif(t.rate_limit_7d_pct, 'NaN'), 'resets_at', null)
        from turns t
        where t.user_id = p_user_id and t.rate_limit_7d_pct is not null
        order by t."timestamp" desc, t.turn_number desc limit 1)
      else (
        select jsonb_build_object('used_percentage', t.rate_limit_7d_pct, 'resets_at', t.rate_limit_7d_resets_at)
        from turns t
        where t.user_id = p_user_id and t.rate_limit_7d_pct <> 'NaN'
          and t.rate_limit_7d_resets_at > to_timestamp(0)
          and t.rate_limit_7d_resets_at >= n.w7 - interval '5 minutes'
        order by t.rate_limit_7d_pct desc, t."timestamp", t.turn_number limit 1)
      end, jsonb_build_object('used_percentage', null, 'resets_at', null)))
  from n
  where n.captured_at is not null;
$$;

-- QA-0928-127: the newest stored turn, any window (NULL when none).
create or replace function dashboard_last_activity(p_user_id uuid)
returns timestamptz
language sql stable
as $$
  select max(t."timestamp") from turns t where t.user_id = p_user_id;
$$;

-- QA-0928-26: the oldest stored turn, any window (NULL when none) — when tracking
-- began, for a projection over the days since rather than the whole window.
create or replace function dashboard_first_activity(p_user_id uuid)
returns timestamptz
language sql stable
as $$
  select min(t."timestamp") from turns t where t.user_id = p_user_id;
$$;

-- Everything get-dashboard adds, in one call (one jsonb value, so no row cap).
create or replace function dashboard_local(p_user_id uuid, p_start date, p_tz text)
returns jsonb
language plpgsql stable
as $$
declare
  v_tz text := dashboard_tz(p_tz);
begin
  return jsonb_build_object(
    'tz',               v_tz,
    'window_start',     to_char(p_start, 'YYYY-MM-DD'),
    'daily_local',      dashboard_daily_local(p_user_id, p_start, v_tz),
    'hourly_local',     dashboard_hourly_local(p_user_id, p_start, v_tz),
    'sessions',         dashboard_sessions(p_user_id, p_start, v_tz),
    'sparks',           dashboard_sparks(p_user_id, p_start, v_tz, 60),
    'rate_limits',      dashboard_rate_limits(p_user_id),
    'last_activity_at', dashboard_last_activity(p_user_id),
    'first_activity_at', dashboard_first_activity(p_user_id),
    'total_sessions',   (select count(*) from sessions where user_id = p_user_id)
  );
end;
$$;

-- ── QA-0928-128: leaderboard in SQL, opted-in users only ────────────────────
create or replace function leaderboard_totals(p_period_start date, p_limit int default 50)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb)
  from (
    select row_number() over (order by sum(d.total_input_tokens + d.total_output_tokens
                                           + d.total_cache_read + d.total_cache_write) desc, u.id) as rank,
           u.id as user_id,
           sum(d.total_input_tokens + d.total_output_tokens + d.total_cache_read + d.total_cache_write) as total_tokens,
           sum(d.session_count) as session_count,
           sum(d.turn_count) as turn_count
    from users u
    join daily_summaries d on d.user_id = u.id
    where u.sharing_enabled and d.date >= p_period_start
    group by u.id
    order by rank
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) r;
$$;

-- ── (6) Phase-C grants: service_role only ────────────────────────────────────
revoke all on function recompute_daily_summaries(uuid)                 from public, anon, authenticated;
revoke all on function sync_user_batch(text, jsonb, jsonb, jsonb)      from public, anon, authenticated;
revoke all on function dashboard_tz(text)                              from public, anon, authenticated;
revoke all on function dashboard_session_ids(uuid, date, text)         from public, anon, authenticated;
revoke all on function dashboard_daily_local(uuid, date, text)         from public, anon, authenticated;
revoke all on function dashboard_hourly_local(uuid, date, text)        from public, anon, authenticated;
revoke all on function dashboard_sessions(uuid, date, text)            from public, anon, authenticated;
revoke all on function dashboard_sparks(uuid, date, text, int)         from public, anon, authenticated;
revoke all on function dashboard_rate_limits(uuid)                     from public, anon, authenticated;
revoke all on function dashboard_last_activity(uuid)                   from public, anon, authenticated;
revoke all on function dashboard_first_activity(uuid)                  from public, anon, authenticated;
revoke all on function dashboard_local(uuid, date, text)               from public, anon, authenticated;
revoke all on function leaderboard_totals(date, int)                   from public, anon, authenticated;

grant execute on function recompute_daily_summaries(uuid)              to service_role;
grant execute on function sync_user_batch(text, jsonb, jsonb, jsonb)   to service_role;
grant execute on function dashboard_tz(text)                           to service_role;
grant execute on function dashboard_session_ids(uuid, date, text)      to service_role;
grant execute on function dashboard_daily_local(uuid, date, text)      to service_role;
grant execute on function dashboard_hourly_local(uuid, date, text)     to service_role;
grant execute on function dashboard_sessions(uuid, date, text)         to service_role;
grant execute on function dashboard_sparks(uuid, date, text, int)      to service_role;
grant execute on function dashboard_rate_limits(uuid)                  to service_role;
grant execute on function dashboard_last_activity(uuid)                to service_role;
grant execute on function dashboard_first_activity(uuid)               to service_role;
grant execute on function dashboard_local(uuid, date, text)            to service_role;
grant execute on function leaderboard_totals(date, int)                to service_role;

-- Let PostgREST pick up the new signatures without a restart.
notify pgrst, 'reload schema';
