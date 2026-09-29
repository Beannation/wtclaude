#!/usr/bin/env bash
# Local test suite for the Supabase side: migrations 001-009 on a throwaway
# Postgres, then (optionally) the real edge functions under Deno against a real
# PostgREST. Never touches the hosted project.
#
#   supabase/tests/run.sh               001-008 + pre-009 seed + 009, all checks
#   supabase/tests/run.sh --baseline    same WITHOUT 009 (shows what 009 fixes);
#                                       FUNCTIONS_DIR=<dir> points the edge tests at
#                                       other function sources (e.g. the old ones)
#   supabase/tests/run.sh --sql-only    skip the edge tests
#
# Needs Postgres binaries (initdb, pg_ctl, psql; Postgres 15+) on PATH. The edge
# tests also need DENO=<deno 2.x binary> and POSTGREST=<PostgREST 12+ binary>
# (they are skipped, and say so, when either is missing). PostgREST links libpq;
# it is looked up in LIBPQ_DIR, default `pg_config --libdir` (set here, because
# macOS strips DYLD_* from the environment of scripts). The first edge run
# downloads supabase-js from esm.sh into Deno's cache.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SUPA=$(cd "$HERE/.." && pwd)
BASELINE=0; SQL_ONLY=0
for a in "$@"; do
  case "$a" in
    --baseline) BASELINE=1 ;;
    --sql-only) SQL_ONLY=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
FUNCTIONS_DIR=${FUNCTIONS_DIR:-$SUPA/functions}

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/wtc-supa-test.XXXXXX")
PORT=$(free_port)
PGRST_PID=
cleanup() {
  [ -n "$PGRST_PID" ] && kill "$PGRST_PID" 2>/dev/null || true
  pg_ctl -D "$TMP/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/data" -w -l "$TMP/pg.log" \
  -o "-p $PORT -k '' -c listen_addresses=127.0.0.1 -c timezone=UTC" start >/dev/null

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

migrations() { # 001..009 in order (008 last in baseline mode)
  for f in "$SUPA"/migrations/0*.sql; do
    if [ "$BASELINE" = 1 ] && [[ "$(basename "$f")" == 009_* ]]; then continue; fi
    echo "$f"
  done
}
MIG009=$(ls "$SUPA"/migrations/009_*.sql)
apply009() { # quietly (its "already exists, skipping" notices on a re-run are expected)
  "${PSQL[@]}" -d "$1" -f "$MIG009" >/dev/null 2>"$TMP/009.err" || { cat "$TMP/009.err" >&2; exit 1; }
}
check() { # $1 = database, $2 = select wtc_test.check(...)
  "${PSQL[@]}" -d "$1" -c "$2" 2>&1 >/dev/null | sed -E 's/^(psql:[^ ]+ )?(NOTICE|WARNING):  /  /'
}

build_db() { # $1 = database name; schema + helpers at the 008 level
  "${PSQL[@]}" -d postgres -c "create database $1" >/dev/null
  "${PSQL[@]}" -d "$1" -f "$HERE/shim.sql" >/dev/null 2>&1
  while read -r f; do
    [[ "$(basename "$f")" == 009_* ]] && continue
    "${PSQL[@]}" -d "$1" -f "$f" >/dev/null 2>"$TMP/mig.err" || { cat "$TMP/mig.err" >&2; exit 1; }
  done < <(migrations)
  "${PSQL[@]}" -d "$1" -f "$HERE/helpers.sql" >/dev/null
}

echo "== SQL suite ($([ "$BASELINE" = 1 ] && echo 'baseline: 001-008 only' || echo '001-009')) on port $PORT"
build_db wtc_sql
"${PSQL[@]}" -d wtc_sql -f "$HERE/seed-pre009.sql" >/dev/null
[ "$BASELINE" = 1 ] || apply009 wtc_sql
"${PSQL[@]}" -d wtc_sql -f "$HERE/009.test.sql" 2>&1 | sed -E 's/^psql:[^ ]+ (NOTICE|WARNING):  /  /'

# QA-0928-203: two first syncs for one new id at the same moment, 8 rounds.
for round in 1 2 3 4 5 6 7 8; do
  id=$(python3 -c 'import uuid; print(uuid.uuid4())')
  q="select sync_user_batch('$id', jsonb_build_array(wtc_test.session('conc', wtc_test.turns(1, 300, '2026-03-07 10:00Z', 0.01))), '[]'::jsonb)"
  "${PSQL[@]}" -d wtc_sql -c "$q" >/dev/null 2>"$TMP/c1.err" & p1=$!
  "${PSQL[@]}" -d wtc_sql -c "$q" >/dev/null 2>"$TMP/c2.err" & p2=$!
  s1=0; s2=0; wait $p1 || s1=$?; wait $p2 || s2=$?
  err=$(cat "$TMP/c1.err" "$TMP/c2.err" | grep -m1 ERROR | sed "s/'/''/g" || true)
  check wtc_sql "select wtc_test.check('QA-0928-203 concurrent first syncs, round $round: both succeed', $([ $s1 = 0 ] && [ $s2 = 0 ] && echo true || echo false), '$err')"
  # Same user again, two different sessions at once: both recompute the user's
  # daily rows, which must not collide.
  qa="select sync_user_batch('$id', jsonb_build_array(wtc_test.session('conc-a', wtc_test.turns(1, 300, '2026-03-08 10:00Z', 0.01))), '[]'::jsonb)"
  qb="select sync_user_batch('$id', jsonb_build_array(wtc_test.session('conc-b', wtc_test.turns(1, 300, '2026-03-09 10:00Z', 0.01))), '[]'::jsonb)"
  "${PSQL[@]}" -d wtc_sql -c "$qa" >/dev/null 2>"$TMP/c1.err" & p1=$!
  "${PSQL[@]}" -d wtc_sql -c "$qb" >/dev/null 2>"$TMP/c2.err" & p2=$!
  s1=0; s2=0; wait $p1 || s1=$?; wait $p2 || s2=$?
  err=$(cat "$TMP/c1.err" "$TMP/c2.err" | grep -m1 ERROR | sed "s/'/''/g" || true)
  check wtc_sql "select wtc_test.check('concurrent syncs for an existing user, round $round: both succeed, 3 days of rows', $([ $s1 = 0 ] && [ $s2 = 0 ] && echo true || echo false) and (select count(*) = 3 from daily_summaries d join users u on u.id = d.user_id where u.anonymous_id = '$id'), '$err')"
done

if [ "$BASELINE" = 0 ]; then
  # Idempotency: re-applying 009 leaves every stored row as it was.
  SNAP="select md5(string_agg(x, '|' order by x)) from (
          select row(s.*)::text x from sessions s
          union all select row(t.*)::text from turns t
          union all select row(u.*)::text from users u
          union all select row(d.user_id, d.date, d.usage_pool, d.estimated_cost_usd, d.anchored_cost_usd,
                               d.estimated_only_cost_usd, d.fast_cost_usd, d.turn_count, d.session_count,
                               d.models_used, d.lines_added, d.duration_ms, d.api_duration_ms)::text
                    from daily_summaries d) q"
  before=$("${PSQL[@]}" -d wtc_sql -Atc "$SNAP")
  apply009 wtc_sql
  after=$("${PSQL[@]}" -d wtc_sql -Atc "$SNAP")
  check wtc_sql "select wtc_test.check('009 re-run is a no-op on stored data', '$before' = '$after')"
fi

read -r pass fail < <("${PSQL[@]}" -d wtc_sql -Atc \
  "select count(*) filter (where ok), count(*) filter (where not ok) from wtc_test.results" | tr '|' ' ')
echo "== SQL suite: $pass passed, $fail failed"
"${PSQL[@]}" -d wtc_sql -Atc "select '   FAIL ' || name || '  ' || coalesce(detail, '') from wtc_test.results where not ok order by seq"
status=0; [ "$fail" = 0 ] || status=1

if [ "$SQL_ONLY" = 1 ]; then exit $status; fi
if [ -z "${DENO:-}" ] || [ -z "${POSTGREST:-}" ]; then
  echo "== Edge suite SKIPPED: set DENO and POSTGREST to run the edge functions against PostgREST"
  exit $status
fi

echo "== Edge suite (functions: $FUNCTIONS_DIR)"
build_db wtc_edge
[ "$BASELINE" = 1 ] || apply009 wtc_edge
"${PSQL[@]}" -d wtc_edge -f "$HERE/edge/fixture.sql" >/dev/null
JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
PGRST_PORT=$(free_port)
cat > "$TMP/pgrst.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:$PORT/wtc_edge"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
db-max-rows = 1000
server-host = "127.0.0.1"
server-port = $PGRST_PORT
EOF
LIBPQ_DIR=${LIBPQ_DIR:-$(pg_config --libdir 2>/dev/null || true)}
DYLD_FALLBACK_LIBRARY_PATH="$LIBPQ_DIR" LD_LIBRARY_PATH="$LIBPQ_DIR" \
  "$POSTGREST" "$TMP/pgrst.conf" >"$TMP/pgrst.log" 2>&1 & PGRST_PID=$!
for _ in $(seq 1 50); do
  curl -s -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break
  kill -0 "$PGRST_PID" 2>/dev/null || { echo "PostgREST did not start:" >&2; cat "$TMP/pgrst.log" >&2; exit 1; }
  sleep 0.2
done

edge=0
WTC_PGRST_URL="http://127.0.0.1:$PGRST_PORT" WTC_JWT_SECRET="$JWT_SECRET" \
WTC_FUNCTIONS_DIR="$FUNCTIONS_DIR" WTC_PSQL_ARGS="-h 127.0.0.1 -p $PORT -U postgres -d wtc_edge" TZ=UTC \
  "$DENO" test --quiet --no-check --no-lock --allow-net=127.0.0.1,localhost --allow-env --allow-read --allow-run=psql \
    --import-map="$HERE/edge/import_map.json" "$HERE/edge/functions.test.ts" || edge=$?
[ "$edge" = 0 ] || status=1
exit $status
