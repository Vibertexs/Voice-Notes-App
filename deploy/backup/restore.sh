#!/usr/bin/env bash
# Restore a VoiceFlow backup from S3.
#
#   restore.sh --list
#   restore.sh                              latest backup  -> voiceflow_restore_<date>
#   restore.sh --from <file>                a specific one -> voiceflow_restore_<date>
#   restore.sh --into mycopy                restore into a database you name
#   restore.sh --into voiceflow --overwrite-production
#                                           replace the live data (asks you to type the name)
#
# The default never touches production: the backup is loaded into a separate
# database next to it, so you can look before deciding. Run on the EC2 host.
#
# Not in the backup: the Atlas Search index (it is rebuilt when the API starts,
# or by `python -m backend.mongo_setup`). Validators and ordinary indexes are
# part of each collection's metadata and come back with the data.
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
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

from="latest"; into=""; overwrite=0; list=0
while [ $# -gt 0 ]; do
  case "$1" in
    --list) list=1 ;;
    --from) from="${2:?--from needs a file name}"; shift ;;
    --into) into="${2:?--into needs a database name}"; shift ;;
    --overwrite-production) overwrite=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

if [ "$list" = 1 ]; then
  aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX" \
    --query 'sort_by(Contents, &LastModified)[].[LastModified,Size,Key]' --output text
  exit 0
fi

command -v mongorestore >/dev/null || die "mongorestore is not installed (run install.sh)"
command -v aws >/dev/null          || die "the AWS CLI is not installed"
[ -r "$MONGO_CONFIG" ]             || die "cannot read $MONGO_CONFIG"

if [ "$from" = "latest" ]; then
  key=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX" \
    --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)
  { [ -n "$key" ] && [ "$key" != "None" ]; } || die "no backups in s3://$BUCKET/$PREFIX"
else
  key="${PREFIX}${from#"$PREFIX"}"
fi

target="${into:-${DB}_restore_$(date -u +%Y%m%d)}"
if [ "$target" = "$DB" ]; then
  [ "$overwrite" = 1 ] || die "'$DB' is the live database. Add --overwrite-production if you really mean it."
  log "WARNING: this REPLACES every collection in the live '$DB' database with the backup."
  printf 'Type the database name (%s) to continue: ' "$DB"
  read -r answer
  [ "$answer" = "$DB" ] || die "not confirmed; nothing was changed"
  extra=(--drop)
else
  [ "$overwrite" = 0 ] || die "--overwrite-production only applies when restoring into '$DB'"
  extra=()
fi

work=$(mktemp -d "$TMP_BASE/voiceflow-restore.XXXXXX")
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
file="$work/backup.archive.gz"

log "downloading s3://$BUCKET/$key"
aws s3 cp "s3://$BUCKET/$key" "$file" --only-show-errors || die "download failed"

expected=$(aws s3api head-object --bucket "$BUCKET" --key "$key" --query 'Metadata.sha256' --output text 2>/dev/null || true)
if [ -n "$expected" ] && [ "$expected" != "None" ]; then
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || die "checksum mismatch: the download is not the file that was uploaded"
  log "checksum verified"
else
  log "no checksum recorded on this object; skipping the check"
fi

log "restoring into database '$target'"
mongorestore --config="$MONGO_CONFIG" --archive="$file" --gzip \
  --nsInclude="${DB}.*" --nsFrom="${DB}.*" --nsTo="${target}.*" "${extra[@]}" --quiet 2>"$work/restore.err" \
  || { sed 's#mongodb\(+srv\)\?://[^ ]*#<uri hidden>#g' "$work/restore.err" >&2; die "mongorestore failed"; }

log "OK: '$target' restored from $key"
if [ "$target" != "$DB" ]; then
  log "Look it over, then remove it when you are done:  drop the '$target' database in Atlas or Compass."
fi
