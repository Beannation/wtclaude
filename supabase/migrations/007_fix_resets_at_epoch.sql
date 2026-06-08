-- 007_fix_resets_at_epoch.sql
-- Fix for sync_user_batch (migration 005): the rate-limit reset fields
-- (rate_limit_5h_resets_at / rate_limit_7d_resets_at) arrive from the Claude Code
-- payload as UNIX EPOCH SECONDS (e.g. 1780945200), not ISO strings, so casting
-- them straight to timestamptz raised "date/time field value out of range". Use
-- to_timestamp() instead. (Latent since 005 — turns never inserted before the
-- BUG-01 unique-index fix let the upsert run, so it was never exercised.)
--
-- create or replace = forward-only; replaces the 005 body in place. Idempotent.

create or replace function sync_user_batch(p_anonymous_id text, p_sessions jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user_id        uuid;
  v_session        jsonb;
  v_sum            jsonb;
  v_turns          jsonb;
  v_turn           jsonb;
  v_session_db_id  uuid;
  v_total_cost     numeric;
  v_anchored       numeric;
  v_estimate       numeric;
  v_fast           numeric;
  v_anchored_pct   numeric;
  v_cost_basis     text;
  v_git_branch     text;
  v_cost_center    text;
  v_device_id      text;
  v_project_hash   text;
  v_lines_added    bigint;
  v_lines_removed  bigint;
  v_duration_ms    bigint;
  v_api_duration   bigint;
  v_turns_synced   int := 0;
  v_session_count  int := 0;
begin
  if p_anonymous_id is null or length(p_anonymous_id) = 0 then
    raise exception 'Missing anonymous ID';
  end if;

  select id into v_user_id from users where anonymous_id = p_anonymous_id;
  if v_user_id is null then
    insert into users(anonymous_id) values (p_anonymous_id) returning id into v_user_id;
  end if;

  for v_session in select jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) loop
    v_session_count := v_session_count + 1;
    v_sum   := coalesce(v_session->'summary', '{}'::jsonb);
    v_turns := coalesce(v_session->'turns', '[]'::jsonb);

    v_total_cost := coalesce((v_sum->>'cost')::numeric, 0);
    v_anchored   := coalesce((v_sum->>'anchored_cost')::numeric, 0);
    v_estimate   := coalesce((v_sum->>'estimated_cost')::numeric, 0);
    v_fast       := coalesce((v_sum->>'fast_cost')::numeric, 0);
    v_anchored_pct := case when v_total_cost > 0 then v_anchored / v_total_cost else 1 end;
    v_cost_basis := case
      when v_anchored_pct < 0.01 then 'estimate'
      when coalesce((v_sum->>'fast_turns')::int, 0) > 0 or v_estimate > 0 then 'mixed'
      else 'billing-grade' end;

    select t->>'git_branch'   into v_git_branch  from jsonb_array_elements(v_turns) t where t->>'git_branch'   is not null limit 1;
    select t->>'cost_center'  into v_cost_center  from jsonb_array_elements(v_turns) t where t->>'cost_center'  is not null limit 1;
    select t->>'device_id'    into v_device_id    from jsonb_array_elements(v_turns) t where t->>'device_id'    is not null limit 1;
    select t->>'project_hash' into v_project_hash from jsonb_array_elements(v_turns) t where t->>'project_hash' is not null limit 1;

    select coalesce(sum((t->>'lines_added')::bigint), 0),
           coalesce(sum((t->>'lines_removed')::bigint), 0),
           coalesce(sum((t->>'duration_ms')::bigint), 0),
           coalesce(sum((t->>'api_duration_ms')::bigint), 0)
      into v_lines_added, v_lines_removed, v_duration_ms, v_api_duration
      from jsonb_array_elements(v_turns) t;

    insert into sessions (
      user_id, session_id, project_hash, started_at, ended_at,
      total_input_tokens, total_output_tokens, total_cache_read, total_cache_write,
      models_used, turn_count, estimated_cost_usd, anchored_cost_usd,
      estimated_only_cost_usd, fast_cost_usd, fast_turns, cost_basis,
      git_branch, cost_center, device_id,
      lines_added, lines_removed, duration_ms, api_duration_ms
    ) values (
      v_user_id, v_session->>'session_id', v_project_hash,
      (v_sum->>'started_at')::timestamptz, (v_sum->>'ended_at')::timestamptz,
      coalesce((v_sum->>'input_tokens')::bigint, 0), coalesce((v_sum->>'output_tokens')::bigint, 0),
      coalesce((v_sum->>'cache_read_tokens')::bigint, 0), coalesce((v_sum->>'cache_write_tokens')::bigint, 0),
      coalesce(v_sum->'models', '{}'::jsonb), coalesce((v_sum->>'turn_count')::int, 0),
      v_total_cost, v_anchored, v_estimate, v_fast, coalesce((v_sum->>'fast_turns')::int, 0), v_cost_basis,
      v_git_branch, v_cost_center, v_device_id,
      v_lines_added, v_lines_removed, v_duration_ms, v_api_duration
    )
    on conflict (user_id, session_id) do update set
      project_hash = excluded.project_hash, started_at = excluded.started_at, ended_at = excluded.ended_at,
      total_input_tokens = excluded.total_input_tokens, total_output_tokens = excluded.total_output_tokens,
      total_cache_read = excluded.total_cache_read, total_cache_write = excluded.total_cache_write,
      models_used = excluded.models_used, turn_count = excluded.turn_count,
      estimated_cost_usd = excluded.estimated_cost_usd, anchored_cost_usd = excluded.anchored_cost_usd,
      estimated_only_cost_usd = excluded.estimated_only_cost_usd, fast_cost_usd = excluded.fast_cost_usd,
      fast_turns = excluded.fast_turns, cost_basis = excluded.cost_basis,
      git_branch = excluded.git_branch, cost_center = excluded.cost_center, device_id = excluded.device_id,
      lines_added = excluded.lines_added, lines_removed = excluded.lines_removed,
      duration_ms = excluded.duration_ms, api_duration_ms = excluded.api_duration_ms
    returning id into v_session_db_id;

    for v_turn in select jsonb_array_elements(v_turns) loop
      insert into turns (
        session_id, user_id, turn_number, "timestamp", model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cumulative_input, cumulative_output, cumulative_cache_read, cumulative_cache_write,
        used_percentage, cost_usd, cumulative_cost_usd, speed_tier, speed_tier_source,
        usage_pool, billing_basis, git_branch, project_hash, cost_center, device_id,
        task_category, edit_target_hash, lines_added, lines_removed, duration_ms, api_duration_ms,
        effort_level, thinking_enabled, exceeds_200k_tokens, cc_version,
        rate_limit_5h_pct, rate_limit_5h_resets_at, rate_limit_7d_pct, rate_limit_7d_resets_at
      ) values (
        v_session_db_id, v_user_id, (v_turn->>'turn')::int, (v_turn->>'ts')::timestamptz, v_turn->>'model',
        coalesce((v_turn->>'input_tokens')::int, 0), coalesce((v_turn->>'output_tokens')::int, 0),
        coalesce((v_turn->>'cache_read_tokens')::int, 0), coalesce((v_turn->>'cache_write_tokens')::int, 0),
        coalesce((v_turn->>'cumulative_input')::bigint, 0), coalesce((v_turn->>'cumulative_output')::bigint, 0),
        coalesce((v_turn->>'cumulative_cache_read')::bigint, 0), coalesce((v_turn->>'cumulative_cache_write')::bigint, 0),
        (v_turn->>'used_percentage')::numeric, (v_turn->>'cost_usd')::numeric, (v_turn->>'cumulative_cost_usd')::numeric,
        v_turn->>'speed_tier', v_turn->>'speed_tier_source',
        v_turn->>'usage_pool', v_turn->>'billing_basis', v_turn->>'git_branch', v_turn->>'project_hash',
        v_turn->>'cost_center', v_turn->>'device_id', v_turn->>'task_category', v_turn->>'edit_target_hash',
        (v_turn->>'lines_added')::int, (v_turn->>'lines_removed')::int,
        (v_turn->>'duration_ms')::bigint, (v_turn->>'api_duration_ms')::bigint,
        v_turn->>'effort_level', (v_turn->>'thinking_enabled')::boolean, (v_turn->>'exceeds_200k_tokens')::boolean,
        v_turn->>'cc_version',
        (v_turn->>'rate_limit_5h_pct')::numeric, to_timestamp((v_turn->>'rate_limit_5h_resets_at')::double precision),
        (v_turn->>'rate_limit_7d_pct')::numeric, to_timestamp((v_turn->>'rate_limit_7d_resets_at')::double precision)
      )
      on conflict (session_id, turn_number) do nothing;
      v_turns_synced := v_turns_synced + 1;
    end loop;
  end loop;

  delete from daily_summaries where user_id = v_user_id;

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
      t.session_id, t.model, t.cost_usd, t.speed_tier,
      t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_write_tokens,
      t.lines_added, t.lines_removed, t.duration_ms, t.api_duration_ms
    from turns t
    where t.user_id = v_user_id
  ),
  models_agg as (
    select d, pool, jsonb_object_agg(coalesce(model, 'unknown'), cnt) as models
    from (
      select d, pool, model, count(*) as cnt from day_turns group by d, pool, model
    ) per_model
    group by d, pool
  )
  select
    v_user_id, dt.d, dt.pool,
    coalesce(sum(dt.input_tokens), 0), coalesce(sum(dt.output_tokens), 0),
    coalesce(sum(dt.cache_read_tokens), 0), coalesce(sum(dt.cache_write_tokens), 0),
    count(distinct dt.session_id), count(*),
    coalesce(ma.models, '{}'::jsonb),
    coalesce(sum(dt.cost_usd), 0),
    coalesce(sum(dt.cost_usd) filter (where dt.cost_usd is not null), 0),
    coalesce(sum(dt.cost_usd) filter (where dt.cost_usd is null), 0),
    coalesce(sum(dt.cost_usd) filter (where dt.speed_tier = 'fast'), 0),
    coalesce(sum(dt.lines_added), 0), coalesce(sum(dt.lines_removed), 0),
    coalesce(sum(dt.duration_ms), 0), coalesce(sum(dt.api_duration_ms), 0)
  from day_turns dt
  join models_agg ma on ma.d = dt.d and ma.pool = dt.pool
  group by dt.d, dt.pool, ma.models;

  return jsonb_build_object('synced', v_session_count, 'turns_synced', v_turns_synced);
end;
$$;

revoke all on function sync_user_batch(text, jsonb) from public, anon, authenticated;
grant execute on function sync_user_batch(text, jsonb) to service_role;
