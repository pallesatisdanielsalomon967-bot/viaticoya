-- Simulación mínima de Supabase para probar schema.sql en un PostgreSQL real
create role anon nologin; create role authenticated nologin;
create schema extensions; create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', encrypted_password text, updated_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(n text) returns text[] language sql immutable as $$ select (string_to_array(n, '/'))[1:array_length(string_to_array(n,'/'),1)-1] $$;
grant usage on schema public, auth, storage, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
grant select on all tables in schema storage to authenticated;
