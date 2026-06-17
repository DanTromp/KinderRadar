# Supabase Back Office

This folder contains the first database layer for KinderRadar.

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

## Product Shape

Supabase should become the back office source of truth. The public static site
can still be generated from verified/published Supabase rows so the launch stays
fast, searchable, and cheap to host.
