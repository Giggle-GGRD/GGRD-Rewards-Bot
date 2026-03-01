#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/restore_mongo.sh backups/mongo_ggrd_bot_YYYYMMDDTHHMMSSZ.archive.gz
#
# WARNING: This overwrites the target DB content.

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup_file.archive.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "Missing .env in repo root" >&2
  exit 1
fi

# shellcheck disable=SC1091
source ./.env

: "${MONGO_ROOT_USER:?Missing MONGO_ROOT_USER in .env}"
: "${MONGO_ROOT_PASS:?Missing MONGO_ROOT_PASS in .env}"
: "${MONGODB_DB:?Missing MONGODB_DB in .env}"

echo "Restoring MongoDB db=${MONGODB_DB} from ${BACKUP_FILE}"
gunzip -c "${BACKUP_FILE}" | docker exec -i ggrd-mongo mongorestore \
  --username "${MONGO_ROOT_USER}" \
  --password "${MONGO_ROOT_PASS}" \
  --authenticationDatabase "admin" \
  --nsInclude "${MONGODB_DB}.*" \
  --archive --drop

echo "OK"
