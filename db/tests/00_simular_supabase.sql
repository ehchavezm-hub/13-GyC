-- Simula lo mínimo de Supabase para probar las migraciones en un Postgres local.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- Como en Supabase: las funciones nuevas de public se pueden ejecutar por anon/authenticated/service_role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}',
  banned_until timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
