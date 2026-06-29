// Serverless proxy (Vercel) for the mentor chat. Routes to DeepSeek THROUGH the
// Supabase Edge Function, so the AI key lives ONLY as a Supabase secret
// (DEEPSEEK_API_KEY) — nothing AI-related needs to be set in Vercel anymore.
//
// The mentor pages keep POSTing the same { system, contents } shape they used
// for Gemini; we translate it to OpenAI-style messages here and translate the
// reply back to { text }, so the static pages don't change.
//
// NOTE: these mentor pages are public, so this endpoint spends YOUR DeepSeek
// quota for every visitor. The same-origin guard below blocks casual cross-site
// abuse; add real rate limiting (Vercel KV / Upstash) before heavy promotion.

// URL + anon key are public by design (anon key is RLS-protected and already
// ships in the client). Override via Vercel env vars if you point at another project.
const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || 'https://brrpnoynvidfopdujsce.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJycnBub3ludmlkZm9wZHVqc2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzODUsImV4cCI6MjA5NjUwMjM4NX0.89mTbOh0EKV06mMYvhQt4YKL5olbi0G2odymfoSI9E4';
const DEEPSEEK_PROXY_URL = `${SUPABASE_URL}/functions/v1/deepseek`;
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
    const upstream = await fetch(DEEPSEEK_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.9,
        top_p: 0.95,
        max_tokens: 900,
      }),
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
