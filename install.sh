#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_dir="${HOME}/.local/share/cinnamon/applets/tray-fold@kelvin"

mkdir -p "${target_dir}"
rsync -a --delete \
  --exclude '.git' \
  --exclude '*.mo' \
  "${repo_dir}/tray-fold@kelvin/" \
  "${target_dir}/"

echo "Installed tray-fold@kelvin to ${target_dir}"
