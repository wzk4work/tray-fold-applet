#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"
bash -n install.sh uninstall.sh scripts/check.sh
node --check tray-fold@kelvin/applet.js
python3 -c 'import json, pathlib; [json.loads(p.read_text()) for p in pathlib.Path("tray-fold@kelvin").glob("*.json")]'
msgfmt --check --output-file=/dev/null tray-fold@kelvin/po/zh_CN.po
node --test tests/applet.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
