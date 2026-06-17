-- Run this once if the schema was created before public contribution forms
-- were added. It allows the publishable/anon key to insert new review reports.

grant usage on schema public to anon, authenticated;
grant insert on public.activity_updates to anon, authenticated;

drop policy if exists "public submit updates" on public.activity_updates;
create policy "public submit updates" on public.activity_updates
for insert
to anon, authenticated
with check (status = 'new');
