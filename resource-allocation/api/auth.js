/* ═══════════════════════════════════════════════════
   /api/auth.js  —  Namaa Consulting
   Simple login endpoint — credentials stored in env vars
═══════════════════════════════════════════════════ */

const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const SECRET        = process.env.AUTH_SECRET || 'namaa-secret-2024';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Simple token: base64 of "username:secret:timestamp"
  const token = Buffer.from(`${username}:${SECRET}:${Date.now()}`).toString('base64');

  return res.status(200).json({ token });
}
