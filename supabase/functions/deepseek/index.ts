// Supabase Edge Function — DeepSeek proxy.
// Keeps the DeepSeek API key SERVER-SIDE (Supabase secret), so it never ships
// to the browser bundle. The web app POSTs the OpenAI-style chat body here and
// this function forwards it to DeepSeek with the secret key attached.
//
// Deploy:   supabase functions deploy deepseek --no-verify-jwt
// Secret:   supabase secrets set DEEPSEEK_API_KEY=sk-xxxxxxxx
//
// (--no-verify-jwt is used so the app's admin/mock session can also call it;
//  the Origin allow-list below blocks casual cross-site abuse. Add rate
//  limiting before heavy promotion.)

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)?viraholic\.com$/,
];

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? (origin as string) : 'https://viraholic.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const key = Deno.env.get('DEEPSEEK_API_KEY');
  if (!key) {
    return new Response(JSON.stringify({ error: 'DEEPSEEK_API_KEY secret is not set on this function.' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'Proxy error.' }), {
      status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
