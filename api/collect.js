// api/collect.js
// Vercel Serverless handler (uses global fetch available in Vercel runtime).
// Requires Vercel environment variables:
// UPSTASH_REST_URL  (e.g. https://xxx.upstash.io)
// UPSTASH_REST_TOKEN (the REST token)
// UNIQUE_WINDOW_DAYS (optional, default 365)

const UPSTASH_URL = process.env.UPSTASH_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REST_TOKEN;
const UNIQUE_WINDOW_DAYS = Number(process.env.UNIQUE_WINDOW_DAYS || 365);

function envCheck() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function upstashCmd(cmdArray){
  // Upstash expects a JSON array as the POST body (e.g. ["PING"] or ["SISMEMBER","key","member"]).
  // Use global fetch provided by Vercel's Node runtime (Node 18+).
  if (typeof fetch === 'undefined') {
    // If fetch is not available, surface a clear error so logs show the cause.
    throw new Error('fetch_not_available_in_runtime');
  }

  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(cmdArray)
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch(e) { throw new Error('Upstash returned non-json: ' + text); }
  if (!res.ok) throw new Error('Upstash cmd failed: ' + res.status + ' ' + (json && json.error ? JSON.stringify(json.error) : text));
  return json;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  if (!envCheck()) {
    console.error('Missing UPSTASH_REST_URL or UPSTASH_REST_TOKEN');
    return res.status(500).json({ error: 'internal_error', reason: 'missing_upstash_credentials' });
  }

  let body = req.body;
  if (!body) {
    try { body = JSON.parse(await new Promise(r=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>r(d)); })); } catch(e){}
  }
  if (!body || !body.visitor_id) return res.status(400).json({ error: 'visitor_id required' });

  const vid = String(body.visitor_id);
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearKey = `unique:${year}`;
  const visitorKey = `visitor:${vid}`;
  const yearTTL = (UNIQUE_WINDOW_DAYS + 30) * 24 * 3600; // expire a bit after the window

  try {
    // 1) check membership
    const mem = await upstashCmd(["SISMEMBER", yearKey, vid]);
    const isMember = mem.result === 1 || mem.result === true;

    let isNewUnique = false;
    if (!isMember) {
      // add to set
      await upstashCmd(["SADD", yearKey, vid]);
      // ensure TTL set (use EXPIRE only if key was created or no TTL)
      await upstashCmd(["EXPIRE", yearKey, yearTTL]);
      isNewUnique = true;
    }

    // 2) update visitor hash (last_seen, fingerprint, ua, path)
    const nowISO = now.toISOString();
    const hfields = ["last_seen", nowISO, "fingerprint", body.fingerprint || '', "ua", (body.ua||'').slice(0,200), "path", (body.path||'')];
    await upstashCmd(["HSET", visitorKey].concat(hfields));
    // set TTL on visitor key (keep for longer than year)
    await upstashCmd(["EXPIRE", visitorKey, (UNIQUE_WINDOW_DAYS + 90) * 24 * 3600]);

    // 3) get current unique total (SCARD)
    const sc = await upstashCmd(["SCARD", yearKey]);
    const totalUnique = Number(sc.result || 0);

    return res.status(200).json({ ok: true, new_unique: isNewUnique, year: year, total_unique: totalUnique });
  } catch (e) {
    console.error('collect error', e && e.message ? e.message : e);
    // Provide limited error info for debugging without leaking secrets
    return res.status(500).json({ error: 'internal_error', reason: e && e.message ? e.message : String(e) });
  }
};
