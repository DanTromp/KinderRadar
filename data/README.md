# Source Registry

`source-registry.json` is a small list of trusted public sources to monitor for
possible new or changed kids activities. It is not live activity data and it does
not publish anything automatically.

Each source uses:

- `id`: stable unique key, kebab-case
- `town`: town or place this source mainly covers
- `sourceType`: short category such as `municipal`, `organizer`, `course_provider`, or `library`
- `organizerName`: public organization name when known
- `url`: public http(s) page to check
- `trustLevel`: `official`, `organizer`, `partner`, or `community`
- `crawlFrequency`: planning hint such as `weekly`, `monthly`, `quarterly`, or `manual`
- `active`: set `false` to keep the source documented but skip checks
- `notes`: editor-facing context for why the source matters

Run:

```bash
npm run sources:check
```

The checker fetches each active URL once, records status and a small content
hash, compares that with the previous local snapshot, and writes `report.md`,
`report.json`, `candidates.json`, and `snapshot.json` under
`review/source-monitor/`. The `review/` folder is ignored by git. It does not
scrape linked pages, collect personal data, write to Supabase, edit
`assets/activities-data.mjs`, or publish activities.

`.github/workflows/source-monitor.yml` runs the same command every Monday at
06:17 UTC and uploads those files as a `source-monitor-report` artifact. The
workflow is read-only and does not deploy.

If `review/source-monitor/candidates.json` is present locally, `npm run
admin:review` renders those candidates in the internal review HTML beside public
activity submissions. This is display-only; source candidates do not update
Supabase or live activity data.

If Supabase is unavailable, `npm run sources:review` renders only the local
source-monitor candidates without reading Supabase credentials.

In the admin review page, source-monitor candidates are read-only queue items.
They can be filtered by status, type, source, and town/place, and likely
duplicates are surfaced when the source ID plus snapshot/hash or source URL plus
candidate type match another item in the batch. Nothing is deleted or applied
automatically.

Future workflow:

```text
scheduled source check -> review candidates -> manual approval -> Supabase update -> export/build/deploy
```
