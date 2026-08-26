#!/usr/bin/env bash
# index.html carries a copy of content.json so the page also works when it is
# opened straight from disk. Run this after editing content.json by hand to
# keep the two in step. The deployed site never depends on it.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re
content = open('content/content.json').read().strip()
html = open('index.html').read()
new = '<script type="application/json" id="bootstrap">\n' + content + '\n</script>'
# lambda replacement: backslashes inside the JSON must survive verbatim
html = re.sub(r'<script type="application/json" id="bootstrap">.*?</script>',
              lambda m: new, html, flags=re.S)
open('index.html','w').write(html)
print('index.html bootstrap refreshed')
PY
