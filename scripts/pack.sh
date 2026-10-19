#!/usr/bin/env bash
# Zip a skill for download: scripts/pack.sh html-recording [out.zip]
set -euo pipefail
cd "$(dirname "$0")/../skills"
name="$1"; out="$(cd .. && pwd)/${2:-dist/$name.zip}"
mkdir -p "$(dirname "$out")"; rm -f "$out"
zip -qr -X "$out" "$name" -x '*/node_modules/*' '*.DS_Store'
echo "$out ($(($(wc -c < "$out") / 1000)) KB)"
