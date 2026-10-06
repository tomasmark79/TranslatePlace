#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
glib-compile-schemas --strict schemas
gjs -m tests/protection.js
for source in extension.js prefs.js api.js history.js historyDialog.js protection.js; do
    node --check "$source"
done
mkdir -p dist
gnome-extensions pack --force --out-dir=dist \
    --schema=schemas/org.gnome.shell.extensions.translateplace.gschema.xml \
    --extra-source=api.js --extra-source=history.js --extra-source=historyDialog.js \
    --extra-source=protection.js .
