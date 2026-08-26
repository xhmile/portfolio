# XMILE — archive

A static portfolio. One HTML file, one CSS file, one JS file, and **all the
content in `content/content.json`**. No framework, no build step, no npm
install to deploy. That is deliberate: the fewer moving parts, the less there
is to break while a client is looking at it.

---

## Open it

Unzip the folder first. Then double-click:

- **`EDITOR.html`** (`РЕДАКТОР.html`) — upload video, edit every text
- **`index.html`** — the site as visitors see it
- **`XMILE-preview.html`** — one self-contained file to send to someone

No server, no install. Chrome and Edge allow both localStorage and IndexedDB
on a `file://` page, so uploads and edits survive a reload straight off the
disk. The editor probes this on startup and says plainly in the bottom bar
what it is able to keep.

`START-windows.bat` / `START-mac-linux.command` are **optional**. They serve
the folder over `http://localhost:8080` so you can check the site behaves the
way it will once published. They need Python; if it is missing they say so and
point you back to the double-click route rather than leaving a dead browser
tab.

If you edit `content/content.json` by hand, run `tools/sync-bootstrap.sh`
afterwards so the copy inside `index.html` matches. The deployed site never
depends on that copy — it always reads the real file.

---

## How it behaves

**Hover plays with sound.** Move the pointer onto a tile and that piece starts
playing with its own audio, fading in over about a quarter of a second. Move
off and it fades out. Only ever one plays at a time, so it never turns into
noise.

There is one thing no website can get around: **browsers refuse to play sound
until the visitor has interacted with the page.** So the site opens with
`SOUND / OFF` in the corner and the first click anywhere — the sound button,
a tile, anywhere — switches it on. After that, hover carries audio.

**Click a tile** for the fullscreen player: real controls, arrow keys for
previous and next, `Esc` to close.

**On phones** there is no hover, so the first tap previews with sound and the
second opens the player. The wall drops to two columns.

**Nothing hard-fails.** A work with no video file shows as a dimmed empty
slot. A file the browser cannot decode leaves the poster in place. A missing
`content.json` shows one honest line of text instead of a blank page.

---

## The editor (`/?edit`)

- **Upload into a tile** — click the `+` on an empty slot, or drag a video
  file straight onto it. Pick the file and the dialog reads it locally: size,
  resolution, length, and whether it is vertical or horizontal.
- **Poster frame** — drag the slider, the preview scrubs, and the frame you
  land on becomes the tile image. It is captured in your browser, so no
  separate upload and no waiting.
- **Hover start** — the second slider sets where playback begins when someone
  hovers the tile. Put it on the drop, not on the intro.
- **Titles, family, technique, engine, year** — plain fields.
- **Reorder** — drag tiles around.
- **Delete** — the button in the dialog.
- **All the site copy** — headline, intro, column labels, footer — is editable
  in place. Click the text and type.
- **Replace the hero video** — the button in the bottom bar.

With the repository configured — it already is — every upload is committed
straight into it and **Save** publishes `content.json`. Nothing is uploaded by
hand. Opened from a local folder with no token entered, edits stay in the
browser and `Download everything (.zip)` gives you the whole thing back, which
is the offline fallback if anything else fails.

### Export settings that matter

Export **H.264 .mp4** from Resolve. HEVC will not play in most browsers, and
your source file already is HEVC. For vertical work, 1080×1920, CRF 22–26,
AAC audio at 128 kbps. That lands around 1 MB per second of video at the
quality this design needs.

---

## Publishing

The site is served by **GitHub Pages** from the root of this repository, on the
domain in `CNAME`. There is nothing to build and no third-party service in the
path.

### How a change reaches the live site

Open `https://<your-domain>/?edit`, from a laptop or a phone. The first upload
asks once for a GitHub token with **Contents: read and write** on this
repository; the browser keeps it and never asks again.

- **A video** is committed to `media/` the moment you pick it.
- **Save** commits `content/content.json`.

Pages rebuilds within about half a minute. Nothing is downloaded, sorted into
folders, or re-uploaded by hand.

The token lives in that one browser and goes nowhere else. Treat it like a
password: if it is ever pasted anywhere public, revoke it at
`github.com/settings/tokens` and let the editor ask for a new one.

### Size

GitHub refuses a single file over 100 MB, and the editor stops at **45 MB** so
an upload fails up front instead of halfway. At the export settings below that
is roughly 45 seconds of video, which is longer than any tile needs. A whole
Pages site should stay under 1 GB.

### If the archive ever outgrows that

Video moves to object storage and only then does a backend earn its place. The
Worker in `worker/` does exactly that against Cloudflare R2 — deploy it, put
its URL in `CONFIG.BACKEND` and the bucket URL in `CONFIG.MEDIA_BASE`, and
uploads go there instead. Until the size actually hurts, it is a moving part
that buys nothing.

## Why not Google Drive

Drive has no direct video streaming — the links it hands out are HTML viewer
pages, it throttles and rate-limits anything that starts getting traffic, and
it can change those URLs without warning. Embedding a portfolio on it breaks
in front of clients, which is precisely the failure you asked to avoid. Same
story for Dropbox links. Object storage with a real CDN in front is the
correct tool, and R2 is the cheap version of it.

---

## Layout of the folder

```
index.html              the page (served from the repository root)
CNAME                   the domain GitHub Pages answers on
assets/style.css        all styling
assets/app.js           site + editor, with CONFIG at the very top
assets/fonts.css        self-hosted Inter and JetBrains Mono
content/content.json    every piece of text and every work — the whole site
media/                  local video and posters (moves to R2 in production)
worker/                 the editor backend
tools/serve.sh          local preview server
tools/add-work.sh       command-line alternative to the editor
```

## The naming and grouping system

Works are filed under five visual families, because that is what someone
scanning for a look actually searches by:

| Family | What belongs in it |
| --- | --- |
| **Organic** | microscopy, growth, fibre, tissue, spores |
| **Metal** | chrome, obsidian, liquid metal, specular surfaces |
| **Structure** | geometry, grids, tessellation, architecture |
| **Particle** | dust, swarms, point clouds, dissolves |
| **Field** | smoke, fluid, volumetric, atmosphere |

Technique — Realtime, Audio-reactive, AI video, Composite — is a separate tag,
because a client asking "can you do this live?" is asking a different question
from "what does it look like".

Titles are one or two words, a concrete noun, no numbering and no `vol. 2`:
*Mycelium, Filament, Spore Field, Obsidian, Ferrofluid, Specular, Lattice,
Tessera, Dust Column, Swarm, Dissolve, Undertow, Vapour*. The index number
already carries the ordering, so the title does not have to.

Add a family by adding it to `families` in `content.json` — the filter row
builds itself from the data and only shows families that actually have work in
them.
