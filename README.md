# Viraholic

AI co-pilot for getting your first 100 users. Viraholic maps your buyers, finds the
creators and communities they follow across LinkedIn, X, and Reddit, watches their
posts, and drafts on-brand replies you approve before anything posts — plus a launch
strategy, competitor map, distribution plan, and a content engine tuned to your voice.

The product has two parts:

- **Web app** — a React + Vite single-page app (dashboard, recon, content engine).
- **Viraholic Companion** — a Chrome MV3 extension (`viraholic-extension/`) that drafts
  in-context replies on posts you track and waits for your one-tap approval.

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your keys (see [Environment variables](#environment-variables)).
3. Start the dev server:
   ```bash
   npm run dev
   ```
   The app runs at http://localhost:3000.

### Load the Chrome extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `viraholic-extension/` folder.
3. Refresh the dashboard tab so the page ↔ extension bridge reconnects.

> Extension changes are not hot-reloaded — after editing files in `viraholic-extension/`,
> reload the extension from `chrome://extensions`.

## Deploy to Vercel

This repo is Vercel-ready (`vercel.json` sets the Vite framework preset, build command,
output directory, and an SPA fallback rewrite).

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project** and import the repo. The Vite preset is detected
   automatically (build `npm run build`, output `dist`).
3. Add the [environment variables](#environment-variables) under
   **Settings → Environment Variables** (Production + Preview).
4. Deploy. The marketing pages live in `public/` and are served at
   `/landing-growth.html`, `/landing.html`, and `/mentors.html`; everything else falls
   back to the SPA at `/`.

> The Chrome extension is **not** deployed by Vercel — it ships separately (loaded
> unpacked or via the Chrome Web Store).

## Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | build (`vite.config.ts`) + local server | Gemini API key. |
| `VITE_GEMINI_API_KEY` | client | Same Gemini key, exposed to the browser. |
| `VITE_SUPABASE_URL` | client (auth) | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | client (auth) | Supabase anon / publishable key only — never `service_role`. |

`.env`, `.env.local`, and `.env.*.local` are gitignored. Set the same values in Vercel.

## Scripts

- `npm run dev` — start the Vite dev server on port 3000.
- `npm run build` — production build to `dist/`.
- `npm run preview` — preview the production build locally.
