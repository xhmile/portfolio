/**
 * XMILE — editor backend (Cloudflare Worker)
 *
 * Three jobs, nothing more:
 *   GET  /sign?key=media/w03.mp4   → a one-time URL the browser can PUT the file to
 *   PUT  /content                  → overwrite content.json in R2
 *   GET  /content                  → read content.json back
 *
 * The public site never talks to this Worker. It only reads content.json.
 * So if the Worker is down, misconfigured or deleted, visitors still see
 * the site exactly as it was — nothing to break in front of a client.
 *
 * Deploy:
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler r2 bucket create xmile-media
 *   wrangler secret put EDITOR_KEY        (this is your editor password)
 *   wrangler deploy
 */

const CORS = origin => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
  'access-control-allow-headers': 'content-type,x-xmile-key',
  'access-control-max-age': '86400'
});

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = CORS(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // ---- read content.json (public) ----
    if (u.pathname === '/content' && req.method === 'GET') {
      const o = await env.MEDIA.get('content.json');
      if (!o) return json({ error: 'not found' }, 404, cors);
      return new Response(o.body, {
        headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-cache' }
      });
    }

    // ---- everything below needs the editor key ----
    const key = req.headers.get('x-xmile-key');
    if (!env.EDITOR_KEY || key !== env.EDITOR_KEY) return json({ error: 'unauthorized' }, 401, cors);

    // ---- write content.json ----
    if (u.pathname === '/content' && req.method === 'PUT') {
      const body = await req.text();
      try { JSON.parse(body); } catch (e) { return json({ error: 'invalid json' }, 400, cors); }
      // keep the previous version, so a bad save is always one copy away from undo
      const prev = await env.MEDIA.get('content.json');
      if (prev) await env.MEDIA.put('backups/content-' + Date.now() + '.json', prev.body);
      await env.MEDIA.put('content.json', body, {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' }
      });
      return json({ ok: true }, 200, cors);
    }

    // ---- hand out an upload URL ----
    if (u.pathname === '/sign' && req.method === 'GET') {
      const objKey = u.searchParams.get('key') || '';
      if (!/^media\/[A-Za-z0-9._\/-]+$/.test(objKey)) return json({ error: 'bad key' }, 400, cors);
      // The Worker itself proxies the upload: simplest thing that always works,
      // no S3 signing dance, no extra credentials in the browser.
      const uploadUrl = `${u.origin}/upload?key=${encodeURIComponent(objKey)}&t=${encodeURIComponent(key)}`;
      const publicUrl = `${env.PUBLIC_BASE.replace(/\/$/, '')}/${objKey}`;
      return json({ uploadUrl, publicUrl }, 200, cors);
    }

    // ---- receive the upload ----
    if (u.pathname === '/upload' && req.method === 'PUT') {
      if (u.searchParams.get('t') !== env.EDITOR_KEY) return json({ error: 'unauthorized' }, 401, cors);
      const objKey = u.searchParams.get('key') || '';
      if (!/^media\/[A-Za-z0-9._\/-]+$/.test(objKey)) return json({ error: 'bad key' }, 400, cors);
      const type = objKey.endsWith('.jpg') ? 'image/jpeg'
        : objKey.endsWith('.png') ? 'image/png'
        : objKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
      await env.MEDIA.put(objKey, req.body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' }
      });
      return json({ ok: true, key: objKey }, 200, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  }
};

function json(o, status, cors) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...cors, 'content-type': 'application/json' }
  });
}
