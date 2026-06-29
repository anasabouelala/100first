// =====================================================================
// Supabase client — singleton, used everywhere in the app.
// =====================================================================
// Reads URL + anon key from .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Never put service_role here — any VITE_-prefixed variable is shipped to
// the browser bundle. Anon/publishable keys are designed to be public and
// are protected by row-level security on the DB side.
//
// If the env vars are missing we still export a stub client that throws on
// every call instead of silently failing at runtime — that makes the misconfig
// loud rather than producing confusing "user not signed in" loops.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The URL + anon key are public by design (the anon key ships to the browser and
// is protected by row-level security). Baked in as fallbacks so the deployed app
// works even if the Vercel env vars aren't set; override with VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY to point at a different project.
const FALLBACK_URL  = 'https://brrpnoynvidfopdujsce.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJycnBub3ludmlkZm9wZHVqc2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzODUsImV4cCI6MjA5NjUwMjM4NX0.89mTbOh0EKV06mMYvhQt4YKL5olbi0G2odymfoSI9E4';

export const SUPABASE_URL      = (((import.meta as any).env?.VITE_SUPABASE_URL)      as string) || FALLBACK_URL;
export const SUPABASE_ANON_KEY = (((import.meta as any).env?.VITE_SUPABASE_ANON_KEY) as string) || FALLBACK_ANON;

const url = SUPABASE_URL;
const anonKey = SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(url && anonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Auth and any DB call will fail until these are set in .env and the dev server is restarted.'
  );
}

// Single client instance for the whole app. The session is persisted in
// localStorage by default so a refresh keeps the user signed in.
export const supabase: SupabaseClient = createClient(
  url    || 'https://example.supabase.co',
  anonKey || 'public-anon-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,        // handles the #access_token redirect after email-confirm links
      storageKey: 'lv_supabase_auth'   // namespaced so we don't collide with other apps on localhost
    }
  }
);
