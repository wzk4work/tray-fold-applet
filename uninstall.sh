#!/usr/bin/env bash
set -euo pipefail

# Remove Tray Fold from the panel first so Cinnamon restores its tray icons.
target_dir="${HOME}/.local/share/cinnamon/applets/tray-fold@kelvin"
rm -rf -- "${target_dir}"

shopt -s nullglob
for catalog in "${HOME}"/.local/share/locale/*/LC_MESSAGES/tray-fold@kelvin.mo; do
  rm -f -- "${catalog}"
done

echo "Uninstalled tray-fold@kelvin. Saved Cinnamon settings were retained."
