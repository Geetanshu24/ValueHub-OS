#!/usr/bin/env bash
# Backs up ValueHub OS: a compressed Postgres dump and, when files are on local
# disk, the uploaded files. With Supabase Storage there is no local folder, so
# leave STORAGE_DIR unset and back the bucket up separately.
# Usage: DATABASE_URL=... [STORAGE_DIR=...] ./backup.sh /path/to/backup-dir
# Needs pg_dump (PostgreSQL client tools). Keep backups off the server they protect.
set -euo pipefail
dest="${1:?usage: backup.sh <backup-dir>}"
: "${DATABASE_URL:?set DATABASE_URL}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest"
pg_dump --format=custom --no-owner "$DATABASE_URL" --file "$dest/db-$stamp.dump"
if [ -n "${STORAGE_DIR:-}" ]; then
  tar -czf "$dest/files-$stamp.tar.gz" -C "$STORAGE_DIR" .
  ( cd "$dest" && shasum -a 256 "db-$stamp.dump" "files-$stamp.tar.gz" > "SHA256SUMS-$stamp.txt" )
else
  echo "STORAGE_DIR not set: files not backed up (use the Supabase bucket backup)."
  ( cd "$dest" && shasum -a 256 "db-$stamp.dump" > "SHA256SUMS-$stamp.txt" )
fi
echo "Backup written: $dest ($stamp)"
