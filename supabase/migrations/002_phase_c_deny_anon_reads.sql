-- 002_phase_c_deny_anon_reads.sql
-- SEC Phase C — lock direct table access to server-side (edge function) only.
--
-- Context: the browser and CLI authenticate with the PUBLISHABLE key, which maps
-- to the Postgres `anon` role. The app does NOT use Supabase Auth (there is no
-- per-user JWT) — identity is an `anonymous_id` carried in a request header and
-- resolved server-side. The original 001 policies key on `auth.uid()` /
-- `auth.role() = 'authenticated'`, which are NULL/false for the `anon` role, so
-- direct anon reads already return zero rows. This migration makes that explicit
-- and defense-in-depth at the GRANT layer: anon/authenticated get NO direct table
-- access; every read and write goes through an edge function running as
-- service_role (the service secret lives ONLY as a Supabase function secret).
--
-- Safe to deploy independently: nothing that currently functions reads these
-- tables directly under the publishable key (it only worked under the leaked
-- service_role key, now revoked). The web dashboard's remaining direct .from()
-- reads (Overview/Sessions/Badges/WhatIf, fetchSessionTurns) are already
-- non-functional under the publishable key and MUST be migrated to edge
-- functions to display real data — tracked separately (see SEC Phase C notes).

-- Keep RLS enabled (belt) ...
alter table users enable row level security;
alter table sessions enable row level security;
alter table turns enable row level security;
alter table daily_summaries enable row level security;
alter table badges enable row level security;
alter table leaderboard_entries enable row level security;

-- ... and remove the misleading auth.uid()-based policies that never matched the
-- anon role anyway (they imply a JWT flow the product does not use).
drop policy if exists "Users can read own data" on users;
drop policy if exists "Users can read own sessions" on sessions;
drop policy if exists "Users can read own turns" on turns;
drop policy if exists "Users can read own daily summaries" on daily_summaries;
drop policy if exists "Users can read own badges" on badges;
drop policy if exists "Leaderboard visible to authenticated users" on leaderboard_entries;

-- Deny-all at the GRANT layer (suspenders): the publishable-key roles get no
-- direct access to any data table. PostgREST will return permission-denied for
-- direct REST reads/writes with the publishable key.
revoke all on table users               from anon, authenticated;
revoke all on table sessions            from anon, authenticated;
revoke all on table turns               from anon, authenticated;
revoke all on table daily_summaries     from anon, authenticated;
revoke all on table badges              from anon, authenticated;
revoke all on table leaderboard_entries from anon, authenticated;

-- Block access to any future tables added without explicit grants, too.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- service_role retains full access (edge functions); no grant change needed —
-- service_role bypasses RLS and keeps its default privileges.
