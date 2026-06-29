// Serverless DeepSeek proxy (Vercel). Holds the DeepSeek key server-side as the
// Vercel env var DEEPSEEK_API_KEY, so it never ships to the browser or the
// extension. The web app, the extension's service worker, and api/chat all POST
// OpenAI-style chat bodies here; we forward to DeepSeek and pass the reply back.
//
// Rotating the key = change DEEPSEEK_API_KEY in Vercel and redeploy. Nothing
// else (web app, extension) ever changes.

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// Who may call this from a browser (CORS). The extension's service worker also
// calls it, but viraholic.com is in the extension's host_permissions so that
// request bypasses CORS anyway; the chrome-extension rule is a belt-and-braces.
const ALLOWED = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)?viraholic\.com$/,
  /^chrome-extension:\/\/[a-p]{32}$/,
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED.some((re) => re.test(origin));
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://viraholic.com');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing DEEPSEEK_API_KEY.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid JSON body.' });

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Proxy error.' });
  }
}
