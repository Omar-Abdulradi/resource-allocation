/* ═══════════════════════════════════════════════════
   /api/send-email.js  —  Namaa Consulting
   Uses Gmail SMTP via nodemailer
═══════════════════════════════════════════════════ */

import nodemailer from 'nodemailer';

const BACKEND     = 'https://resource-allocation-nine.vercel.app/api/youtrack';
const JSONBIN_ID  = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const GMAIL_USER  = process.env.GMAIL_USER;
const GMAIL_PASS  = process.env.GMAIL_PASS;
const IGNORED     = ['system_user@x04x', 'Deleted User'];

function availMinutes(calDays) {
  return Math.floor(calDays * 5 / 7) * 8 * 60;
}

function pillColor(pct, threshold) {
  if (pct > threshold)                        return { bg: '#fdecea', color: '#c0392b' };
  if (pct >= Math.round(threshold * 0.85))    return { bg: '#fef6e4', color: '#92600a' };
  return                                             { bg: '#e6f4ed', color: '#1a6b3e' };
}

function aggregate(rawData) {
  const map = {};
  for (const item of rawData) {
    const login = item.author?.login || '';
    const name  = item.author?.fullName || login;
    if (!name || IGNORED.some(u => name.includes(u) || login.includes(u))) continue;
    const mins = item.duration?.minutes || 0;
    if (mins === 0) continue;
    const proj = item.issue?.project?.name || 'Unknown';
    if (!map[name]) map[name] = {};
    map[name][proj] = (map[name][proj] || 0) + mins;
  }
  return map;
}

function buildEmail(leader, aggWeek, aggMonth, threshold) {
  const projects = leader.projects;

  const usersSet = new Set();
  for (const agg of [aggWeek, aggMonth]) {
    for (const [user, projMap] of Object.entries(agg)) {
      for (const p of projects) {
        if (projMap[p]) usersSet.add(user);
      }
    }
  }
  const users = [...usersSet].sort();

  const availWk = availMinutes(7);
  const availMo = availMinutes(30);

  const stats = users.map(u => {
    const perProj = {};
    let totalWkMins = 0, totalMoMins = 0;
    for (const p of projects) {
      const wkMins = aggWeek[u]?.[p]  || 0;
      const moMins = aggMonth[u]?.[p] || 0;
      perProj[p] = {
        wk: wkMins > 0 ? Math.round((wkMins / availWk) * 100) : null,
        mo: moMins > 0 ? Math.round((moMins / availMo) * 100) : null,
      };
      totalWkMins += wkMins;
      totalMoMins += moMins;
    }
    return {
      name: u,
      perProj,
      totalWk: Math.round((totalWkMins / availWk) * 100),
      totalMo: Math.round((totalMoMins / availMo) * 100),
    };
  });

  const overCount = stats.filter(s => s.totalWk > threshold).length;
  const avgWk = stats.length
    ? Math.round(stats.reduce((a, s) => a + s.totalWk, 0) / stats.length)
    : 0;

  const projBadges = projects.map(p =>
    `<span style="display:inline-block;background:#e8f0fe;color:#1a56a0;border-radius:20px;font-size:11px;padding:2px 9px;margin:2px 2px;font-weight:600;">${p}</span>`
  ).join('');

  const thProjects = projects.map(p =>
    `<th colspan="2" style="border-bottom:none;padding:6px 10px 2px;color:#1a7f4b;font-size:11px;font-weight:700;text-align:center;border-left:1px solid #e0e0e0;">${p}</th>`
  ).join('');

  const thPeriods = projects.map(() =>
    `<th style="font-size:10px;color:#888;font-weight:600;padding:2px 8px 7px;text-align:center;border-left:1px solid #e0e0e0;">Wk</th>
     <th style="font-size:10px;color:#888;font-weight:600;padding:2px 8px 7px;text-align:center;">Mo</th>`
  ).join('');

  const rows = stats.map(s => {
    const totalWkC = pillColor(s.totalWk, threshold);
    const cells = projects.map(p => {
      const wk = s.perProj[p].wk;
      const mo = s.perProj[p].mo;
      const wkC = wk != null ? pillColor(wk, threshold) : null;
      const moC = mo != null ? pillColor(mo, threshold) : null;
      const wkCell = wk != null
        ? `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;background:${wkC.bg};color:${wkC.color};">${wk}%</span>`
        : `<span style="color:#ccc;">—</span>`;
      const moCell = mo != null
        ? `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;background:${moC.bg};color:${moC.color};">${mo}%</span>`
        : `<span style="color:#ccc;">—</span>`;
      return `<td style="padding:8px;text-align:center;border-bottom:1px solid #f0f0f0;border-left:1px solid #e0e0e0;">${wkCell}</td>
              <td style="padding:8px;text-align:center;border-bottom:1px solid #f0f0f0;">${moCell}</td>`;
    }).join('');

    return `<tr>
      <td style="padding:9px 14px;font-weight:600;font-size:13px;color:#1a1a1a;border-bottom:1px solid #f0f0f0;white-space:nowrap;">${s.name}</td>
      ${cells}
      <td style="padding:9px 12px;text-align:center;border-bottom:1px solid #f0f0f0;border-left:2px solid #d0d0d0;">
        <span style="display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;background:${totalWkC.bg};color:${totalWkC.color};">${s.totalWk}%</span>
      </td>
    </tr>`;
  }).join('');

  const today = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;">
  <tr><td style="background:#1a7f4b;padding:24px 28px;">
    <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Resource Allocation — Daily Snapshot</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">${today}</p>
  </td></tr>
  <tr><td style="padding:18px 28px 0;">
    <p style="margin:0 0 6px;font-size:12px;color:#555;">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#1a7f4b;margin-right:5px;vertical-align:middle;"></span>
      Threshold: <strong>${threshold}%</strong>
    </p>
    <p style="margin:0;font-size:12px;color:#555;">Projects: ${projBadges}</p>
  </td></tr>
  <tr><td style="padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="33%" style="background:#f8f8f8;border-radius:8px;padding:12px 14px;text-align:center;">
          <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Team Members</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">${users.length}</p>
        </td>
        <td width="4%"></td>
        <td width="33%" style="background:#fdecea;border-radius:8px;padding:12px 14px;text-align:center;">
          <p style="margin:0 0 4px;font-size:11px;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">Overallocated</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#c0392b;">${overCount}</p>
        </td>
        <td width="4%"></td>
        <td width="33%" style="background:#e6f4ed;border-radius:8px;padding:12px 14px;text-align:center;">
          <p style="margin:0 0 4px;font-size:11px;color:#1a6b3e;text-transform:uppercase;letter-spacing:0.5px;">Avg. Utilization (Wk)</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#1a6b3e;">${avgWk}%</p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 28px;"><hr style="border:none;border-top:1px solid #eeeeee;"/></td></tr>
  <tr><td style="padding:14px 28px 8px;">
    <p style="margin:0;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.6px;">Team Utilization</p>
  </td></tr>
  <tr><td style="padding:0 28px 20px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th rowspan="2" style="text-align:left;padding:8px 14px;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;border-bottom:1px solid #ddd;vertical-align:bottom;">Team Member</th>
          ${thProjects}
          <th rowspan="2" style="text-align:center;padding:8px 12px;font-size:11px;color:#888;font-weight:700;text-transform:uppercase;border-bottom:1px solid #ddd;border-left:2px solid #d0d0d0;vertical-align:bottom;">Total (Wk)</th>
        </tr>
        <tr>${thPeriods}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </td></tr>
  <tr><td style="padding:0 28px 20px;">
    <span style="font-size:11px;color:#888;margin-right:14px;">
      <span style="display:inline-block;padding:1px 7px;border-radius:3px;background:#e6f4ed;color:#1a6b3e;font-weight:700;font-size:10px;">●</span> Under threshold
    </span>
    <span style="font-size:11px;color:#888;margin-right:14px;">
      <span style="display:inline-block;padding:1px 7px;border-radius:3px;background:#fef6e4;color:#92600a;font-weight:700;font-size:10px;">●</span> 85–100% of threshold
    </span>
    <span style="font-size:11px;color:#888;">
      <span style="display:inline-block;padding:1px 7px;border-radius:3px;background:#fdecea;color:#c0392b;font-weight:700;font-size:10px;">●</span> Overallocated
    </span>
  </td></tr>
  <tr><td style="background:#f8f8f8;padding:14px 28px;border-top:1px solid #eeeeee;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:11px;color:#aaa;">Namaa Consulting · Resource Allocation Dashboard</td>
        <td style="font-size:11px;color:#aaa;text-align:right;">Sent automatically · Daily</td>
      </tr>
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const cfgRes = await fetch(`${JSONBIN_URL}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY }
    });
    if (!cfgRes.ok) throw new Error(`JSONBin config fetch failed: ${cfgRes.status}`);
    const cfgJson = await cfgRes.json();
    const config  = cfgJson?.record || {};

    const leaders   = config.leaders   || [];
    const threshold = config.threshold || 100;

    if (leaders.length === 0) {
      return res.status(200).json({ message: 'No team leaders configured.' });
    }

    const [rawWeek, rawMonth] = await Promise.all([
      fetch(`${BACKEND}?days=7&t=${Date.now()}`).then(r => r.json()),
      fetch(`${BACKEND}?days=30&t=${Date.now()}`).then(r => r.json()),
    ]);

    const aggWeek  = aggregate(rawWeek);
    const aggMonth = aggregate(rawMonth);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    const results = [];
    for (const leader of leaders) {
      if (!leader.email || !leader.projects?.length) continue;

      const html = buildEmail(leader, aggWeek, aggMonth, threshold);

      await transporter.sendMail({
        from: `Namaa Resource Tracker <${GMAIL_USER}>`,
        to:   leader.email,
        subject: `Resource Allocation — Daily Snapshot · ${new Date().toLocaleDateString('en-GB')}`,
        html,
      });

      results.push({ leader: leader.name, email: leader.email, status: 'sent' });
    }

    return res.status(200).json({ sent: results.length, results });

  } catch (err) {
    console.error('[send-email]', err);
    return res.status(500).json({ error: err.message });
  }
}
