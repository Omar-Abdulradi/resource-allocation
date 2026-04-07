/* ═══════════════════════════════════════════════════
   /api/schedule.js  —  Namaa Consulting
═══════════════════════════════════════════════════ */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const JSONBIN_ID   = process.env.JSONBIN_ID;
const JSONBIN_KEY  = process.env.JSONBIN_KEY;
const JSONBIN_URL  = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const TARGET_URL   = 'https://resource-allocation-nine.vercel.app/api/send-email';
const QSTASH_BASE  = 'https://qstash-eu-central-1.upstash.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { time } = req.body;
  if (!time) return res.status(400).json({ error: 'Missing time' });

  try {
    /* 1 ── load existing scheduleId from JSONBin */
    const cfgRes = await fetch(`${JSONBIN_URL}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY }
    });
    const cfgJson = await cfgRes.json();
    const record  = cfgJson?.record || {};
    const oldId   = record.qstashScheduleId;

    /* 2 ── delete old schedule if exists */
    if (oldId) {
      await fetch(`${QSTASH_BASE}/v2/schedules/${oldId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${QSTASH_TOKEN}` }
      });
    }

    /* 3 ── build cron using Cairo timezone */
    const [h, m] = time.split(':').map(Number);
    const cron = `TZ=Africa/Cairo ${m} ${h} * * *`;

    /* 4 ── create new QStash schedule
       destination goes directly in the URL path (not encoded) */
    const schedRes = await fetch(`${QSTASH_BASE}/v2/schedules/${TARGET_URL}`, {
      method: 'POST',
      headers: {
        Authorization:    `Bearer ${QSTASH_TOKEN}`,
        'Content-Type':   'text/plain',
        'Upstash-Cron':   cron,
        'Upstash-Method': 'POST',
      },
    });

    const schedText = await schedRes.text();
    let schedJson;
    try { schedJson = JSON.parse(schedText); } catch { schedJson = {}; }

    if (!schedRes.ok) {
      throw new Error(`QStash error ${schedRes.status}: ${schedText}`);
    }

    const newId = schedJson.scheduleId;

    /* 5 ── save new scheduleId to JSONBin */
    const updatedRecord = Object.assign({}, record, { qstashScheduleId: newId });
    await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(updatedRecord)
    });

    return res.status(200).json({ ok: true, scheduleId: newId, cron });

  } catch (err) {
    console.error('[schedule]', err);
    return res.status(500).json({ error: err.message });
  }
}
