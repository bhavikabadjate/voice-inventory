#!/usr/bin/env bash
# Apply the migrations to a fresh database and check the access rules.
# Needs a local Postgres; set PGHOST/PGUSER etc. as usual.
set -euo pipefail
cd "$(dirname "$0")/.."
db="shop_rules_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/auth_stub.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$db" -f tests/access_rules.sql
