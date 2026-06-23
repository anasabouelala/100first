# Chrome Web Store — submission guide for Viraholic Companion

Status of known review blockers. ✅ = handled in code/manifest, ⬜ = you must do it.

## Before you submit

- ✅ Manifest V3, no remote code, no `eval`. (Hard technical blockers — clean.)
- ✅ No hardcoded API keys in the extension (the AI key is provided at runtime).
- ✅ Description ≤ 132 chars (store limit).
- ✅ Removed unused `syndication.twitter.com` host permission.
- ✅ **Icon is now a real PNG.** Replaced the JPEG with `icon16.png` / `icon48.png` /
  `icon128.png` (RGBA, transparent rounded corners), wired into `icons` and
  `action.default_icon`. Use `icon128.png` for the store-listing icon too. (Swap in your
  own artwork anytime — re-run `scratch/make_icon.cjs` or drop in replacements.)
- ⬜ **Replace `localhost` with your production dashboard origin.** In `manifest.json`
  remove the `http://localhost:3000-3002` / `127.0.0.1` entries from `host_permissions`
  **and** `content_scripts`, and in `background.js` update the localhost matches
  (lines ~393, ~404, ~417) to your deployed origin (e.g. `https://app.viraholic.com/*`).
  Localhost in a published extension is a review flag and does nothing for real users.
- ✅ **Privacy policy + Terms are hosted.** Published at `/privacy.html` and `/terms.html`
  (deployed with the web app). Put `https://<your-app>/privacy.html` in the listing's
  "Privacy policy" field.
- ✅ **Upload package is built.** `viraholic-extension.zip` (manifest at the zip root, docs
  excluded) sits in the project root — that's the file you upload. See Packaging below.
- ⬜ Add 1280×800 (or 640×400) screenshots and a short promo blurb per store requirements.
- ⬜ Pay the one-time $5 Chrome Web Store developer registration (if you haven't).

## Permission justifications (paste into the review form)

- **storage** — saves your tracked accounts, drafts, and settings locally.
- **alarms** — periodic check for new posts on accounts you track.
- **tabs** — find/open/refresh your Viraholic dashboard tab and the X/LinkedIn tab the
  user is acting on. (Used: `tabs.query/create/update/reload`.)
- **scripting** — inject the page↔extension bridge into your own dashboard and the
  reply helper into the composer.
- **host: x.com / twitter.com / linkedin.com** — read the feed you are signed in to and
  place drafted replies into the native composer for your approval.
- **host: <your dashboard origin>** — sync drafts/settings with the Viraholic web app.

## Single-purpose statement

> Viraholic Companion drafts AI replies for the signed-in user's own X and LinkedIn
> feed and posts only replies the user reviews and approves.

## Data-use disclosures (Privacy practices tab)

- Collects: "Website content" (posts the user acts on) and "User activity" (drafts).
- Used only for the single purpose above; **not sold**; **not used for ads**; not used
  for creditworthiness. Check the three required certification boxes.
- Remote data: post text is sent to the AI provider (Gemini/DeepSeek) to generate drafts.

## Packaging the upload

Ready-to-upload zip: **`viraholic-extension.zip`** in the project root. Regenerate after
any change (PowerShell):

```powershell
$f = Get-ChildItem viraholic-extension -File | ? { $_.Extension -ne '.md' }
Compress-Archive -Path $f.FullName -DestinationPath viraholic-extension.zip -Force
```

Then in the Chrome Web Store dashboard → **Add new item** → upload the zip.

---

## ⚠️ Known review risk — functionality kept intact (by request)

**On record:** the agent's behavior is intentionally left unchanged. Everything above
maximizes acceptance odds *around* the existing functionality without altering it. The
item below is the main risk a reviewer may still raise — keep it in mind.

The X posting path currently works by:
1. `x_net_hook.js` running in X's MAIN world, wrapping `window.fetch`/XHR to capture your
   live **Bearer token + CSRF**, then
2. `discovery_engine.js` **replaying X's private `CreateTweet` GraphQL endpoint** with
   those credentials (`discovery_engine.js:~5389`).

To a reviewer this reads as **session-token interception + automating X via a
reverse-engineered private API**, which conflicts with X's ToS and is the highest
rejection/takedown risk — independent of user consent.

**Store-safe alternative (matches "the user posts"):** drop the token capture and the
GraphQL replay; instead insert the approved draft into X's **native composer** and let
the user click Post. Trade-off: the team originally chose the replay because driving
X's Draft.js editor via the DOM didn't reliably enable the Post button — so this needs
real-browser iteration (the clipboard/`insertFromPaste` path is usually the one that
works). LinkedIn's composer is generally drivable via the DOM already.

Ask Claude to implement this "draft-only" X path when you're ready.
