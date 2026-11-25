#!/usr/bin/env bash
# Builds a Supabase database from scratch: Prisma tables, then every SQL file in supabase/migrations in order.
# Usage (from backend/): bash scripts/setup-supabase.sh staging|production
set -euo pipefail
target="${1:?usage: setup-supabase.sh staging|production}"
cd "$(dirname "$0")/.."
node scripts/with-database.cjs "$target" prisma migrate deploy
for f in ../supabase/migrations/*.sql; do
  echo "== $(basename "$f")"
  node scripts/with-database.cjs "$target" prisma db execute --file "$f" --schema prisma/schema.prisma
done
