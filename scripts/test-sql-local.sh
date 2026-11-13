#!/usr/bin/env bash
# Exécute la migration et les tests d'autorisation sur un PostgreSQL local jetable (15+).
# Connexion par les variables standard libpq (PGHOST, PGPORT, PGUSER...). Ne JAMAIS viser la production.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="labo_test_$$"
psql -d postgres -qc "create database $DB"
trap 'psql -d postgres -qc "drop database if exists $DB" >/dev/null' EXIT
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stubs.sql
# Migration V1, puis jeu de données V1, puis migrations suivantes : vérifie la reprise des données.
first=1
for f in supabase/migrations/*.sql; do
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
  if [ "$first" = 1 ]; then psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/05_seed_v1.sql; first=0; fi
done
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/10_rls_test.sql
