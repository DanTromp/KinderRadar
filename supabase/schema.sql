-- My Kids Radar back-office schema.
-- Run this once in Supabase SQL Editor before importing data.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.towns (
  id uuid primary key default gen_random_uuid(),
  city_slug text not null references public.cities(slug) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_slug, name)
);

create table if not exists public.organizers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  website_url text,
  contact_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  town text,
  address text,
  geo_lat double precision,
  geo_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  section text not null,
  category text not null,
  age_range text not null,
  age_min integer not null,
  age_max integer not null,
  town text not null,
  timing text not null,
  day_of_week text,
  start_time text,
  end_time text,
  recurring text,
  cost text not null,
  price jsonb not null default '{}'::jsonb,
  beginner_friendly boolean not null default false,
  trial jsonb not null default '{}'::jsonb,
  trial_availability text,
  booking_required boolean,
  setting text,
  parent_participation text,
  language text,
  accessibility text,
  contact_url text,
  contact_method text,
  source_url text,
  last_verified date not null,
  verified_by text not null default 'editor',
  status text not null default 'active',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_age_order check (age_min <= age_max),
  constraint activities_status_check check (status in ('active', 'needs-update', 'reported-closed', 'draft')),
  constraint activities_verified_by_check check (verified_by in ('organizer', 'parent', 'editor'))
);

create table if not exists public.activity_sources (
  id uuid primary key default gen_random_uuid(),
  activity_slug text not null references public.activities(slug) on delete cascade,
  url text not null,
  source_type text not null default 'website',
  status text not null default 'active',
  last_checked_at timestamptz,
  last_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_slug, url)
);

create table if not exists public.verification_events (
  id uuid primary key default gen_random_uuid(),
  activity_slug text not null references public.activities(slug) on delete cascade,
  verified_by text not null default 'editor',
  verified_at date not null default current_date,
  source_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_updates (
  id uuid primary key default gen_random_uuid(),
  activity_slug text references public.activities(slug) on delete set null,
  update_type text not null,
  status text not null default 'new',
  payload jsonb not null default '{}'::jsonb,
  evidence_url text,
  reporter_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_updates_status_check check (status in ('new', 'needs_review', 'accepted', 'rejected', 'applied')),
  constraint activity_updates_type_check check (update_type in ('submission', 'update', 'closed', 'confirm', 'claim', 'organizer_claim'))
);

create table if not exists public.digest_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  locale text,
  source jsonb not null default '{}'::jsonb,
  consent_at timestamptz not null,
  unsubscribe_token text not null unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digest_subscribers_email_check check (
    email = lower(email)
    and length(email) between 3 and 254
    and position('@' in email) > 1
  ),
  constraint digest_subscribers_unsubscribe_token_check check (length(unsubscribe_token) >= 24)
);

create table if not exists public.feed_items (
  id uuid primary key default gen_random_uuid(),
  activity_slug text references public.activities(slug) on delete cascade,
  city_slug text not null references public.cities(slug) on delete cascade,
  kind text not null,
  title text not null,
  reason text,
  starts_at timestamptz,
  published_at timestamptz not null default now(),
  status text not null default 'published',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_slug, city_slug, kind)
);

create index if not exists activities_status_idx on public.activities(status);
create index if not exists activities_town_idx on public.activities(town);
create index if not exists activities_category_idx on public.activities(category);
create index if not exists activities_last_verified_idx on public.activities(last_verified desc);
create index if not exists feed_items_city_status_idx on public.feed_items(city_slug, status, published_at desc);
create index if not exists activity_updates_status_idx on public.activity_updates(status, created_at desc);
create index if not exists digest_subscribers_unsubscribed_idx on public.digest_subscribers(unsubscribed_at);

drop trigger if exists cities_set_updated_at on public.cities;
create trigger cities_set_updated_at before update on public.cities
for each row execute function public.set_updated_at();

drop trigger if exists towns_set_updated_at on public.towns;
create trigger towns_set_updated_at before update on public.towns
for each row execute function public.set_updated_at();

drop trigger if exists organizers_set_updated_at on public.organizers;
create trigger organizers_set_updated_at before update on public.organizers
for each row execute function public.set_updated_at();

drop trigger if exists venues_set_updated_at on public.venues;
create trigger venues_set_updated_at before update on public.venues
for each row execute function public.set_updated_at();

drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at before update on public.activities
for each row execute function public.set_updated_at();

drop trigger if exists activity_sources_set_updated_at on public.activity_sources;
create trigger activity_sources_set_updated_at before update on public.activity_sources
for each row execute function public.set_updated_at();

drop trigger if exists activity_updates_set_updated_at on public.activity_updates;
create trigger activity_updates_set_updated_at before update on public.activity_updates
for each row execute function public.set_updated_at();

drop trigger if exists digest_subscribers_set_updated_at on public.digest_subscribers;
create trigger digest_subscribers_set_updated_at before update on public.digest_subscribers
for each row execute function public.set_updated_at();

drop trigger if exists feed_items_set_updated_at on public.feed_items;
create trigger feed_items_set_updated_at before update on public.feed_items
for each row execute function public.set_updated_at();

alter table public.cities enable row level security;
alter table public.towns enable row level security;
alter table public.organizers enable row level security;
alter table public.venues enable row level security;
alter table public.activities enable row level security;
alter table public.activity_sources enable row level security;
alter table public.verification_events enable row level security;
alter table public.activity_updates enable row level security;
alter table public.digest_subscribers enable row level security;
alter table public.feed_items enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.cities to anon, authenticated;
grant select on public.towns to anon, authenticated;
grant select on public.organizers to anon, authenticated;
grant select on public.activities to anon, authenticated;
grant select on public.activity_sources to anon, authenticated;
grant select on public.feed_items to anon, authenticated;
grant insert on public.activity_updates to anon, authenticated;
grant insert on public.digest_subscribers to anon, authenticated;

drop policy if exists "public read cities" on public.cities;
create policy "public read cities" on public.cities
for select using (true);

drop policy if exists "public read towns" on public.towns;
create policy "public read towns" on public.towns
for select using (true);

drop policy if exists "public read organizers" on public.organizers;
create policy "public read organizers" on public.organizers
for select using (true);

drop policy if exists "public read published activities" on public.activities;
create policy "public read published activities" on public.activities
for select using (status in ('active', 'needs-update'));

drop policy if exists "public read activity sources for visible activities" on public.activity_sources;
create policy "public read activity sources for visible activities" on public.activity_sources
for select using (
  exists (
    select 1
    from public.activities a
    where a.slug = activity_sources.activity_slug
      and a.status in ('active', 'needs-update')
  )
);

drop policy if exists "public read feed" on public.feed_items;
create policy "public read feed" on public.feed_items
for select using (status = 'published');

drop policy if exists "public submit updates" on public.activity_updates;
create policy "public submit updates" on public.activity_updates
for insert
to anon, authenticated
with check (status = 'new');

drop policy if exists "public subscribe digest" on public.digest_subscribers;
create policy "public subscribe digest" on public.digest_subscribers
for insert
to anon, authenticated
with check (
  email = lower(email)
  and consent_at is not null
  and unsubscribe_token is not null
  and unsubscribed_at is null
);
