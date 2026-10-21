#!/usr/bin/env bash
# Runs only on an empty, disposable PostgreSQL service, never Supabase production.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:=127.0.0.1}" "${PGDATABASE:=superior_workflow_test}" "${PGUSER:=postgres}"
export PGHOST PGDATABASE PGUSER
[[ "$PGHOST" == '127.0.0.1' || "$PGHOST" == 'localhost' ]] || { echo 'Refusing non-local test database'; exit 1; }
[[ "$PGDATABASE" == 'superior_workflow_test' ]] || { echo 'Refusing non-test database'; exit 1; }
# btree_gist resides in extensions, as it does on Supabase.
export PGOPTIONS='-c search_path=public,extensions -c statement_timeout=60000'
psql -X --set ON_ERROR_STOP=1 -f tests/integration/baseline.sql
while IFS= read -r migration; do
  echo "Applying repository migration: $migration"
  psql -X --set ON_ERROR_STOP=1 -f "$migration"
done < <(find supabase/migrations -maxdepth 1 -name '*.sql' -print | LC_ALL=C sort)
psql -X --set ON_ERROR_STOP=1 -c "select count(*) as application_tables from information_schema.tables where table_schema='public';"
