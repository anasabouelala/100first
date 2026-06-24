// Serverless proxy (Vercel) so the mentor chat uses the BACKEND Gemini key
// instead of asking each visitor for one. The key stays server-side and is
// never shipped to the browser. Set GEMINI_API_KEY in Vercel → Env Variables.
//
// NOTE: these mentor pages are public, so this endpoint spends YOUR Gemini
// quota for every visitor. The same-origin guard below blocks casual cross-site
// abuse; add real rate limiting (Vercel KV / Upstash) before heavy promotion.

const MODEL = 'gemini-2.5-flash';

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

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' });

  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  const { system, contents } = payload || {};
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: 'Missing contents.' });
  }

  try {
    const body = {
      system_instruction: system ? { parts: [{ text: String(system) }] } : undefined,
      contents,
      generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 900 }
    };
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error?.message || `Upstream ${upstream.status}` });
    }
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text).join('') || '';
    if (!text) {
      const blocked = data?.promptFeedback?.blockReason;
      return res.status(502).json({ error: blocked ? `Response blocked (${blocked}).` : 'Empty response.' });
    }
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Proxy error.' });
  }
}
