// server.js — Viraholic PH Scout backend
import express from 'express';
import cors from 'cors';
import Steel from 'steel-sdk';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load .env manually (avoids dotenv dependency)
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  readFileSync(resolve(__dir, '.env'), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
} catch {}

const app  = express();
const PORT = 3002;

const STEEL_KEY  = process.env.STEEL_API_KEY  || '***REMOVED***';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '***REMOVED***';

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'] }));
app.use(express.json());

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(`[PH Scout] ${new Date().toISOString().slice(11,19)} ${msg}`); }

// ─── Phase 1 — Discover discussion links ────────────────────────────────────

async function discoverLinks(page) {
  log('Navigating to PH discussions…');
  await page.goto('https://www.producthunt.com/discussions', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for JS to render discussion cards (PH is a SPA)
  await sleep(3000);

  // Scroll to load more
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await sleep(1200);
  }

  const links = await page.evaluate(() => {
    const seen = new Set();
    const result = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (!href) return;
      try {
        const url = new URL(href);
        if (url.hostname !== 'www.producthunt.com') return;
        const p = url.pathname;
        if (
          p.startsWith('/discussions/') &&
          p.length > '/discussions/'.length &&
          !p.startsWith('/discussions/topics') &&
          !p.startsWith('/discussions/search')
        ) {
          const clean = url.origin + p;
          if (!seen.has(clean)) { seen.add(clean); result.push(clean); }
        }
      } catch {}
    });
    return result;
  });

  log(`Discovered ${links.length} discussion links`);
  return links;
}

// ─── Phase 2 — Deep crawl each discussion ────────────────────────────────────

async function crawlDiscussion(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);

    const content = await page.evaluate((pageUrl) => {
      const title = document.title;
      let text = `PAGE: ${title}\nURL: ${pageUrl}\n\n`;

      // Try focused selectors first, fall back to body
      const selectors = [
        '[data-test="discussion-body"]',
        '[data-test^="discussion"]',
        '[data-test="comments"]',
        'article',
        'main',
        '[role="main"]',
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          text += [...els].map(e => e.innerText).join('\n\n');
          break;
        }
      }

      if (text.length < 300) {
        const body = document.body.cloneNode(true);
        body.querySelectorAll('nav,header,footer,script,style').forEach(el => el.remove());
        text += body.innerText;
      }

      return text.slice(0, 8000);
    }, url);

    return { url, text: content };
  } catch (err) {
    log(`  ✗ Failed to crawl ${url}: ${err.message}`);
    return { url, text: '' };
  }
}

// ─── Phase 3 — Gemini analysis ───────────────────────────────────────────────

async function analyseWithGemini(discussions, context) {
  const { productName, productDesc, keywords = [], personas = [], competitors = [] } = context;

  const kwList = keywords.length ? keywords.join(', ') : '(none)';

  const personaBlock = personas.length
    ? personas.map((p, i) =>
        `Persona ${i+1}: "${p.name}" (${p.role})\n` +
        `  Demographics: ${p.demographics}\n` +
        `  Pain Points: ${(p.painPoints||[]).join(' | ')}\n` +
        `  Goals: ${(p.goals||[]).join(' | ')}\n` +
        `  Where they hang out: ${(p.whereTheyHangOut||[]).join(', ')}`
      ).join('\n\n')
    : '(no persona data — generate them in the Buyer Personas section first)';

  const competitorBlock = competitors.length
    ? competitors.map(c => `- ${c.name} (${c.url || ''}) — threat: ${c.threatLevel || 'unknown'}`).join('\n')
    : '(no competitor data)';

  const prompt = `
You are a community intelligence analyst helping a founder find Product Hunt discussions to engage with authentically — to build relationships with their ICP, not to promote directly.

FOUNDER'S PRODUCT:
Name: ${productName || 'my product'}
Description: ${productDesc || '(not provided)'}
Custom Keywords: ${kwList}

BUYER PERSONAS:
${personaBlock}

KNOWN COMPETITORS:
${competitorBlock}

DISCUSSIONS TO ANALYSE (${discussions.length} total):
${discussions.map((d, i) => `
--- DISCUSSION ${i + 1} ---
URL: ${d.url}
CONTENT:
${(d.text || '(empty)').slice(0, 3000)}
`).join('\n')}

For EACH discussion return a JSON object:
1. url (string)
2. title (string)
3. relevance (integer 0–100) — opportunity to connect with ICP
4. why (string) — 1–2 sentences
5. tags (array) — from: pain-point, use-case, feature-request, competitor-mention, target-audience, off-topic
6. icp (object):
   { "profile": "...", "matchedPersona": "name or None", "signals": ["..."], "match": "high|medium|low" }
7. interestedPeople (array, max 3):
   [ { "username": "...", "reason": "...", "signal": "exact quote" } ]
8. brandMentions (array):
   [ { "name": "...", "type": "competitor|tool|reference", "isOurCompetitor": bool, "context": "..." } ]
9. keywordHits (array of matched keywords)
10. reply (string) — if relevance >= 40: genuine non-salesy reply, max 130 words. Otherwise "".

Respond ONLY with a valid JSON array. No markdown fences.
`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Gemini error: ${err.error?.message || res.status}`);
  }

  const json = await res.json();
  const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = raw.replace(/```json\n?/gi, '').replace(/```/gi, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    log('JSON parse failed, raw snippet: ' + raw.slice(0, 200));
    throw new Error('Failed to parse Gemini response as JSON');
  }
}

// ─── Main route ──────────────────────────────────────────────────────────────

app.post('/api/ph-scout', async (req, res) => {
  const context  = req.body || {};
  const maxLinks = parseInt(req.query.max) || 10;

  const client  = new Steel({ steelAPIKey: STEEL_KEY });
  let session   = null;
  let browser   = null;

  try {
    // 1. Create Steel session
    log('Creating Steel session…');
    session = await client.sessions.create({
      solveCaptcha: true,
      timeout:      300000, // 5 min max
    });
    log(`Session ${session.id} — live view: ${session.sessionViewerUrl}`);

    // 2. Connect Playwright via CDP
    browser = await chromium.connectOverCDP(
      `wss://connect.steel.dev?apiKey=${STEEL_KEY}&sessionId=${session.id}`
    );
    const ctx  = browser.contexts()[0] || await browser.newContext();
    const page = ctx.pages()[0]        || await ctx.newPage();

    // 3. Discover links or use provided ones
    let links = [];
    if (context.urls && Array.isArray(context.urls) && context.urls.length > 0) {
      log(`Using ${context.urls.length} provided URLs…`);
      links = context.urls.slice(0, maxLinks);
    } else {
      const allLinks = await discoverLinks(page);
      links = allLinks.slice(0, maxLinks);
    }

    if (!links.length) {
      if (session) await client.sessions.release(session.id);
      return res.json({ ok: false, error: 'No discussion links found.' });
    }

    // Send partial progress header so the client knows how many we're scanning
    log(`Crawling ${links.length} discussions…`);

    // 4. Deep crawl each link
    const discussions = [];
    for (let i = 0; i < links.length; i++) {
      log(`  [${i+1}/${links.length}] ${links[i]}`);
      const data = await crawlDiscussion(page, links[i]);
      discussions.push(data);
      await sleep(500);
    }

    // 5. Close browser (session stays alive until released)
    await browser.close();
    browser = null;

    // 6. Gemini analysis
    log('Running Gemini analysis…');
    const analysed = await analyseWithGemini(discussions, context);

    // 7. Release session
    await client.sessions.release(session.id);
    session = null;
    log(`Done — ${analysed.length} discussions analysed`);

    // 8. Sort by relevance and add metadata
    const results = analysed
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .map(item => ({
        ...item,
        status:    'new',
        scannedAt: new Date().toISOString(),
      }));

    res.json({ ok: true, results });

  } catch (err) {
    log(`ERROR: ${err.message}`);
    try {
      if (browser) await browser.close();
      if (session) await client.sessions.release(session.id);
    } catch {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🚀 PH Scout server running at http://localhost:${PORT}`);
  console.log(`   POST /api/ph-scout  — trigger a scan`);
  console.log(`   GET  /api/health    — health check\n`);
});
