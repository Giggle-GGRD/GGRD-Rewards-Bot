#!/usr/bin/env bash
set -euo pipefail

# Run from repo root on VPS
# Requires: docker (with compose), gzip
# Reads credentials from ./.env (MONGO_ROOT_USER, MONGO_ROOT_PASS, MONGODB_DB)

if [[ ! -f ".env" ]]; then
  echo "Missing .env in repo root" >&2
  exit 1
fi

# shellcheck disable=SC1091
source ./.env

: "${MONGO_ROOT_USER:?Missing MONGO_ROOT_USER in .env}"
: "${MONGO_ROOT_PASS:?Missing MONGO_ROOT_PASS in .env}"
: "${MONGODB_DB:?Missing MONGODB_DB in .env}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="backups"
OUT_FILE="${OUT_DIR}/mongo_${MONGODB_DB}_${TS}.archive.gz"

mkdir -p "${OUT_DIR}"

echo "Backing up MongoDB db=${MONGODB_DB} -> ${OUT_FILE}"
docker exec ggrd-mongo mongodump \
  --username "${MONGO_ROOT_USER}" \
  --password "${MONGO_ROOT_PASS}" \
  --authenticationDatabase "admin" \
  --db "${MONGODB_DB}" \
  --archive | gzip -9 > "${OUT_FILE}"

echo "OK"
