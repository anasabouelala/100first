// Serverless proxy (Vercel) for the mentor chat → DeepSeek. The DeepSeek key
// lives server-side as the Vercel env var DEEPSEEK_API_KEY and never reaches the
// browser. The mentor pages POST { system, contents } (the old Gemini shape);
// we translate to OpenAI messages and return { text }, so the static pages
// don't change.
//
// NOTE: these mentor pages are public, so this endpoint spends YOUR DeepSeek
// quota for every visitor. The same-origin guard below blocks casual cross-site
// abuse; add real rate limiting (Vercel KV / Upstash) before heavy promotion.

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Light same-origin guard — only serve requests coming from our own pages.
  const host = req.headers.host || '';
  const origin = req.headers.origin || '';
  if (origin && host && !origin.endsWith(host)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing DEEPSEEK_API_KEY.' });

  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  const { system, contents } = payload || {};
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: 'Missing contents.' });
  }

  // Translate Gemini { role, parts:[{text}] } → OpenAI { role, content }.
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  for (const turn of contents) {
    const text = Array.isArray(turn?.parts) ? turn.parts.map((p) => p?.text || '').join('') : '';
    if (!text) continue;
    messages.push({ role: turn.role === 'model' ? 'assistant' : 'user', content: text });
  }
  if (messages.length === 0) return res.status(400).json({ error: 'Empty conversation.' });

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.9, top_p: 0.95, max_tokens: 900 }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const msg = data?.error?.message || data?.error || `Upstream ${upstream.status}`;
      return res.status(upstream.status).json({ error: msg });
    }
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return res.status(502).json({ error: 'Empty response.' });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Proxy error.' });
  }
}
