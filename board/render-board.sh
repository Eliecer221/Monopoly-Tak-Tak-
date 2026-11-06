#!/usr/bin/env bash
# Regenera el SVG del tablero y lo convierte a PNG con Chromium headless.
# Uso:  ./board/render-board.sh [escala]   (por defecto 2 → 2048x2048)
set -euo pipefail
cd "$(dirname "$0")"
SCALE="${1:-2}"

node generate-board.mjs

cat > .render.html <<'HTML'
<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#eceef1}img{display:block;width:1024px;height:1024px}</style>
</head><body><img src="monopoly-tak-tak-board.svg"></body></html>
HTML

chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor="$SCALE" --window-size=1024,1024 \
  --screenshot="$(pwd)/monopoly-tak-tak-board.png" \
  "file://$(pwd)/.render.html" 2>/dev/null

rm -f .render.html
echo "PNG listo: board/monopoly-tak-tak-board.png"
