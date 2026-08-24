#!/bin/sh
set -eu

support_root=${INTERVIEW_PREP_SUPPORT_ROOT:-"$HOME/Projects/interview-prep-support"}
cli="$support_root/tools/mcp-excalidraw/dist/bin.js"

if [ ! -f "$cli" ]; then
  echo "Pinned Excalidraw v2 CLI not found: $cli" >&2
  exit 1
fi

export PORT=3032
export HOST=127.0.0.1
export EXPRESS_SERVER_URL=http://127.0.0.1:3032
export ENABLE_CANVAS_SYNC=true
export EXCALIDRAW_NO_AUTOSTART=1

exec node "$cli" "$@"
