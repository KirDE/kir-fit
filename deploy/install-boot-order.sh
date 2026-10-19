#!/usr/bin/env bash
set -euo pipefail

# The production database is the Plesk-managed PostgreSQL 13/main cluster.
# Do not restart that shared cluster during ordinary application deployments.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dropin_dir=/etc/systemd/system/postgresql@13-main.service.d
install -d -m 755 "$dropin_dir"
install -m 644 "$script_dir/postgresql-kir-fit-network.conf" "$dropin_dir/kir-fit-network.conf"
systemctl daemon-reload
systemctl enable docker.service postgresql.service
