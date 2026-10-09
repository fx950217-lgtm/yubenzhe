#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
printf 'This check does not change services, firewall rules or files.\n'
test -f public/frontend/index.html || { printf 'Missing staged frontend.\n' >&2; exit 1; }
test -f public/admin/index.html || { printf 'Missing built admin UI.\n' >&2; exit 1; }
test -f secrets/admin.json && test -f secrets/frontend.json || { printf 'Create private authentication files first.\n' >&2; exit 1; }
command -v docker >/dev/null || { printf 'Docker is absent; do not install over an existing host without review.\n' >&2; exit 1; }
docker compose version
docker compose config --quiet
printf 'Check the intended host ports below; any listener means choose unused ports in .env.\n'
if command -v ss >/dev/null; then ss -ltn | awk 'NR==1 || /:(18808|18809)[[:space:]]/'; fi
printf 'Current Docker projects (read-only):\n'
docker compose ls
printf 'Preflight inspected files/config. Review port output before starting.\n'
