#!/usr/bin/env bash
# One-off: the recorder's dependencies and the Chromium it drives
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules/@rrweb/record ] && [ -d node_modules/playwright ] || npm install --silent
npx playwright install chromium >/dev/null
echo "html-recording tools ready: $(pwd)"
