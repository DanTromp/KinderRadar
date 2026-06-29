# Supabase Back Office

This folder contains the first database layer for My Kids Radar.

## Setup

1. Open Supabase Dashboard.
2. Go to SQL Editor.
3. Run `supabase/schema.sql`.
4. Ensure local `.env` contains:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_PUBLISHABLE_KEY=...
```

The `.env` file is ignored by git.

## Import Current Data

```sh
npm run supabase:import
```

This imports:

- `cities`
- `towns`
- `activities`
- `activity_sources`
- initial `feed_items`

Verification events are append-only, so they are skipped by default. To add an
initial verification event for every activity:

```sh
npm run supabase:import -- --with-verification-events
```

## Build From Supabase

Once Supabase is the editing surface, export the published data back into the
static generator:

```sh
npm run supabase:export
npm run build
```

Or do both in one command:

```sh
npm run build:supabase
```

This rewrites `assets/activities-data.mjs` from Supabase rows, then regenerates
the public static pages. The exported file is intentionally still committed so
the site can be built, tested, and reviewed without requiring database access.

## Review Incoming Reports

Public forms insert into `activity_updates` with `status: "new"`.

If your schema was created before the public forms were added, run
`supabase/patch-activity-updates-public-insert.sql` once in Supabase SQL Editor.

```sh
npm run supabase:updates
```

To inspect another status:

```sh
npm run supabase:updates -- --status=needs_review
```

For now, review and apply updates in Supabase Studio, then run:

```sh
npm run build:supabase
```

## Digest Subscribers

Digest signups are stored separately in `digest_subscribers` so they do not
pollute the activity review queue. The public site inserts only the normalized
email, locale, source context, consent timestamp, and unsubscribe token.

If your schema was created before this table was added, run
`supabase/patch-digest-subscribers.sql` once in Supabase SQL Editor.

## Product Shape

Supabase should become the back office source of truth. The public static site
can still be generated from verified/published Supabase rows so the launch stays
fast, searchable, and cheap to host.
