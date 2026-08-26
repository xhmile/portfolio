/* ============================================================
   XMILE — archive
   One file. No build step. Reads everything from content/content.json.
   ?edit  → in-page editor (upload a video straight into a tile).
   ============================================================ */
(() => {
'use strict';

/* ---------- config ----------------------------------------------------
   Set BACKEND to your Worker URL to store data + video in Cloudflare R2.
   Leave it empty and edit mode still works locally: changes live in your
   browser and you download content.json by hand. Nothing can break the
   public site, because the public site only ever reads content.json.
--------------------------------------------------------------------- */
const CONFIG = {
  // Where content.json is published from the editor.
  //   GITHUB — commits straight to a repo. Cloudflare Pages redeploys on push,
  //            and it is the one place a person and an assistant can both write.
  //   BACKEND — a Cloudflare Worker, used for uploading video into R2.
  // Either can be empty. With both empty everything still works locally.
  GITHUB: {
    repo:   'xhmile/portfolio',
    branch: 'main',
    path:   'content/content.json'
  },
  BACKEND: '',            // 'https://xmile-api.<you>.workers.dev'
  MEDIA_BASE: '',         // 'https://pub-xxxxx.r2.dev/'  — where video lives
  HOVER_DELAY: 90,        // ms before a hovered tile starts
  FADE: 260               // ms audio fade
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = n => String(n).padStart(2, '0');
const mmss = s => { s = Math.max(0, Math.round(s || 0)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); };
const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const url = p => {
  if (!p) return '';
  if (/^(https?:|blob:|data:)/.test(p)) return p;
  return BLOBS.get(p) || CONFIG.MEDIA_BASE + p;
};

let DATA = null;
let OFFLINE = false;              // opened as a file:// page

/* Grab the baked-in copy immediately, while the DOM is still intact. Reading
   it later is not safe: any code path that rewrites document.body would take
   the tag with it. */
const BOOTSTRAP = (() => {
  const tag = document.getElementById('bootstrap');
  if (!tag) return null;
  try { return JSON.parse(tag.textContent); }
  catch (e) { console.warn('[xmile] baked-in content is not valid JSON:', e.message); return null; }
})();

/* ---------------------------------------------------------------------
   Local media store.
   With no backend configured, an uploaded file would otherwise vanish the
   moment the tab reloads. So it goes into IndexedDB under the exact path the
   deployed site will use — 'media/w03.mp4' — and url() prefers the local copy
   when one exists. That means content.json is deploy-ready either way: the
   paths in it are real paths, not temporary blob handles.
--------------------------------------------------------------------- */
const BLOBS = new Map();          // path -> object URL
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise(res => {
      let rq;
      try { rq = indexedDB.open('xmile', 1); } catch (e) { return res(null); }
      rq.onupgradeneeded = () => rq.result.createObjectStore('media');
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => res(null);
    });
  },
  async put(key, blob) {
    const db = await this.open(); if (!db) return false;
    return new Promise(res => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(blob, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  },
  async del(key) {
    const db = await this.open(); if (!db) return;
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').delete(key);
  },
  async all() {
    const db = await this.open(); if (!db) return [];
    return new Promise(res => {
      const out = [];
      const tx = db.transaction('media', 'readonly');
      const st = tx.objectStore('media');
      const kq = st.getAllKeys(), vq = st.getAll();
      tx.oncomplete = () => { kq.result.forEach((k, i) => out.push([k, vq.result[i]])); res(out); };
      tx.onerror = () => res([]);
    });
  }
};
async function loadBlobs() {
  for (const [k, blob] of await idb.all()) {
    if (blob instanceof Blob) BLOBS.set(k, URL.createObjectURL(blob));
  }
}

/* localStorage throws on a file:// origin in some browsers — never let it
   take the page down with it */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
let VIEW = [];                 // works after filtering
let filter = 'all';
let soundOn = false;
let gestureSeen = false;
const EDIT = new URLSearchParams(location.search).has('edit');

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============================================================
   LOAD
   ============================================================ */
async function load() {
  await loadBlobs();

  // a locally-edited copy always wins while you are editing
  const local = store.get('xmile:draft');
  if (local) { try { DATA = JSON.parse(local); } catch (e) { /* broken draft, ignore */ } }

  // the published file is the source of truth
  if (!DATA) {
    try {
      const r = await fetch('content/content.json', { cache: 'no-cache' });
      if (r.ok) DATA = await r.json();
    } catch (e) { /* file:// blocks this — the copy baked into the page covers it */ }
  }

  // fallback: the copy baked into the page, so opening the file directly works
  if (!DATA && BOOTSTRAP) { DATA = BOOTSTRAP; OFFLINE = true; }

  if (!DATA) {
    document.body.innerHTML = '<p style="padding:40px 22px;color:#9C9C99;font:11px JB,monospace">' +
      'No content found. Unzip the folder first, then open index.html.</p>';
    return;
  }
  render();
  if (EDIT) startEditor();
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  // plain text bindings
  $$('[data-t]').forEach(el => { const v = dig(DATA, el.dataset.t); if (v != null) el.textContent = v; });

  $('#nav').innerHTML = (DATA.site.nav || []).map(n => `<span>${esc(n)}</span>`).join('');
  const mail = $('#mailLink');
  mail.textContent = DATA.site.email || '';
  mail.href = 'mailto:' + (DATA.site.email || '');

  // hero
  const hv = $('#heroVid');
  const wantMobile = matchMedia('(max-width:760px)').matches && DATA.hero.videoMobile;
  const src = url(wantMobile ? DATA.hero.videoMobile : DATA.hero.video);
  if (hv.dataset.src !== src) { hv.dataset.src = src; hv.src = src; }
  if (DATA.hero.poster) hv.poster = url(DATA.hero.poster);
  hv.play().catch(() => {});

  $('#heroCols').innerHTML = (DATA.hero.columns || []).map(c =>
    `<div><span class="lb">${esc(c.label)}</span><p>${esc(c.value)}</p></div>`).join('');

  // stats — auto values are computed, never typed by hand
  const real = DATA.works.filter(w => !w.placeholder);
  const totalSec = real.reduce((a, w) => a + (+w.duration || 0), 0);
  $('#stats').innerHTML = (DATA.stats || []).map(s => {
    let v = s.value;
    if (v === 'auto:count') v = real.length ? String(real.length) : '—';
    else if (v === 'auto:runtime') v = totalSec ? mmss(totalSec) : '—';
    return `<div><span class="lb">${esc(s.label)}</span><b>${esc(v)}</b></div>`;
  }).join('');
  $('#workCount').textContent = real.length
    ? real.length + (real.length === 1 ? ' work' : ' works')
    : DATA.works.length + ' slots';

  // filters, only for families that actually have work
  const used = new Set(DATA.works.filter(w => w.src).map(w => w.family));
  const fams = (DATA.families || []).filter(f => used.has(f.id));
  $('#chips').innerHTML =
    `<button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">All ${DATA.works.length}</button>` +
    fams.map(f => {
      const n = DATA.works.filter(w => w.family === f.id).length;
      return `<button class="chip ${filter === f.id ? 'on' : ''}" data-f="${f.id}" title="${esc(f.note || '')}">${esc(f.name)} ${n}</button>`;
    }).join('');
  $$('#chips .chip').forEach(c => c.onclick = () => { filter = c.dataset.f; render(); });

  renderWall();
}

function famName(id) {
  const f = (DATA.families || []).find(x => x.id === id);
  return f ? f.name : (id || '');
}

function renderWall() {
  VIEW = filter === 'all' ? DATA.works.slice() : DATA.works.filter(w => w.family === filter);
  const wall = $('#wall');
  wall.innerHTML = VIEW.map((w, i) => {
    const empty = !w.src;
    const sub = empty ? 'empty slot' : `${mmss(w.duration)} · ${String(w.technique || '').toLowerCase()}`;
    return `<article class="t ${w.fit === 'contain' ? 'contain' : 'cover'} ${+w.span === 2 ? 'span2' : ''} ${empty ? 'empty' : ''}"
        data-i="${i}" data-id="${esc(w.id)}" ${EDIT ? 'draggable="true"' : ''}>
      <div class="media">${w.poster ? `<img src="${esc(url(w.poster))}" alt="${esc(w.title)}"
        loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">` : ''}</div>
      <span class="n">${pad2(DATA.works.indexOf(w) + 1)}</span>
      ${w.family ? `<span class="fam">${esc(famName(w.family))}</span>` : ''}
      <div class="wv">${Array.from({ length: 16 }, () => '<i></i>').join('')}</div>
      <div class="pl"></div>
      <div class="cap"><b>${esc(w.title || 'Untitled')}</b><span>${esc(sub)}</span></div>
      ${EDIT ? `<div class="tedit"><div class="btns">${empty
        ? '<button class="plus" data-act="upload" title="Upload a video">+</button>'
        : '<button class="b" data-act="edit">Edit</button><button class="b" data-act="upload">Replace file</button>'}
        </div></div>` : ''}
    </article>`;
  }).join('');

  $$('.t', wall).forEach(bindTile);
  if (EDIT) bindTileEditing(wall);
}

/* ============================================================
   HOVER PLAYBACK WITH SOUND
   One element plays at a time. Audio needs one click anywhere first —
   every browser blocks sound until the visitor has interacted.
   ============================================================ */
let active = null;      // { tile, video, fadeTimer }
let hoverTimer = null;

function setSound(on) {
  soundOn = on;
  const b = $('#sndBtn');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  $('#sndLbl').textContent = on ? 'Sound / on' : 'Sound / off';
  $('#heroHint').textContent = on
    ? 'Hover a piece — it plays with its own sound'
    : 'Click anywhere once to allow sound, then hover a piece';
  if (active) fadeTo(active.video, on ? 1 : 0);
  $$('.t').forEach(t => t.classList.toggle('muted-hint', !on));
}

function fadeTo(v, target) {
  if (!v) return;
  clearInterval(v._fade);
  const from = v.volume, steps = Math.max(1, Math.round(CONFIG.FADE / 30));
  let i = 0;
  v.muted = false;
  v._fade = setInterval(() => {
    i++;
    v.volume = clamp(from + (target - from) * (i / steps), 0, 1);
    if (i >= steps) { clearInterval(v._fade); if (target === 0) v.muted = true; }
  }, 30);
}

function stopActive() {
  if (!active) return;
  const { tile, video } = active;
  active = null;
  tile.classList.remove('live');
  fadeTo(video, 0);
  setTimeout(() => { try { video.pause(); video.remove(); } catch (e) {} }, CONFIG.FADE + 40);
  if (tile._wv) { clearInterval(tile._wv); tile._wv = null; }
}

function playTile(tile, w) {
  if (!w.src) return;
  stopActive();
  const v = document.createElement('video');
  v.src = url(w.src);
  v.playsInline = true; v.loop = true; v.preload = 'auto';
  v.muted = true; v.volume = 0;
  tile.querySelector('.media').appendChild(v);
  active = { tile, video: v };

  const start = +w.previewStart || 0;
  const seekTo = t => { try { (v.fastSeek ? v.fastSeek(t) : (v.currentTime = t)); } catch (e) {} };
  const go = () => {
    const dur = isFinite(v.duration) ? v.duration : Infinity;
    const wantStart = start > 0 && start < dur - .3;
    if (wantStart) seekTo(start);
    v.play().then(() => {
      // some containers ignore a seek issued before playback — reapply once
      if (wantStart && v.currentTime < start - .4) seekTo(start);
      tile.classList.add('live');
      if (soundOn) fadeTo(v, 1);
      // waveform bars — decorative, cheap, no audio graph needed
      const bars = $$('.wv i', tile);
      tile._wv = setInterval(() => {
        bars.forEach(b => b.style.height = (18 + Math.random() * 80).toFixed(0) + '%');
      }, 110);
    }).catch(() => { /* the browser refused — poster stays, nothing breaks */ });
  };
  if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
}

function bindTile(tile) {
  const w = VIEW[+tile.dataset.i];
  if (!w) return;

  if (!EDIT && w.src) {
    tile.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => playTile(tile, w), CONFIG.HOVER_DELAY);
    });
    tile.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      if (active && active.tile === tile) stopActive();
    });
    tile.addEventListener('click', e => {
      if (e.target.closest('.tedit')) return;
      openPlayer(DATA.works.indexOf(w));
    });
    // touch: first tap previews with sound, second opens the player
    tile.addEventListener('touchstart', () => {
      if (!(active && active.tile === tile)) { playTile(tile, w); }
    }, { passive: true });
  }
}

/* ============================================================
   FULLSCREEN PLAYER
   ============================================================ */
let plIndex = -1;
function openPlayer(i) {
  const w = DATA.works[i]; if (!w || !w.src) return;
  plIndex = i;
  stopActive();
  $('#plTitle').textContent = w.title || 'Untitled';
  $('#plIdx').textContent = pad2(i + 1) + ' / ' + pad2(DATA.works.length);
  $('#plMeta').textContent = [w.technique, w.engine, w.year, mmss(w.duration)].filter(Boolean).join(' · ');
  $('#plFam').textContent = famName(w.family);
  const v = $('#plVid');
  v.src = url(w.src); v.currentTime = 0; v.muted = false; v.volume = 1;
  $('#player').classList.add('open');
  document.body.style.overflow = 'hidden';
  v.play().catch(() => {});
}
function closePlayer() {
  const v = $('#plVid'); v.pause(); v.removeAttribute('src'); v.load();
  $('#player').classList.remove('open');
  document.body.style.overflow = '';
  plIndex = -1;
}
function step(d) {
  const playable = DATA.works.map((w, i) => ({ w, i })).filter(x => x.w.src);
  if (!playable.length) return;
  let at = playable.findIndex(x => x.i === plIndex);
  at = (at + d + playable.length) % playable.length;
  openPlayer(playable[at].i);
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  $('#sndBtn').onclick = e => { e.stopPropagation(); setSound(!soundOn); };
  $('#plClose').onclick = closePlayer;
  $('#plPrev').onclick = () => step(-1);
  $('#plNext').onclick = () => step(1);
  $('#player').addEventListener('click', e => { if (e.target.id === 'player') closePlayer(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') closePlayer();
    if ($('#player').classList.contains('open')) {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    }
  });
  // the one gesture that unlocks audio
  addEventListener('pointerdown', () => {
    if (gestureSeen) return;
    gestureSeen = true;
    if (!soundOn) setSound(true);
  }, { once: true });
  addEventListener('resize', () => { /* swap hero source across the mobile break */
    const hv = $('#heroVid');
    const want = url(matchMedia('(max-width:760px)').matches && DATA.hero.videoMobile
      ? DATA.hero.videoMobile : DATA.hero.video);
    if (hv.dataset.src !== want) { hv.dataset.src = want; hv.src = want; hv.play().catch(() => {}); }
  });
  setSound(false);
  load();
}

/* ============================================================
   EDIT MODE
   Everything below only runs on ?edit and never ships behaviour
   to the public page.
   ============================================================ */
let dirty = false;
function markDirty(v = true) {
  dirty = v;
  $('#eDot').classList.toggle('dirty', v);
  // Locally there is nothing to save by hand — every edit is written to this
  // browser as it happens. "dirty" only ever means "not published yet".
  const live = store.get('xmile:repo') || CONFIG.GITHUB.repo || CONFIG.BACKEND;
  $('#eStatus').textContent = live
    ? (v ? 'edited · press Save to publish' : 'published')
    : 'kept in this browser · nothing published anywhere yet';
}
function saveDraft() {
  const ok = store.set('xmile:draft', JSON.stringify(DATA));
  markDirty(true);
  if (!ok) $('#eStatus').textContent = 'this browser refuses to store the draft — use Download content.json';
}

/* Whether uploads survive is a question about storage, not about the URL
   scheme. Chrome allows both localStorage and IndexedDB on a file:// page, so
   the editor works by double-clicking — probe instead of assuming. */
async function reportStorage() {
  const el = $('#eStatus');
  const repo = store.get('xmile:repo') || CONFIG.GITHUB.repo;
  if (repo) { el.textContent = 'publishes to ' + repo; return; }
  if (CONFIG.BACKEND) { el.textContent = 'connected to backend'; return; }
  const canText = store.set('xmile:probe', '1');
  store.del('xmile:probe');
  const canFiles = !!(await idb.open());
  el.textContent = canText && canFiles
    ? 'local — kept in this browser, not published yet'
    : canText ? 'text is kept, but this browser will not store video'
    : 'this browser stores nothing — use Download content.json';
}

function startEditor() {
  document.body.classList.add('edit');
  reportStorage();

  // make copy editable in place
  $$('[data-t]').forEach(el => {
    el.contentEditable = 'true';
    el.addEventListener('blur', () => {
      const path = el.dataset.t.split('.');
      let o = DATA; while (path.length > 1) o = o[path.shift()];
      o[path[0]] = el.textContent.trim();
      saveDraft();
    });
  });
  $$('#heroCols .lb, #heroCols p').forEach((el, k) => {
    el.contentEditable = 'true';
    el.addEventListener('blur', () => {
      const idx = Math.floor(k / 2), key = k % 2 === 0 ? 'label' : 'value';
      DATA.hero.columns[idx][key] = el.textContent.trim();
      saveDraft();
    });
  });

  $('#eExit').onclick = () => { location.href = location.pathname; };
  $('#eAdd').onclick = () => { addEmptySlot(); };
  $('#eExport').onclick = exportJson;
  $('#eFiles').onclick = downloadMedia;
  $('#eSave').onclick = publish;
  $('#eHero').onclick = () => pickFile(f => uploadHero(f));

  $('#dlgX').onclick = closeDlg;
  $('#dlgOk').onclick = commitDlg;
  $('#dlgDel').onclick = deleteCurrent;
  $('#dfFile').onchange = e => { if (e.target.files[0]) loadIntoDlg(e.target.files[0]); };
  $('#pf').oninput = e => { $('#pfT').textContent = (+e.target.value).toFixed(1); seekPreview(+e.target.value); };
  $('#hs').oninput = e => { $('#hsT').textContent = (+e.target.value).toFixed(1); };
  toast('Edit mode — click a + to upload');
}

function addEmptySlot() {
  DATA.works.push({
    id: 'n' + Date.now().toString(36), title: 'Untitled',
    family: (DATA.families[0] || {}).id || 'organic', technique: 'Realtime', engine: '',
    year: new Date().getFullYear(), src: '', poster: '', duration: 0, previewStart: 0,
    fit: 'cover', placeholder: true
  });
  saveDraft(); render();
}

function bindTileEditing(wall) {
  $$('.tedit [data-act]', wall).forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const tile = btn.closest('.t');
      const w = VIEW[+tile.dataset.i];
      // one dialog for everything: the file field lives inside it, so a
      // cancelled system picker cannot leave you staring at nothing
      openDlg(w, null);
      if (btn.dataset.act === 'upload') setTimeout(() => $('#dfFile').click(), 60);
    };
  });

  // drag to reorder
  let src = null;
  $$('.t', wall).forEach(t => {
    t.addEventListener('dragstart', e => { src = t; t.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    t.addEventListener('dragend', () => { src = null; $$('.t').forEach(x => x.classList.remove('drag', 'over')); });
    t.addEventListener('dragover', e => { e.preventDefault(); if (src && src !== t) t.classList.add('over'); });
    t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', e => {
      e.preventDefault(); t.classList.remove('over');
      if (!src || src === t) return;
      const a = DATA.works.indexOf(VIEW[+src.dataset.i]);
      const b = DATA.works.indexOf(VIEW[+t.dataset.i]);
      DATA.works.splice(b, 0, DATA.works.splice(a, 1)[0]);
      saveDraft(); render();
    });
    // drop a file straight onto a tile
    t.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    t.addEventListener('drop', e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('video/')) { e.preventDefault(); openDlg(VIEW[+t.dataset.i], f); }
    });
  });
}

function pickFile(cb) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = 'video/*';
  i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
  i.click();
}

/* ---------- the upload / poster dialog ---------- */
let dlgWork = null, dlgFile = null, dlgBlobUrl = null;

function openDlg(w, file) {
  dlgWork = w; dlgFile = null;
  $('#dlgTitle').textContent = file ? 'Upload into slot ' + pad2(DATA.works.indexOf(w) + 1) : 'Edit work';
  $('#dfFamily').innerHTML = DATA.families.map(f =>
    `<option value="${f.id}" ${f.id === w.family ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  $('#dfTitle').value = w.title === 'Untitled' ? '' : (w.title || '');
  $('#dfTech').value = w.technique || 'Realtime';
  $('#dfEngine').value = w.engine || '';
  $('#dfYear').value = w.year || new Date().getFullYear();
  $('#dfFit').value = w.fit || 'cover';
  $('#dfSpan').value = String(+w.span === 2 ? 2 : 1);
  $('#dlgDel').style.display = 'inline-block';
  $('#dlgStatus').textContent = '';
  const dv = $('#dv');
  dv.removeAttribute('src'); dv.load();
  if (file) loadIntoDlg(file);
  else if (w.src) { dv.src = url(w.src); setRanges(w.duration || 0, w.previewStart || 0); }
  $('#dlg').classList.add('open');
}

function loadIntoDlg(file) {
  dlgFile = file;
  if (dlgBlobUrl) URL.revokeObjectURL(dlgBlobUrl);
  dlgBlobUrl = URL.createObjectURL(file);
  const dv = $('#dv');
  dv.src = dlgBlobUrl;
  const mb = (file.size / 1048576).toFixed(1);
  dv.addEventListener('loadedmetadata', () => {
    setRanges(dv.duration, Math.min(dv.duration * .25, 20));
    const vert = dv.videoHeight > dv.videoWidth;
    $('#dfFit').value = vert ? 'cover' : 'contain';
    $('#dfSpan').value = vert ? '1' : '2';
    $('#dfInfo').textContent = `${dv.videoWidth}×${dv.videoHeight} · ${mmss(dv.duration)} · ${mb} MB` +
      (vert ? ' · vertical' : ' · horizontal, will sit letterboxed in the tile');
    if (!dv.videoWidth) $('#dfInfo').textContent = 'This browser cannot decode the file (HEVC?). Export H.264.';
  }, { once: true });
  dv.addEventListener('error', () => {
    $('#dfInfo').textContent = 'Cannot decode this file. Export H.264 .mp4 from Resolve and try again.';
  }, { once: true });
}

function setRanges(dur, hoverAt) {
  dur = Math.max(0.1, dur || 0.1);
  const pf = $('#pf'), hs = $('#hs');
  pf.max = dur.toFixed(1); hs.max = dur.toFixed(1);
  pf.value = Math.min(dur * .3, dur).toFixed(1);
  hs.value = Math.min(hoverAt, dur).toFixed(1);
  $('#pfT').textContent = (+pf.value).toFixed(1);
  $('#hsT').textContent = (+hs.value).toFixed(1);
  seekPreview(+pf.value);
}
function seekPreview(t) { const dv = $('#dv'); try { dv.currentTime = t; } catch (e) {} }

function grabPoster() {
  const dv = $('#dv');
  if (!dv.videoWidth) return Promise.resolve(null);
  const W = 720, H = Math.round(W * dv.videoHeight / dv.videoWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(dv, 0, 0, W, H);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', .84));
}

function closeDlg() { $('#dlg').classList.remove('open'); dlgWork = null; dlgFile = null; }

async function commitDlg() {
  if (!dlgWork) return;
  const w = dlgWork;
  w.title = $('#dfTitle').value.trim() || 'Untitled';
  w.family = $('#dfFamily').value;
  w.technique = $('#dfTech').value;
  w.engine = $('#dfEngine').value.trim();
  w.year = +$('#dfYear').value || new Date().getFullYear();
  w.fit = $('#dfFit').value;
  w.span = +$('#dfSpan').value === 2 ? 2 : 1;
  w.previewStart = +$('#hs').value || 0;

  const posterBlob = await grabPoster();

  if (dlgFile) {
    const dv = $('#dv');
    w.duration = Math.round(dv.duration || 0);
    $('#dlgStatus').textContent = 'uploading…';
    try {
      const ext = (dlgFile.name.match(/\.(mp4|webm|mov|m4v)$/i) || ['.mp4'])[0].toLowerCase();
      const vName = `${w.id}${ext === '.mov' || ext === '.m4v' ? '.mp4' : ext}`;
      w.src = await put(vName, dlgFile, p => $('#dlgStatus').textContent = 'uploading ' + p + '%');
      if (posterBlob) w.poster = await put(`posters/${w.id}.jpg`, posterBlob);
      delete w.placeholder;
    } catch (e) {
      $('#dlgStatus').textContent = 'upload failed: ' + e.message;
      return;
    }
  } else if (posterBlob) {
    try { w.poster = await put(`posters/${w.id}.jpg`, posterBlob); } catch (e) {}
  }

  saveDraft(); render(); closeDlg(); toast('Work saved');
}

function deleteCurrent() {
  if (!dlgWork) return;
  if (!confirm('Delete "' + (dlgWork.title || 'Untitled') + '" from the archive?')) return;
  const gone = dlgWork.src;
  DATA.works.splice(DATA.works.indexOf(dlgWork), 1);
  if (gone && !/^(https?:|blob:|data:)/.test(gone)) {
    idb.del(gone); const u = BLOBS.get(gone); if (u) URL.revokeObjectURL(u); BLOBS.delete(gone);
  }
  saveDraft(); render(); closeDlg(); toast('Deleted');
}

async function uploadHero(file) {
  toast('Uploading hero…');
  try {
    DATA.hero.video = await put('hero/hero.mp4', file, p => $('#eStatus').textContent = 'hero ' + p + '%');
    delete DATA.hero.videoMobile;
    saveDraft(); render(); toast('Hero replaced');
  } catch (e) { toast('Hero upload failed'); }
}

/* ---------- storage ----------
   With a backend: PUT through the Worker into R2, returns a public URL.
   Without one: keep the file in this browser session so you can see the
   result immediately, and warn that it is not published.
------------------------------- */
/* GitHub's contents API refuses very large files, and base64 inflates a
   file by a third on the way there. Stay well inside the limit and say so
   plainly rather than letting the upload fail halfway. */
const GH_MAX_BYTES = 45 * 1024 * 1024;

async function put(name, blob, onProgress) {
  const path = 'media/' + name;

  if (!CONFIG.BACKEND) {
    // Posters are tiny — inline them, so content.json alone shows the wall.
    if (/\.(jpg|png)$/i.test(name)) { if (onProgress) onProgress(100); return await blobToDataUrl(blob); }

    // Keep a local copy first: the tile plays immediately, and the draft
    // survives a reload even if the commit below never happens.
    const ok = await idb.put(path, blob);
    if (ok) {
      const old = BLOBS.get(path); if (old) URL.revokeObjectURL(old);
      BLOBS.set(path, URL.createObjectURL(blob));
    }

    // With a repository configured, the video is committed straight into it,
    // so the published site serves it and nothing has to be uploaded by hand.
    if (ghRepo()) {
      if (blob.size > GH_MAX_BYTES) {
        throw new Error(
          `${(blob.size / 1048576).toFixed(0)} MB is over the 45 MB limit. ` +
          `Re-export H.264 capped at 8000 kbps — that is roughly 1 MB per second, ` +
          `so anything under 45 seconds fits.`
        );
      }
      await putToGithub(path, blob, onProgress);
      return path;
    }

    if (!ok) { toast('Browser refused to store the file'); return URL.createObjectURL(blob); }
    if (onProgress) onProgress(100);
    return path;
  }

  const r = await fetch(CONFIG.BACKEND + '/sign?key=' + encodeURIComponent(path), {
    headers: { 'x-xmile-key': token() }
  });
  if (!r.ok) throw new Error('sign ' + r.status);
  const { uploadUrl, publicUrl } = await r.json();
  await xhrPut(uploadUrl, blob, onProgress);
  return publicUrl;
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}
function xhrPut(u, blob, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('PUT', u);
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => (x.status < 300 ? res() : rej(new Error('put ' + x.status)));
    x.onerror = () => rej(new Error('network'));
    x.send(blob);
  });
}
function token() {
  let t = store.get('xmile:token');
  if (!t) { t = prompt('Editor password') || ''; store.set('xmile:token', t); }
  return t;
}

async function publish() {
  if (ghRepo()) return publishToGithub();
  if (CONFIG.BACKEND) return publishToWorker();
  exportJson();
  toast('No repository set — downloaded content.json instead');
}

/* ---------- GitHub ----------
   content.json is committed straight to the repo. Cloudflare Pages redeploys
   on push, so the live site follows within about half a minute. This is also
   the one place another person — or an assistant — can write to without ever
   touching this computer.
--------------------------------- */
const gh = {
  api: (path, opts = {}) => fetch('https://api.github.com/repos/' + ghRepo() + path, {
    ...opts,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + ghToken(),
      ...(opts.headers || {})
    }
  })
};
function ghToken() {
  let t = store.get('xmile:gh');
  if (!t) {
    t = prompt('GitHub token (Contents: read and write on this repo)') || '';
    if (t) store.set('xmile:gh', t.trim());
  }
  return (t || '').trim();
}

/* Asked for once and remembered, so nobody has to edit a config file. */
function ghRepo() {
  if (CONFIG.GITHUB.repo) return CONFIG.GITHUB.repo;
  let r = store.get('xmile:repo');
  if (!r) {
    r = prompt('Repository, in the form username/xmile') || '';
    r = r.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (r) store.set('xmile:repo', r);
  }
  return r;
}

async function publishToGithub() {
  const { branch, path } = CONFIG.GITHUB;
  const el = $('#eStatus');
  el.textContent = 'publishing to github…';
  try {
    // the current file's sha is required, otherwise GitHub rejects the write
    let sha = null;
    const cur = await gh.api(`/contents/${path}?ref=${branch}`);
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status === 401 || cur.status === 403) {
      store.del('xmile:gh');
      throw new Error('token rejected — it was cleared, press Save again');
    }

    const body = JSON.stringify(DATA, null, 2);
    const r = await gh.api(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'content: update from the editor',
        content: b64utf8(body),
        branch,
        ...(sha ? { sha } : {})
      })
    });
    if (!r.ok) throw new Error((await r.json()).message || r.status);

    store.del('xmile:draft');
    markDirty(false);
    el.textContent = 'published — live in about 30 seconds';
    toast('Published to the repo');
  } catch (e) {
    el.textContent = 'publish failed: ' + e.message;
  }
}

/* btoa() only handles latin1, and the copy is full of em dashes */
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

/* String.fromCharCode(...bytes) blows the call stack on anything video-sized,
   so walk the buffer in chunks. */
async function b64binary(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* Commit one media file into the repository. The published site then serves
   it from its own origin, which is why src stays a plain relative path. */
async function putToGithub(path, blob, onProgress) {
  const { branch } = CONFIG.GITHUB;
  if (onProgress) onProgress(5);

  // GitHub needs the current sha to overwrite an existing file.
  let sha = null;
  const cur = await gh.api(`/contents/${path}?ref=${branch}`);
  if (cur.ok) sha = (await cur.json()).sha;
  else if (cur.status === 401 || cur.status === 403) {
    store.del('xmile:gh');
    throw new Error('token rejected — it was cleared, try again');
  }

  const content = await b64binary(blob);
  if (onProgress) onProgress(40);

  const r = await gh.api(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'media: ' + path.split('/').pop(),
      content,
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!r.ok) {
    let msg = r.status;
    try { msg = (await r.json()).message || msg; } catch (e) {}
    throw new Error(String(msg));
  }
  if (onProgress) onProgress(100);
}

async function publishToWorker() {
  $('#eStatus').textContent = 'publishing…';
  try {
    const r = await fetch(CONFIG.BACKEND + '/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-xmile-key': token() },
      body: JSON.stringify(DATA, null, 2)
    });
    if (!r.ok) throw new Error(r.status);
    store.del('xmile:draft');
    markDirty(false); toast('Published — live for everyone');
  } catch (e) { $('#eStatus').textContent = 'publish failed: ' + e.message; }
}

/* ---------- zip (STORE method, no compression, no dependency) ----------
   Video is already compressed, so there is nothing to gain from deflating
   it, and a tiny hand-rolled encoder keeps the "no build step" promise. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function u16(v) { return new Uint8Array([v & 255, (v >>> 8) & 255]); }
function u32(v) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }
function concatBytes(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function makeZip(entries) {
  const now = new Date();
  const dTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, blob } of entries) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(buf);
    const nameBytes = new TextEncoder().encode(name);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dTime), u16(dDate),
      u32(crc), u32(buf.length), u32(buf.length), u16(nameBytes.length), u16(0), nameBytes
    ]);
    parts.push(local, buf);
    const localOffset = offset;
    offset += local.length + buf.length;
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dTime), u16(dDate),
      u32(crc), u32(buf.length), u32(buf.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset), nameBytes
    ]));
  }
  const centralBytes = concatBytes(central);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0)
  ]);
  return new Blob([...parts, centralBytes, eocd], { type: 'application/zip' });
}

/* One zip: content/content.json plus every video, each named with the exact
   relative path the site expects — unzip straight on top of the project
   folder and everything lands where it belongs. */
async function downloadMedia() {
  const files = await idb.all();
  const entries = [{
    name: 'content/content.json',
    blob: new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' })
  }];
  for (const [key, blob] of files) entries.push({ name: key, blob });

  toast('Zipping…');
  const zip = await makeZip(entries);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = 'xmile-export.zip';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Unzip on top of the xmile-site folder — done');
}

function exportJson() {
  const b = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'content.json'; a.click();
  toast('content.json downloaded — put it in content/');
}

document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
})();
