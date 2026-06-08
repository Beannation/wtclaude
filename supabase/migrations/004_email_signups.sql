-- 004_email_signups.sql
-- Generic, reusable first-party email-capture store for the marketing site.
-- ONE table for ALL lists (Guardian waitlist, SMB tease, Complete-user notify,
-- and any future list) — keyed by (email, list). Written ONLY by the
-- `email-signup` edge function via service_role; never a direct client write.
--
-- Same Phase-C posture as 002: deny-all for anon/authenticated. The publishable
-- key cannot read or write this table directly; all access is server-side.
--
-- Deploy ordering: run AFTER 002 (which set default privileges to revoke for the
-- publishable-key roles). The explicit revoke below is a no-op safety net so this
-- migration is correct even if applied to a fresh project before 002.

-- citext = case-insensitive text, so unique(email, list) de-dupes regardless of
-- how the visitor cased their address. (The edge fn also lower-cases on write.)
create extension if not exists citext;

create table if not exists email_signups (
  id          uuid        primary key default gen_random_uuid(),
  email       citext      not null,
  list        text        not null default 'general',  -- guardian_waitlist | smb_tease | complete_user_notify | <future>
  source      text,                                     -- page/CTA path the signup came from (e.g. '/developers')
  consent     boolean     not null default false,       -- explicit consent flag (future double-opt-in)
  meta        jsonb       not null default '{}'::jsonb,  -- room for future fields (utm, referrer, locale, …)
  created_at  timestamptz not null default now(),
  unique (email, list)                                  -- re-submits de-dupe (upsert, not error)
);

create index if not exists idx_email_signups_list    on email_signups (list, created_at desc);
create index if not exists idx_email_signups_created on email_signups (created_at desc);

-- Phase-C deny-all (mirror of 002): RLS on, no direct grants to the
-- publishable-key roles. service_role (the edge function) bypasses RLS.
alter table email_signups enable row level security;
revoke all on table email_signups from anon, authenticated;
