#!/usr/bin/env bash
# A server is OPTIONAL — double-clicking EDITOR.html works on its own.
# This is only for testing the site the way it will run once published.
cd "$(dirname "$0")" || exit 1
PY=""
for c in python3 python py; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -z "$PY" ]; then
  echo ""
  echo "  Python was not found, so the local server cannot start."
  echo "  You do not need it — just double-click EDITOR.html."
  echo ""
  read -r -p "  Press Enter to close." _
  exit 1
fi
PORT=8080
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
( sleep 1; (command -v open >/dev/null && open "http://localhost:$PORT/?edit") || \
           (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/?edit") ) &
echo ""
echo "  Site   : http://localhost:$PORT/"
echo "  Editor : http://localhost:$PORT/?edit"
echo ""
echo "  Keep this window open. Close it to stop."
echo ""
"$PY" -m http.server $PORT
