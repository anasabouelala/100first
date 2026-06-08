-- =====================================================================
-- Initial schema — profiles table mirroring auth.users
-- =====================================================================
-- Why this exists:
--   auth.users is owned by Supabase Auth and we shouldn't write to it
--   directly from the app. The conventional pattern is a public.profiles
--   table joined 1:1 to auth.users, that we DO own and write to (display
--   name, avatar, anything app-specific that isn't an authentication fact).
--
-- Security model (Supabase-specific traps avoided):
--   - RLS is ENABLED. Every policy is scoped TO authenticated and uses
--     (select auth.uid()) = id so a signed-in user can only see / change
--     their own row. (TO authenticated without an ownership predicate
--     would be BOLA / IDOR.)
--   - UPDATE policy declares BOTH `using` AND `with check` so a user
--     cannot rewrite their row's `id` to belong to someone else.
--   - The "create profile on signup" trigger function is SECURITY DEFINER
--     because it has to insert into a table the new user does not yet
--     have permission for. It's pinned to the auth.users insert hook and
--     does nothing else — that's the legitimate SECURITY DEFINER pattern.
--   - `auth.role()` is deprecated; we use the TO clause instead.

-- ─── table ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    email       text,
    full_name   text,
    avatar_url  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users user. Stores app-level profile data we own.';

-- Keep updated_at fresh on every UPDATE.
create or replace function public.tg_profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
    before update on public.profiles
    for each row execute function public.tg_profiles_touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;

-- Read own row.
create policy "profiles: read own"
on public.profiles
for select
to authenticated
using ( (select auth.uid()) = id );

-- Update own row. Both USING and WITH CHECK so the user cannot reassign
-- the row's id to another user mid-update.
create policy "profiles: update own"
on public.profiles
for update
to authenticated
using      ( (select auth.uid()) = id )
with check ( (select auth.uid()) = id );

-- We DO NOT grant a plain INSERT to authenticated — the row is created
-- by the auth.users trigger below using SECURITY DEFINER. That keeps
-- signup atomic and prevents users from inserting a row for a different
-- account.

-- ─── auto-create profile on signup ────────────────────────────────────
create or replace function public.tg_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        nullif(new.raw_user_meta_data->>'full_name', '')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Only the postgres role should be able to call this function directly.
-- Without this, anon/authenticated could call the SECURITY DEFINER fn
-- (PUBLIC inherits EXECUTE by default in Postgres).
revoke all on function public.tg_create_profile_for_new_user() from public;
revoke all on function public.tg_create_profile_for_new_user() from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.tg_create_profile_for_new_user();
