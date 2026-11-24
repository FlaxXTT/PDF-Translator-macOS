#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$(cd "$ROOT/.." && pwd)/dist"
OUT_XPI="$OUT_DIR/pdf-translator-zotero.xpi"

mkdir -p "$OUT_DIR"
rm -f "$OUT_XPI"

cd "$ROOT"
zip -r -X "$OUT_XPI" \
  manifest.json \
  bootstrap.js \
  content \
  -x "*.DS_Store" "*__MACOSX*"

ls -lh "$OUT_XPI"
