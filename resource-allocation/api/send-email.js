/* ═══════════════════════════════════════════════════
   /api/send-email.js  —  Namaa Consulting
   Uses Zoho SMTP via nodemailer
═══════════════════════════════════════════════════ */

import nodemailer from 'nodemailer';

const BACKEND     = 'https://resource-allocation-nine.vercel.app/api/youtrack';
const JSONBIN_ID  = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const ZOHO_USER   = process.env.ZOHO_USER;
const ZOHO_PASS   = process.env.ZOHO_PASS;
const IGNORED     = ['system_user@x04x', 'Deleted User'];

/* ─────────────────────────────────────────────────
   DATE RANGE HELPERS  (same logic as frontend)
───────────────────────────────────────────────── */

function toYMD(date) {
  return date.toISOString().split('T')[0];
}

/** Current week: Sunday → Saturday */
function currentWeekRange() {
  const now  = new Date();
  const day  = now.getDay(); // 0=Sun … 6=Sat
  const sun  = new Date(now);
  sun.setDate(now.getDate() - day);
  const sat  = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  return { startDate: toYMD(sun), endDate: toYMD(sat) };
}

/** Current month: 1st → last day */
function currentMonthRange() {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: toYMD(first), endDate: toYMD(last) };
}

/** Current quarter */
function currentQuarterRange() {
  const now = new Date();
  const m   = now.getMonth(); // 0-based
  const q   = Math.floor(m / 3);
  const first = new Date(now.getFullYear(), q * 3, 1);
  const last  = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { startDate: toYMD(first), endDate: toYMD(last) };
}

/* ─────────────────────────────────────────────────
   WORKING MINUTES CALCULATION
   Base = 40h/week = 2400 min/week
   We count working weeks (Mon–Fri) in the range,
   but always use 40 h as the weekly denominator.
───────────────────────────────────────────────── */
function workingMinutesInRange(startDateStr, endDateStr) {
  const start = new Date(startDateStr + 'T00:00:00');
  const end   = new Date(endDateStr   + 'T00:00:00');

  // Count weeks spanned (partial week counts as 1 full week for the denominator)
  const msPerDay  = 86400000;
  const totalDays = Math.round((end - start) / msPerDay) + 1; // inclusive
  const weeks     = Math.ceil(totalDays / 7);
  return weeks * 40 * 60; // 40 h × 60 min per week
}

/* ─────────────────────────────────────────────────
   AGGREGATE
───────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────
   FORMAT HOURS  e.g. 90 min → "1h 30m"
───────────────────────────────────────────────── */
function fmtMins(mins) {
  if (!mins) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ─────────────────────────────────────────────────
   PILL COLOR
───────────────────────────────────────────────── */
function pillColor(pct, threshold) {
  if (pct > threshold)                        return { bg: '#fdecea', color: '#c0392b' };
  if (pct >= Math.round(threshold * 0.85))    return { bg: '#fef6e4', color: '#92600a' };
  return                                             { bg: '#e6f4ed', color: '#1a6b3e' };
}

/* ─────────────────────────────────────────────────
   BUILD EMAIL HTML
───────────────────────────────────────────────── */
function buildEmail(leader, aggWeek, aggMonth, wkRange, moRange, threshold) {
  const projects = leader.projects;

  // Collect users visible in either period
  const usersSet = new Set();
  for (const agg of [aggWeek, aggMonth]) {
    for (const [user, projMap] of Object.entries(agg)) {
      for (const p of projects) {
        if (projMap[p]) usersSet.add(user);
      }
    }
  }
  const users = [...usersSet].sort();

  const availWk = workingMinutesInRange(wkRange.startDate, wkRange.endDate);
  const availMo = workingMinutesInRange(moRange.startDate, moRange.endDate);

  const stats = users.map(u => {
    const perProj = {};
    let totalWkMins = 0, totalMoMins = 0;
    for (const p of projects) {
      const wkMins = aggWeek[u]?.[p]  || 0;
      const moMins = aggMonth[u]?.[p] || 0;
      perProj[p] = {
        wkPct:  wkMins > 0 ? Math.round((wkMins / availWk) * 100) : null,
        moPct:  moMins > 0 ? Math.round((moMins / availMo) * 100) : null,
        wkMins,
        moMins,
      };
      totalWkMins += wkMins;
      totalMoMins += moMins;
    }
    return {
      name: u,
      perProj,
      totalWkPct:  Math.round((totalWkMins / availWk) * 100),
      totalMoPct:  Math.round((totalMoMins / availMo) * 100),
      totalWkMins,
      totalMoMins,
    };
  });

  const overCount = stats.filter(s => s.totalWkPct > threshold).length;
  const avgWk = stats.length
    ? Math.round(stats.reduce((a, s) => a + s.totalWkPct, 0) / stats.length)
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
    const wkC = pillColor(s.totalWkPct, threshold);
    const cells = projects.map(p => {
      const { wkPct, moPct, wkMins, moMins } = s.perProj[p];
      const wkColor = wkPct != null ? pillColor(wkPct, threshold) : null;
      const moColor = moPct != null ? pillColor(moPct, threshold) : null;

      const wkCell = wkPct != null
        ? `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;background:${wkColor.bg};color:${wkColor.color};">${wkPct}%<br/><span style="font-size:9px;font-weight:400;opacity:0.8;">(${fmtMins(wkMins)})</span></span>`
        : `<span style="color:#ccc;">—</span>`;

      const moCell = moPct != null
        ? `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;background:${moColor.bg};color:${moColor.color};">${moPct}%<br/><span style="font-size:9px;font-weight:400;opacity:0.8;">(${fmtMins(moMins)})</span></span>`
        : `<span style="color:#ccc;">—</span>`;

      return `<td style="padding:8px;text-align:center;border-bottom:1px solid #f0f0f0;border-left:1px solid #e0e0e0;">${wkCell}</td>
              <td style="padding:8px;text-align:center;border-bottom:1px solid #f0f0f0;">${moCell}</td>`;
    }).join('');

    return `<tr>
      <td style="padding:9px 14px;font-weight:600;font-size:13px;color:#1a1a1a;border-bottom:1px solid #f0f0f0;white-space:nowrap;">${s.name}</td>
      ${cells}
      <td style="padding:9px 12px;text-align:center;border-bottom:1px solid #f0f0f0;border-left:2px solid #d0d0d0;">
        <span style="display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;background:${wkC.bg};color:${wkC.color};">${s.totalWkPct}%<br/><span style="font-size:9px;font-weight:400;opacity:0.8;">(${fmtMins(s.totalWkMins)})</span></span>
      </td>
    </tr>`;
  }).join('');

  // Period labels for email header
  const wkLabel = `${wkRange.startDate} → ${wkRange.endDate}`;
  const moLabel = `${moRange.startDate} → ${moRange.endDate}`;

  const today = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
<tr><td align="center">
<table width="660" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;">
  <tr><td style="background:#1a7f4b;padding:24px 28px;">
    <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Resource Allocation — Daily Snapshot</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">${today}</p>
  </td></tr>
  <tr><td style="padding:18px 28px 0;">
    <p style="margin:0 0 4px;font-size:12px;color:#555;">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#1a7f4b;margin-right:5px;vertical-align:middle;"></span>
      Threshold: <strong>${threshold}%</strong> &nbsp;|&nbsp;
      <strong>Week:</strong> ${wkLabel} &nbsp;|&nbsp;
      <strong>Month:</strong> ${moLabel}
    </p>
    <p style="margin:6px 0 0;font-size:12px;color:#555;">Projects: ${projBadges}</p>
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
          <p style="margin:0 0 4px;font-size:11px;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">Overallocated (Wk)</p>
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
    <p style="margin:4px 0 0;font-size:10px;color:#aaa;">
      Week base = <strong>40h</strong> &nbsp;|&nbsp; Month base = <strong>173h</strong>
    </p>
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

/* ─────────────────────────────────────────────────
   HANDLER
───────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Load config
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

    // Compute date ranges
    const wkRange = currentWeekRange();
    const moRange = currentMonthRange();

    const qs = (r) => `startDate=${r.startDate}&endDate=${r.endDate}`;

    const [rawWeek, rawMonth] = await Promise.all([
      fetch(`${BACKEND}?${qs(wkRange)}&t=${Date.now()}`).then(r => r.json()),
      fetch(`${BACKEND}?${qs(moRange)}&t=${Date.now()}`).then(r => r.json()),
    ]);

    const aggWeek  = aggregate(rawWeek);
    const aggMonth = aggregate(rawMonth);

    // ── Zoho SMTP transporter ──
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: ZOHO_USER,
        pass: ZOHO_PASS,
      },
    });

    const results = [];
    for (const leader of leaders) {
      if (!leader.email || !leader.projects?.length) continue;

      const html = buildEmail(leader, aggWeek, aggMonth, wkRange, moRange, threshold);

      await transporter.sendMail({
        from: `Namaa Resource Tracker <${ZOHO_USER}>`,
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
