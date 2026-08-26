#!/usr/bin/env bash
# Prepare a video for the archive from the command line, if you would rather
# not use the in-page editor. Makes a web-safe H.264 file plus a poster and
# prints the JSON block to paste into content/content.json.
#
#   tools/add-work.sh input.mov "Mycelium" organic 17
#
set -euo pipefail
IN="${1:?usage: add-work.sh <file> <title> <family> [hover-start-seconds]}"
TITLE="${2:?}"; FAMILY="${3:-organic}"; HOVER="${4:-0}"
ID="w$(date +%s | tail -c 6)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$DIR/media/posters"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN" | cut -d. -f1)
H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$IN")
Wd=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$IN")
if [ "$H" -gt "$Wd" ]; then SCALE="scale=1080:-2"; FIT="cover"; else SCALE="scale=-2:1080"; FIT="contain"; fi

echo "→ transcoding to H.264 …"
ffmpeg -v error -i "$IN" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p \
  -vf "$SCALE:flags=lanczos" -c:a aac -b:a 128k -movflags +faststart \
  -y "$DIR/media/$ID.mp4"

echo "→ poster …"
ffmpeg -v error -ss "$(echo "$DUR/3" | bc)" -i "$IN" -frames:v 1 -vf "scale=720:-2" \
  -y "$DIR/media/posters/$ID.jpg"

cat <<JSON

Paste this into the "works" array in content/content.json:

    {
      "id": "$ID",
      "title": "$TITLE",
      "family": "$FAMILY",
      "technique": "Realtime",
      "engine": "TouchDesigner",
      "year": $(date +%Y),
      "src": "media/$ID.mp4",
      "poster": "media/posters/$ID.jpg",
      "duration": $DUR,
      "previewStart": $HOVER,
      "fit": "$FIT"
    },
JSON
