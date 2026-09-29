-- Edge-test fixture (after helpers.sql). Seeded through the 3-arg RPC call the
-- deployed sync-data makes, so the same data loads on the 008 baseline and on
-- 009. The tests' clock is fixed at 2026-03-12T15:00Z (11:00 EDT). Synthetic ids.
--
-- User P aaaaaaaa-…-001:
--   cccccccc-1111-4111-8111-000000000001  a UUID-shaped CLI session id, 1,733 turns
--                                          from 03-05 00:00Z, limit snapshot 43% / 6%
--   p-late      1,101 turns from 03-11 10:00Z; snapshots 2% / 7%, the last ten 3% / 7%,
--               and a final turn with none (the newest activity, 03-12 04:20Z)
--   p-straddle  03-10 12:00Z $1.00 and 03-11 12:00Z $0.25
--   p-nodevice  2 turns with no device id (legacy)
--   abc123def4567  a 13-character (non-UUID) CLI session id, 3 turns
-- User Q aaaaaaaa-…-002: q-1, 3 turns (P must not be able to read it).
-- Leaderboard: 100 opted-in users bbbbbbbb-…, one turn a day 03-01..03-12
-- (1,200 in-period daily rows), input_tokens 100 + k for user k.
select sync_user_batch('aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_array(
  wtc_test.session('cccccccc-1111-4111-8111-000000000001',
    wtc_test.turns(1, 1733, '2026-03-05 00:00Z', 0.001,
      '{"rate_limit_5h_pct":43,"rate_limit_7d_pct":6,"rate_limit_5h_resets_at":1773190800,"rate_limit_7d_resets_at":1773700000}'))), '[]'::jsonb);
select sync_user_batch('aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_array(
  wtc_test.session('p-late',
    wtc_test.turns(1, 1090, '2026-03-11 10:00Z', 0.002,
      '{"rate_limit_5h_pct":2,"rate_limit_7d_pct":7,"rate_limit_5h_resets_at":1773320400,"rate_limit_7d_resets_at":1773700000}')
    || wtc_test.turns(1091, 10, '2026-03-12 04:10Z', 0.002,
      '{"rate_limit_5h_pct":3,"rate_limit_7d_pct":7,"rate_limit_5h_resets_at":1773320400,"rate_limit_7d_resets_at":1773700000}')
    || jsonb_build_array(wtc_test.turn(1101, '2026-03-12 04:20Z', 0.002)))), '[]'::jsonb);
select sync_user_batch('aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_array(
  wtc_test.session('p-straddle', jsonb_build_array(
    wtc_test.turn(1, '2026-03-10 12:00Z', 1.00), wtc_test.turn(2, '2026-03-11 12:00Z', 0.25))),
  wtc_test.session('p-nodevice', wtc_test.turns(1, 2, '2026-03-11 13:00Z', 0.01, '{"device_id":null}')),
  wtc_test.session('abc123def4567', wtc_test.turns(1, 3, '2026-03-11 14:00Z', 0.01))), '[]'::jsonb);
select sync_user_batch('aaaaaaaa-0000-4000-8000-000000000002', jsonb_build_array(
  wtc_test.session('q-1', wtc_test.turns(1, 3, '2026-03-11 14:00Z', 0.01))), '[]'::jsonb);

do $$
declare k int; v_id text;
begin
  for k in 1..100 loop
    v_id := format('bbbbbbbb-0000-4000-8000-%s', lpad(k::text, 12, '0'));
    perform sync_user_batch(v_id, jsonb_build_array(wtc_test.session('lb-' || k,
      (select jsonb_agg(wtc_test.turn(d, ('2026-03-01 09:00Z'::timestamptz + make_interval(days => d - 1)), 0.01,
                        jsonb_build_object('input_tokens', 100 + k)) order by d)
         from generate_series(1, 12) d))), '[]'::jsonb);
  end loop;
  update users set sharing_enabled = true where anonymous_id like 'bbbbbbbb-%';
end $$;
