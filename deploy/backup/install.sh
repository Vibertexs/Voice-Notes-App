#!/usr/bin/env bash
# One-time setup of nightly backups on the EC2 host. Safe to run again.
#
#   cd ~/Voice-Notes-App && bash deploy/backup/install.sh
#
# What it does:
#   1. installs MongoDB Database Tools (mongodump/mongorestore), pinned
#   2. writes /etc/voiceflow-backup/mongodump.yml from the MONGODB_URI in the
#      repo's .env (mode 600; the secret is never printed)
#   3. writes backup.conf (non-secret settings)
#   4. installs the scripts, a log file with rotation, and a 03:15 UTC cron job
#
# It does not touch the running containers, AWS, or the bucket.
set -Eeuo pipefail

TOOLS_VERSION="100.14.1"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO/.env}"
CONF_DIR="/etc/voiceflow-backup"
BIN_DIR="/opt/voiceflow-backup"
LOG_FILE="/var/log/voiceflow-backup.log"
BUCKET="${BACKUP_BUCKET:-voiceflow-backups-bilal}"
REGION="${BACKUP_REGION:-us-west-2}"

say() { printf '==> %s\n' "$*"; }
[ "$(id -u)" -ne 0 ] || { echo "Run as the normal user (it uses sudo where needed), not as root."; exit 1; }
[ -r "$ENV_FILE" ] || { echo "Cannot read $ENV_FILE"; exit 1; }
command -v aws >/dev/null || { echo "The AWS CLI is not installed (sudo snap install aws-cli --classic)."; exit 1; }

# ---- 1. tools ---------------------------------------------------------------
if command -v mongodump >/dev/null && mongodump --version 2>&1 | grep -q "$TOOLS_VERSION"; then
  say "MongoDB Database Tools $TOOLS_VERSION already installed"
else
  say "installing MongoDB Database Tools $TOOLS_VERSION"
  arch=$(uname -m); [ "$arch" = "x86_64" ] || { echo "unsupported architecture $arch"; exit 1; }
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/tools.tgz" "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2404-x86_64-${TOOLS_VERSION}.tgz"
  tar -xzf "$tmp/tools.tgz" -C "$tmp"
  sudo install -m 0755 "$tmp"/mongodb-database-tools-*/bin/mongodump  /usr/local/bin/mongodump
  sudo install -m 0755 "$tmp"/mongodb-database-tools-*/bin/mongorestore /usr/local/bin/mongorestore
fi
mongodump --version 2>&1 | head -1

# ---- 2/3. secret config + settings ------------------------------------------
sudo install -d -m 0700 -o "$USER" -g "$USER" "$CONF_DIR"
uri=$(grep -m1 '^MONGODB_URI=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
[ -n "$uri" ] || { echo "MONGODB_URI is not set in $ENV_FILE"; exit 1; }
db=$(grep -m1 '^MONGODB_DB=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r"' || true)
umask 077
# YAML double-quoted string: escape backslashes and quotes.
printf 'uri: "%s"\n' "$(printf '%s' "$uri" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')" > "$CONF_DIR/mongodump.yml"
chmod 600 "$CONF_DIR/mongodump.yml"
printf 'BACKUP_BUCKET=%s\nBACKUP_REGION=%s\nBACKUP_DB=%s\n' "$BUCKET" "$REGION" "${db:-voiceflow}" > "$CONF_DIR/backup.conf"
unset uri
say "wrote $CONF_DIR/mongodump.yml (mode 600) and backup.conf"

# ---- 4. scripts, log, cron --------------------------------------------------
sudo install -d -m 0755 "$BIN_DIR"
sudo install -m 0755 "$REPO/deploy/backup/backup.sh"  "$BIN_DIR/backup.sh"
sudo install -m 0755 "$REPO/deploy/backup/restore.sh" "$BIN_DIR/restore.sh"

sudo touch "$LOG_FILE"; sudo chown "$USER":"$USER" "$LOG_FILE"; sudo chmod 640 "$LOG_FILE"
sudo tee /etc/logrotate.d/voiceflow-backup >/dev/null <<EOF
$LOG_FILE {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
EOF

job="15 3 * * * $BIN_DIR/backup.sh >> $LOG_FILE 2>&1"
( crontab -l 2>/dev/null | grep -v "$BIN_DIR/backup.sh" || true; echo "$job" ) | crontab -
say "cron installed: $job"
echo
echo "Next: run one backup now to prove it works:  $BIN_DIR/backup.sh"
