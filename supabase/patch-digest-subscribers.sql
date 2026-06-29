-- Run this once if the schema was created before digest subscribers
-- were split out from activity_updates.

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

create index if not exists digest_subscribers_unsubscribed_idx
on public.digest_subscribers(unsubscribed_at);

drop trigger if exists digest_subscribers_set_updated_at on public.digest_subscribers;
create trigger digest_subscribers_set_updated_at before update on public.digest_subscribers
for each row execute function public.set_updated_at();

alter table public.digest_subscribers enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.digest_subscribers to anon, authenticated;

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
