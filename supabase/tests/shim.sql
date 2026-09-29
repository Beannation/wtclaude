-- Minimal Supabase shim for a scratch local Postgres: the roles and auth helpers
-- migrations 001-009 reference, plus the PostgREST `authenticator` login role the
-- edge-function tests use. Local testing only — never run against the project.
-- Roles are cluster-wide, so they are created once; the rest is per database.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
-- Like the hosted project: service_role gets table access by default, and new
-- functions are executable by every API role unless a migration revokes it.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'anon'::text $$;
