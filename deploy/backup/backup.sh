#!/usr/bin/env bash
# Nightly backup of the VoiceFlow database to S3.
#
#   backup.sh            dump, verify, upload, clean up
#   backup.sh --check    exit non-zero if the newest backup is missing or stale
#
# Runs on the EC2 host from cron (not in Docker). Credentials: the MongoDB
# connection string is read from a mode-600 config file by mongodump itself,
# so it never appears on a command line (where `ps` would show it) or in the
# log. AWS access comes from the instance's IAM role; there are no keys.
#
# Everything is logged to stdout with timestamps; cron appends it to a file.
set -Eeuo pipefail

CONF_DIR="${BACKUP_CONF_DIR:-/etc/voiceflow-backup}"
# shellcheck disable=SC1091
[ -f "$CONF_DIR/backup.conf" ] && . "$CONF_DIR/backup.conf"

BUCKET="${BACKUP_BUCKET:-voiceflow-backups-bilal}"
PREFIX="${BACKUP_PREFIX:-mongodb/}"
REGION="${BACKUP_REGION:-us-west-2}"
DB="${BACKUP_DB:-voiceflow}"
MONGO_CONFIG="${BACKUP_MONGO_CONFIG:-$CONF_DIR/mongodump.yml}"
TMP_BASE="${BACKUP_TMPDIR:-/var/tmp}"
MIN_FREE_KB="${BACKUP_MIN_FREE_KB:-512000}"     # 500 MB of headroom
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"
export AWS_DEFAULT_REGION="$REGION"
export AWS_PAGER=""

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

on_error() { log "ERROR: backup failed near line $1 (exit $2)"; }
trap 'on_error $LINENO $?' ERR

# ---------------------------------------------------------------------------
if [ "${1:-}" = "--check" ]; then
  newest=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX" \
    --query 'sort_by(Contents, &LastModified)[-1].[Key,LastModified,Size]' --output text 2>/dev/null || true)
  [ -n "$newest" ] && [ "$newest" != "None" ] || die "no backups found in s3://$BUCKET/$PREFIX"
  key=$(printf '%s' "$newest" | cut -f1); when=$(printf '%s' "$newest" | cut -f2); size=$(printf '%s' "$newest" | cut -f3)
  age_hours=$(( ( $(date -u +%s) - $(date -u -d "$when" +%s) ) / 3600 ))
  log "newest backup: $key ($size bytes, ${age_hours}h old)"
  [ "$age_hours" -le "$MAX_AGE_HOURS" ] || die "newest backup is ${age_hours}h old (limit ${MAX_AGE_HOURS}h)"
  exit 0
fi

# ---------------------------------------------------------------------------
command -v mongodump >/dev/null    || die "mongodump is not installed (run install.sh)"
command -v mongorestore >/dev/null || die "mongorestore is not installed (run install.sh)"
command -v aws >/dev/null          || die "the AWS CLI is not installed"
[ -r "$MONGO_CONFIG" ]             || die "cannot read $MONGO_CONFIG (run install.sh)"

# One backup at a time. If the previous night's is somehow still running,
# skip rather than pile on.
if command -v flock >/dev/null; then
  exec 9>"${TMP_BASE}/voiceflow-backup.lock"
  flock -n 9 || { log "another backup is already running; skipping"; exit 0; }
fi

free_kb=$(df -Pk "$TMP_BASE" | awk 'NR==2 {print $4}')
[ "$free_kb" -ge "$MIN_FREE_KB" ] || die "only ${free_kb} KB free in $TMP_BASE (need $MIN_FREE_KB)"

work=$(mktemp -d "$TMP_BASE/voiceflow-backup.XXXXXX")
# The temp dir holds a full copy of the data, so it goes whether we succeed or
# fail, and is readable by this user alone.
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="${DB}-${stamp}.archive.gz"
file="$work/$name"

log "dumping database '$DB' (mongodump $(mongodump --version 2>&1 | head -1 | awk '{print $NF}'))"
mongodump --config="$MONGO_CONFIG" --db="$DB" --archive="$file" --gzip --quiet 2>"$work/dump.err" \
  || { sed 's#mongodb\(+srv\)\?://[^ ]*#<uri hidden>#g' "$work/dump.err" >&2; die "mongodump failed"; }

size=$(wc -c <"$file" | tr -d ' ')
[ "$size" -gt 200 ] || die "archive is only $size bytes; refusing to upload"
log "dump complete: $size bytes"

# Prove the archive can be read back before trusting it. --dryRun parses the
# whole archive and reports what it would restore, without writing anything.
log "verifying archive"
mongorestore --config="$MONGO_CONFIG" --archive="$file" --gzip --dryRun -v 2>"$work/verify.err" >/dev/null \
  || { sed 's#mongodb\(+srv\)\?://[^ ]*#<uri hidden>#g' "$work/verify.err" >&2; die "archive failed verification"; }
collections=$(grep -c 'found collection .* bson to restore' "$work/verify.err" || true)
[ "$collections" -gt 0 ] || die "verification found no collections in the archive"
log "archive verified: $collections collections"

sum=$(sha256sum "$file" | cut -d' ' -f1)
dest="s3://$BUCKET/${PREFIX}${name}"
log "uploading to $dest"
aws s3 cp "$file" "$dest" --only-show-errors \
  --metadata "sha256=$sum,database=$DB,source=voiceflow-backup.sh" \
  || die "upload failed"

# The CLI already checks integrity in transit; this confirms the object that
# landed is the one we sent.
remote=$(aws s3api head-object --bucket "$BUCKET" --key "${PREFIX}${name}" --query ContentLength --output text) \
  || die "could not read the uploaded object back"
[ "$remote" = "$size" ] || die "size mismatch: local $size bytes, S3 $remote bytes"

log "OK: $dest ($size bytes, sha256 ${sum:0:12}...)"
