#!/usr/bin/env bash
# Security tests for the production schema (supabase/tests/rls.sql).
#
#   bun run test:rls              against a local Supabase: run `bun run db:start` first
#   bun run test:rls -- --stub    against plain Postgres, no Docker needed: builds a throwaway
#                                 database, applies a stand-in for Supabase's auth and storage
#                                 schemas plus every migration, runs the tests, drops it
#
# Needs `psql`. Override the database with DATABASE_URL (Supabase) or PG_ADMIN_URL (--stub).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
migrations="$here/../migrations"
run_sql() { psql "$1" -q -v ON_ERROR_STOP=1 -f "$2"; }

if [[ "${1:-}" == "--stub" ]]; then
  admin_url=${PG_ADMIN_URL:-postgres:///postgres}
  db="goldman_rls_test_$$"
  psql "$admin_url" -qc "create database $db"
  trap 'psql "$admin_url" -qc "drop database if exists $db with (force)"' EXIT
  url="${admin_url%/*}/$db"
  run_sql "$url" "$here/stub/supabase.sql"
  for migration in "$migrations"/*.sql; do run_sql "$url" "$migration"; done
else
  url=${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
fi

# Query results go nowhere; the "ok - …" notices and any FAIL come through on stderr.
run_sql "$url" "$here/rls.sql" >/dev/null
