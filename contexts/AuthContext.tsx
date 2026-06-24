// =====================================================================
// AuthContext — Supabase session state shared with the whole app.
// =====================================================================
// Exposes the current Session + User, a loading flag for the initial check,
// and the four auth actions every screen needs: sign in, sign up, sign out,
// password reset. The `loading` flag is true ONLY for the very first session
// lookup — after that the listener keeps state fresh without flipping it back
// on, so callers don't see a spinner on every refresh.

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
}

interface AuthActions {
  signIn:  (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp:  (email: string, password: string, opts?: { fullName?: string }) => Promise<{ error: AuthError | null; needsEmailConfirm: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: AuthError | null }>;
}

type AuthCtx = AuthState & AuthActions;

const AuthContext = createContext<AuthCtx | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Bootstrap: read the current session once on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    // 2. Subscribe: keep state in sync on sign-in / sign-out / token refresh.
    //    We deliberately don't flip `loading` back on here — initial-load
    //    callers shouldn't see a spinner just because a token rotated.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthActions['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp: AuthActions['signUp'] = async (email, password, opts) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // user_metadata is user-editable — fine for display name, NEVER for authz.
        data: opts?.fullName ? { full_name: opts.fullName } : undefined,
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined
      }
    });
    // Supabase returns a user but no session when email-confirmation is on —
    // surface that so the UI can show "check your inbox" instead of redirecting.
    const needsEmailConfirm = !!(data?.user && !data?.session);
    return { error, needsEmailConfirm };
  };

  const signOut: AuthActions['signOut'] = async () => {
    // Use LOCAL scope so this browser's session is always cleared even if the
    // server revoke call fails (e.g. an already-expired token) — a global-scope
    // signOut can throw before clearing local, leaving a ghost session. Then
    // remove the persisted key directly: the static landing page reads the same
    // 'lv_supabase_auth' key, so this guarantees it sees a signed-out state and
    // doesn't bounce the user back into the app (the "stuck in a loop" bug).
    try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
    try { localStorage.removeItem('lv_supabase_auth'); } catch {}
  };

  const sendPasswordReset: AuthActions['sendPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined
    });
    return { error };
  };

  // Support mock authentication for local development/screenshots
  const isMockEnabled = typeof window !== 'undefined' && window.localStorage?.getItem('mock_auth') === 'true';
  const mockUser = isMockEnabled ? {
    id: 'mock-user-uuid',
    email: 'mock-user@example.com',
    user_metadata: { full_name: 'Mock Developer' }
  } as any : null;
  const mockSession = isMockEnabled ? {
    access_token: 'mock-token',
    refresh_token: 'mock-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: mockUser
  } as any : null;

  const value: AuthCtx = {
    session: session || mockSession,
    user: session?.user ?? mockUser,
    loading: isMockEnabled ? false : loading,
    configured: isMockEnabled ? true : isSupabaseConfigured,
    signIn: isMockEnabled ? async () => ({ error: null }) : signIn,
    signUp: isMockEnabled ? async () => ({ error: null, needsEmailConfirm: false }) : signUp,
    signOut: isMockEnabled ? async () => {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('mock_auth');
        window.localStorage.removeItem('project_config_v1');
      }
    } : signOut,
    sendPasswordReset: isMockEnabled ? async () => ({ error: null }) : sendPasswordReset
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be used inside <AuthProvider>. Check index.tsx.');
  }
  return ctx;
}
