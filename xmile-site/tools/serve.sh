#!/usr/bin/env bash
# Local preview with Range support, so video seeking works the same as in
# production. Plain `python3 -m http.server` cannot do that.
exec python3 "$(dirname "$0")/serve.py" "${1:-8080}"
