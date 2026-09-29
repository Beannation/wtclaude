-- Test helpers for the scratch-Postgres suite (supabase/tests/run.sh). They live
-- in their own schema so every test file can use them; never applied to the project.
create schema if not exists wtc_test;

create table if not exists wtc_test.results (
  seq    serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);

create or replace function wtc_test.check(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into wtc_test.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then
    raise notice 'PASS  %', p_name;
  else
    raise warning 'FAIL  %  %', p_name, p_detail;
  end if;
end $$;

create or replace function wtc_test.eq(p_name text, p_got anycompatible, p_want anycompatible)
returns void language sql as $$
  select wtc_test.check(p_name, p_got is not distinct from p_want,
                        format('got %s, want %s', p_got, p_want));
$$;

-- One contract-A turn. cost_usd NULL = an unanchored turn (the key is omitted,
-- as a legacy record has none); p_extra overrides or adds keys.
create or replace function wtc_test.turn(p_turn int, p_ts timestamptz, p_cost numeric, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'turn', p_turn,
    'ts', to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'model', 'claude-sonnet-4-6',
    'input_tokens', 100, 'output_tokens', 50, 'cache_read_tokens', 1000, 'cache_write_tokens', 10,
    'cumulative_input', 100 * p_turn, 'cumulative_output', 50 * p_turn,
    'cost_usd', p_cost,
    'lines_added', 3, 'lines_removed', 1, 'duration_ms', 1000, 'api_duration_ms', 500,
    'usage_pool', 'interactive', 'billing_basis', 'api',
    'device_id', 'dev-test-1', 'project_hash', 'ph0000000001'
  )) || p_extra;
$$;

-- A session entry {session_id, summary, turns} whose summary mirrors the CLI's
-- summarizeTurns over p_all (the session's full local history), carrying only the
-- p_send slice of turns (a chunked sync sends a slice with the full summary).
create or replace function wtc_test.session(p_sid text, p_all jsonb, p_send jsonb default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'session_id', p_sid,
    'summary', (
      select jsonb_build_object(
        'started_at', min(t->>'ts'), 'ended_at', max(t->>'ts'),
        'input_tokens', sum((t->>'input_tokens')::bigint), 'output_tokens', sum((t->>'output_tokens')::bigint),
        'cache_read_tokens', sum((t->>'cache_read_tokens')::bigint), 'cache_write_tokens', sum((t->>'cache_write_tokens')::bigint),
        'cost', sum(coalesce((t->>'cost_usd')::numeric, (t->>'cost_estimate_usd')::numeric, 0)),
        'anchored_cost', coalesce(sum((t->>'cost_usd')::numeric), 0),
        'estimated_cost', coalesce(sum((t->>'cost_estimate_usd')::numeric) filter (where t->>'cost_usd' is null), 0),
        'fast_cost', 0, 'fast_turns', 0,
        'turn_count', count(*),
        'models', jsonb_build_object('claude-sonnet-4-6', count(*)))
      from jsonb_array_elements(p_all) t),
    'turns', coalesce(p_send, p_all));
$$;

-- n turns starting at p_from (turn numbers p_first..), one minute apart.
create or replace function wtc_test.turns(p_first int, p_n int, p_from timestamptz, p_cost numeric, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select coalesce(jsonb_agg(wtc_test.turn(p_first + i, p_from + make_interval(mins => i), p_cost, p_extra) order by i), '[]'::jsonb)
  from generate_series(0, p_n - 1) i;
$$;

-- A turn's rate-limit snapshot keys as the CLI syncs them: resets_at in epoch
-- seconds, as the statusline payload carries it. A NULL argument sends null.
create or replace function wtc_test.rl(p_5h numeric, p_5h_reset timestamptz, p_7d numeric, p_7d_reset timestamptz)
returns jsonb language sql as $$
  select jsonb_build_object(
    'rate_limit_5h_pct', p_5h, 'rate_limit_5h_resets_at', floor(extract(epoch from p_5h_reset))::bigint,
    'rate_limit_7d_pct', p_7d, 'rate_limit_7d_resets_at', floor(extract(epoch from p_7d_reset))::bigint);
$$;

create or replace function wtc_test.user_id(p_anon text) returns uuid language sql as $$
  select id from users where anonymous_id = p_anon;
$$;

create or replace function wtc_test.session_row(p_anon text, p_sid text) returns sessions language sql as $$
  select s.* from sessions s join users u on u.id = s.user_id where u.anonymous_id = p_anon and s.session_id = p_sid;
$$;
