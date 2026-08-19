#!/usr/bin/env python3
"""Bake the whole site into ONE .html file: styles, script, fonts, content and
the hero video, all inlined. It then works from anywhere — a Downloads folder,
a USB stick, even opened straight out of a zip."""
import base64, json, re, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
b64 = lambda p, mime: f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()

html = (root / 'index.html').read_text()
css  = (root / 'assets/style.css').read_text()
js   = (root / 'assets/app.js').read_text()
data = json.loads((root / 'content/content.json').read_text())

# --- fonts: only the weights the stylesheet actually asks for ---
faces = []
for fam, fname, weight in [
    ('Inter', 'inter-latin-300-normal.woff2', 300),
    ('Inter', 'inter-latin-400-normal.woff2', 400),
    ('Inter', 'inter-latin-500-normal.woff2', 500),
    ('Inter', 'inter-latin-700-normal.woff2', 700),
    ('JB',    'jetbrains-mono-latin-400-normal.woff2', 400),
    ('JB',    'jetbrains-mono-latin-500-normal.woff2', 500),
]:
    f = root / 'assets/fonts' / fname
    if f.exists():
        faces.append(f"@font-face{{font-family:{fam};src:url({b64(f,'font/woff2')})format('woff2');"
                     f"font-weight:{weight};font-display:swap}}")
fontcss = "\n".join(faces)

# --- hero video: the lighter cut, so the file stays sane ---
vid = root / 'media/hero/hero_mobile.mp4'
if not vid.exists(): vid = root / 'media/hero/hero.mp4'
data['hero']['video'] = b64(vid, 'video/mp4')
data['hero'].pop('videoMobile', None)
poster = root / 'media/hero/hero_poster.jpg'
if poster.exists(): data['hero']['poster'] = b64(poster, 'image/jpeg')

# --- swap the external references for inline blocks ---
html = html.replace('<link rel="stylesheet" href="assets/fonts.css">',
                    '<style>' + fontcss + '</style>')
html = html.replace('<link rel="stylesheet" href="assets/style.css">',
                    '<style>' + css + '</style>')
boot = ('<script type="application/json" id="bootstrap">\n'
        + json.dumps(data, ensure_ascii=False) + '\n</script>')
html = re.sub(r'<script type="application/json" id="bootstrap">.*?</script>',
              lambda m: boot, html, flags=re.S)
html = html.replace('<script src="assets/app.js"></script>', '<script>' + js + '</script>')

out = root / 'XMILE-preview.html'
out.write_text(html)
print(f"{out.name}  {out.stat().st_size/1048576:.1f} MB")
