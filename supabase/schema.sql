-- Tracker cloud sync: one row per user holding the whole app state as JSON.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.tracker_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: each signed-in user can only see and change their own row.
alter table public.tracker_state enable row level security;

drop policy if exists "read own state" on public.tracker_state;
drop policy if exists "insert own state" on public.tracker_state;
drop policy if exists "update own state" on public.tracker_state;

create policy "read own state" on public.tracker_state
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "insert own state" on public.tracker_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "update own state" on public.tracker_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
