-- Pre-009 state, written through the 008 RPC exactly as production holds it
-- today (run after 001-008, before 009). Synthetic ids only.
--   pre-split  : 100 turns sent as two 50-turn chunks — 008 keeps only the second
--                chunk's lines/durations (QA-0928-35); raw branch 'feature/acme-secret'.
--   pre-hashed : 5 turns already carrying a salted-hash branch.
--   pre-legacy : 4 legacy turns with no cost_usd key (estimate-only), like the
--                QA's 05-25 session: the turns carry no estimate (0.3.1 sent none),
--                only the session summary does ($1.00, frozen at sync time).
select sync_user_batch('11111111-1111-4111-8111-111111111111',
  jsonb_build_array(wtc_test.session('pre-split',
    wtc_test.turns(1, 100, '2026-03-01 10:00Z', 0.01, '{"git_branch":"feature/acme-secret"}'),
    wtc_test.turns(1, 50,  '2026-03-01 10:00Z', 0.01, '{"git_branch":"feature/acme-secret"}'))), '[]'::jsonb);
select sync_user_batch('11111111-1111-4111-8111-111111111111',
  jsonb_build_array(wtc_test.session('pre-split',
    wtc_test.turns(1, 100, '2026-03-01 10:00Z', 0.01, '{"git_branch":"feature/acme-secret"}'),
    wtc_test.turns(51, 50, '2026-03-01 10:50Z', 0.01, '{"git_branch":"feature/acme-secret"}'))), '[]'::jsonb);
select sync_user_batch('11111111-1111-4111-8111-111111111111',
  jsonb_build_array(
    wtc_test.session('pre-hashed', wtc_test.turns(1, 5, '2026-03-02 10:00Z', 0.02, '{"git_branch":"#0123456789ab"}')),
    wtc_test.session('pre-legacy', wtc_test.turns(1, 4, '2026-03-03 10:00Z', null, '{"cost_estimate_usd":0.25}'),
      wtc_test.turns(1, 4, '2026-03-03 10:00Z', null))), '[]'::jsonb);
-- Deploy order (QA-0928-34): user H synced 4 legacy turns on 0.3.1 (no cost_usd,
-- raw branch), then a 0.3.2 CLI's one-time full re-send reached the server BEFORE
-- 009 (estimates + hashed branch, 3-arg call). The 008 RPC keeps neither.
select sync_user_batch('12121212-1212-4121-8121-121212121212',
  jsonb_build_array(wtc_test.session('h-legacy',
    wtc_test.turns(1, 4, '2026-03-03 12:00Z', null, '{"git_branch":"feature/secret-h"}'))), '[]'::jsonb);
select sync_user_batch('12121212-1212-4121-8121-121212121212',
  jsonb_build_array(wtc_test.session('h-legacy',
    wtc_test.turns(1, 4, '2026-03-03 12:00Z', null, '{"cost_estimate_usd":0.25,"git_branch":"#dddddddddddd"}'))), '[]'::jsonb);
-- Legacy $0 "anchors" (RC finding, QA-0928-52 server side), user R. Collectors
-- before 0.3.2 wrote a payload with no cost block as cost_usd 0 with
-- cumulative_cost_usd null, and 0.3.1 sent the stored record as is. Its
-- summarizeTurns counted that row as a $0 anchor, so 008 stored the session as
-- $0.75 billing-grade.
--   r-legacy0 : #1 $0.50 (cum 0.50), #2 the legacy 0/null row (90K in / 20K out),
--               #3 $0.25 (cum 0.75)
--   r-all0    : one legacy 0/null row only ($0 session, labelled billing-grade by 008)
--   r-real0   : a real $0 anchor (cost_usd 0 WITH a cumulative figure) — stays anchored
select sync_user_batch('16161616-1616-4161-8161-161616161616',
  jsonb_build_array(
    wtc_test.session('r-legacy0', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 10:00Z', 0.50, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.50}'),
      wtc_test.turn(2, '2026-03-13 10:01Z', 0,
        '{"model":"claude-opus-5-5","cumulative_cost_usd":null,"input_tokens":90000,"output_tokens":20000}'),
      wtc_test.turn(3, '2026-03-13 10:02Z', 0.25, '{"model":"claude-opus-5-5","cumulative_cost_usd":0.75}'))),
    wtc_test.session('r-all0', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 11:00Z', 0, '{"model":"claude-opus-5-5","cumulative_cost_usd":null}'))),
    wtc_test.session('r-real0', jsonb_build_array(
      wtc_test.turn(1, '2026-03-13 12:00Z', 0.10, '{"cumulative_cost_usd":0.10}'),
      wtc_test.turn(2, '2026-03-13 12:01Z', 0, '{"cumulative_cost_usd":0.10}')))), '[]'::jsonb);
-- Session money at 4 decimals (RC finding), user T. 008 stored the summary's
-- cost in numeric(10,4): an exact 12.344997 became 12.3450 (a cent over the
-- CLI's $12.34), while its anchored/estimated split kept 6 decimals.
--   t-pre     : 3 anchored turns summing to 12.344997
--   t-forged  : a summary whose cost is not its own split (5 vs 1 + 0); not a
--               rounding difference, so 009 leaves it for the stored-turn recompute
select sync_user_batch('18181818-1818-4181-8181-181818181818',
  jsonb_build_array(
    wtc_test.session('t-pre', jsonb_build_array(
      wtc_test.turn(1, '2026-03-14 10:00Z', 5.000001), wtc_test.turn(2, '2026-03-14 10:01Z', 5.000001),
      wtc_test.turn(3, '2026-03-14 10:02Z', 2.344995))),
    jsonb_build_object('session_id', 't-forged', 'turns', wtc_test.turns(1, 1, '2026-03-14 11:00Z', 1.00),
      'summary', jsonb_build_object('started_at', '2026-03-14T11:00:00Z', 'ended_at', '2026-03-14T11:00:00Z',
        'cost', 5, 'anchored_cost', 1, 'estimated_cost', 0, 'turn_count', 1))), '[]'::jsonb);
