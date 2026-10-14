#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_dir="${HOME}/.local/share/cinnamon/applets/tray-fold@kelvin"

for dependency in rsync msgfmt; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    echo "Missing dependency: ${dependency}. Install rsync and gettext first." >&2
    exit 1
  fi
done

locale_build_dir="$(mktemp -d)"
trap 'rm -rf -- "${locale_build_dir}"' EXIT

# Compile all catalogs before touching an existing installation.
for catalog in "${repo_dir}"/tray-fold@kelvin/po/*.po; do
  language="$(basename "${catalog}" .po)"
  mkdir -p "${locale_build_dir}/${language}/LC_MESSAGES"
  msgfmt --check --output-file="${locale_build_dir}/${language}/LC_MESSAGES/tray-fold@kelvin.mo" "${catalog}"
done

mkdir -p "${target_dir}"
rsync -a --delete \
  --exclude '.git' \
  --exclude '*.mo' \
  "${repo_dir}/tray-fold@kelvin/" \
  "${target_dir}/"

cp "${repo_dir}/LICENSE" "${repo_dir}/NOTICE" "${target_dir}/"
mkdir -p "${HOME}/.local/share/locale"
rsync -a "${locale_build_dir}/" "${HOME}/.local/share/locale/"

echo "Installed tray-fold@kelvin to ${target_dir}"
echo "Translations installed. Add Tray Fold through Cinnamon applet settings, or reload the existing applet."
