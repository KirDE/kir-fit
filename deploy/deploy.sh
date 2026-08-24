#!/usr/bin/env bash
set -euo pipefail
app_dir=/opt/kir-fit
repo_dir="$app_dir/repo"
lock_file=/var/lock/kir-fit-deploy.lock
exec 9>"$lock_file"
flock -n 9 || { echo "Deployment already running"; exit 1; }
cd "$repo_dir"
git fetch --prune origin main
git checkout -f main
git reset --hard origin/main
export APP_VERSION="$(git rev-parse --short HEAD)"
docker compose build --pull app seed
docker compose up -d db
docker compose run --rm seed
docker compose up -d app
docker compose ps
healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3210/api/health; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  docker compose logs --tail 100 app
  exit 1
fi
