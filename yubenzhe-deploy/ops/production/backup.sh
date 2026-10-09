#!/bin/sh
set -eu
umask 077
BASE=/opt/yubenzhe
RELEASE=$(readlink -f "$BASE/ops/current")
case "$RELEASE" in "$BASE"/releases/*) ;; *) echo "Invalid release path" >&2; exit 1;; esac
IMAGE=$(cat "$BASE/ops/image")
case "$IMAGE" in yubenzhe-public:*) ;; *) echo "Invalid image" >&2; exit 1;; esac
# SQLite WAL readers may create shared-memory files after a clean shutdown.
# The script opens each source DatabaseSync with readOnly:true; mounts permit only the application UID.
exec /usr/bin/flock -n "$BASE/ops/backup.lock" /usr/bin/docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 --pids-limit 64 --memory 192m --tmpfs /tmp:size=16m,mode=1777 -v "$BASE/shared/social-state:/sources/social" -v "$BASE/ai-state:/sources/ai" -v "$BASE/state:/sources/admin" -v "$BASE/backups/scheduled:/backups" -v "$RELEASE/scripts:/ops-scripts:ro" "$IMAGE" node /ops-scripts/backup-suite.mjs backup /sources /backups 14
