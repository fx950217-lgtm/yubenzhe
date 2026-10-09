#!/bin/sh
set -eu
umask 077
BASE=/opt/yubenzhe
RELEASE=$(readlink -f "$BASE/ops/current")
case "$RELEASE" in "$BASE"/releases/*) ;; *) exit 1;; esac
IMAGE=$(cat "$BASE/ops/image")
case "$IMAGE" in yubenzhe-public:*) ;; *) exit 1;; esac
exec /usr/bin/docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 0:0 --pids-limit 64 --memory 128m --tmpfs /tmp:size=16m,mode=1777 -v "$BASE/ops:/status" -v "$BASE/backups:/backups:ro" -v "$RELEASE/scripts:/ops-scripts:ro" "$IMAGE" node /ops-scripts/health-probe.mjs https://66.42.56.29 /status/health.json /backups
