-- WTClaude initial schema
-- Run this in your Supabase SQL editor to set up all tables

-- Users (anonymous by default, no PII required)
create table users (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text unique not null,
  created_at timestamptz default now(),
  sharing_enabled boolean default false,
  preferences jsonb default '{}'
);

-- Sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  session_id text not null,
  project_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  total_input_tokens bigint default 0,
  total_output_tokens bigint default 0,
  total_cache_read bigint default 0,
  total_cache_write bigint default 0,
  models_used jsonb default '{}',
  turn_count int default 0,
  estimated_cost_usd numeric(10,4) default 0
);

create index idx_sessions_user on sessions(user_id);
create index idx_sessions_started on sessions(started_at);
create unique index idx_sessions_user_session on sessions(user_id, session_id);

-- Turns (per-turn granularity — foundation for Guardian)
create table turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  turn_number int not null,
  timestamp timestamptz not null,
  model text,
  input_tokens int default 0,
  output_tokens int default 0,
  cache_read_tokens int default 0,
  cache_write_tokens int default 0,
  cumulative_input bigint default 0,
  cumulative_output bigint default 0,
  cumulative_cache_read bigint default 0,
  cumulative_cache_write bigint default 0,
  used_percentage numeric(5,2)
);

create index idx_turns_session on turns(session_id);
create index idx_turns_user on turns(user_id);
create index idx_turns_timestamp on turns(timestamp);

-- Daily summaries (fast queries for dashboard)
create table daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  date date not null,
  total_input_tokens bigint default 0,
  total_output_tokens bigint default 0,
  total_cache_read bigint default 0,
  total_cache_write bigint default 0,
  session_count int default 0,
  turn_count int default 0,
  models_used jsonb default '{}',
  tools_used jsonb default '{}',
  estimated_cost_usd numeric(10,4) default 0,
  unique(user_id, date)
);

-- Badges
create table badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  badge_type text not null,
  earned_at timestamptz default now(),
  metadata jsonb default '{}',
  unique(user_id, badge_type)
);

-- Leaderboard entries
create table leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  period text not null,
  period_start date not null,
  total_tokens bigint default 0,
  total_cost_usd numeric(10,4) default 0,
  efficiency_score numeric(6,2) default 0,
  session_count int default 0,
  unique(user_id, period, period_start)
);

-- Row Level Security: users can only see their own data
alter table users enable row level security;
alter table sessions enable row level security;
alter table turns enable row level security;
alter table daily_summaries enable row level security;
alter table badges enable row level security;
alter table leaderboard_entries enable row level security;

-- RLS policies: users access their own data via anonymous_id match
-- The sync edge function runs as service_role and bypasses RLS
-- Dashboard queries use the user's JWT which contains their user_id

create policy "Users can read own data" on users
  for select using (id = auth.uid());

create policy "Users can read own sessions" on sessions
  for select using (user_id = auth.uid());

create policy "Users can read own turns" on turns
  for select using (user_id = auth.uid());

create policy "Users can read own daily summaries" on daily_summaries
  for select using (user_id = auth.uid());

create policy "Users can read own badges" on badges
  for select using (user_id = auth.uid());

-- Leaderboard: visible to all authenticated users (opted-in data only)
create policy "Leaderboard visible to authenticated users" on leaderboard_entries
  for select using (auth.role() = 'authenticated');
