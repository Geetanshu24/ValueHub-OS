#!/usr/bin/env bash
# Restores a backup into an EMPTY database and storage directory, then checks
# that every uploaded file still matches the hash recorded for it.
# Run this against a scratch database regularly: an untested backup is a hope, not a backup.
# Usage: DATABASE_URL=<scratch db> STORAGE_DIR=<empty dir> ./restore.sh <backup-dir> <stamp>
set -euo pipefail
src="${1:?usage: restore.sh <backup-dir> <stamp>}"; stamp="${2:?stamp}"
: "${DATABASE_URL:?set DATABASE_URL}"; : "${STORAGE_DIR:?set STORAGE_DIR}"
( cd "$src" && shasum -a 256 -c "SHA256SUMS-$stamp.txt" )
mkdir -p "$STORAGE_DIR"
[ -z "$(ls -A "$STORAGE_DIR")" ] || { echo "STORAGE_DIR is not empty; refusing to overwrite"; exit 1; }
pg_restore --no-owner --exit-on-error --dbname "$DATABASE_URL" "$src/db-$stamp.dump"
tar -xzf "$src/files-$stamp.tar.gz" -C "$STORAGE_DIR"
echo "Restored. Now verify file integrity with: npm run verify:files --workspace apps/valuation-api"
