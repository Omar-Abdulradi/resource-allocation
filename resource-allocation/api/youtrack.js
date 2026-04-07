export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.YOUTRACK_TOKEN;
  const baseUrl = 'https://namaaconsulting.youtrack.cloud';

  // Support both legacy ?days=N and new ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  let startStr, endStr;

  if (req.query.startDate && req.query.endDate) {
    startStr = req.query.startDate;
    endStr   = req.query.endDate;
  } else {
    // Legacy fallback: days from today backwards
    const days = parseInt(req.query.days) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startStr = startDate.toISOString().split('T')[0];
    endStr   = new Date().toISOString().split('T')[0];
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/workItems?fields=author(login,fullName),issue(project(name,shortName)),duration(minutes),date&$top=2000&startDate=${startStr}&endDate=${endStr}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
