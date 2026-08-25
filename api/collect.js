// api/collect.js
// Vercel Serverless handler. 需要在 Vercel 环境变量中设置:
// UPSTASH_REST_URL 例如 https://xxx.upstash.io
// UPSTASH_REST_TOKEN 例如 <token>
// UNIQUE_WINDOW_DAYS  默认 365
//
// 工作流程（简化）:
// 1) 接收 visitor_id（必需）
// 2) yearKey = "unique:YYYY" (例如 unique:2026)，检查 SISMEMBER yearKey visitor_id
// 3) 若未见过 -> SADD yearKey visitor_id 并设置年 key TTL（>365天），并认为是新 unique
// 4) 更新 visitors:{visitor_id} hash 的 last_seen / fingerprint / ua
// 5) 返回 whether-new 和当前年度独立访客总数（SCARD yearKey）

const fetch = require('node-fetch');

const UPSTASH_URL = process.env.UPSTASH_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REST_TOKEN;
const UNIQUE_WINDOW_DAYS = Number(process.env.UNIQUE_WINDOW_DAYS || 365);

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('Missing UPSTASH_REST_URL or UPSTASH_REST_TOKEN');
}

async function upstashCmd(cmdArray){
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify({ cmd: cmdArray })
  });
  if (!res.ok) throw new Error('Upstash cmd failed: ' + res.status + ' ' + await res.text());
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

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
    console.error('collect error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
};
