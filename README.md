# KinderRadar

Parent decision support for local kids' activities. Helps parents find
activities that actually fit their child, schedule, and confidence level,
with data they can trust.

The site is a static, data-driven directory. Pages are generated from a
single source of truth (`assets/activities-data.mjs`) so adding a city or
an activity is a data change, not an HTML change.

## Repository layout

```
/
  index.html                          static homepage
  cities/<slug>/index.html            generated city pages
  activities/<slug>/index.html        generated activity detail pages
assets/
  activities-data.mjs                 ← source of truth (edit me)
  filtering.mjs                       pure filter / chip / search / sort logic
  render.mjs                          HTML rendering + freshness helpers
  filters.js                          browser glue (renders + filters in DOM)
  styles.css
scripts/
  build-check.mjs                     schema validator (fails build on bad data)
  build.mjs                           static page generator
tests/
  filter.test.mjs                     filter, chip, search, sort tests
  render.test.mjs                     renderer + freshness tests
  data.test.mjs                       seed-data schema tests
.github/ISSUE_TEMPLATE/               "Submit activity" and "Suggest update"
```

## Commands

```bash
npm run build   # validate data, then regenerate cities/ and activities/
npm test        # run unit tests
```

`npm run build` exits non-zero if any activity is missing required fields,
references an unknown section/category, has a bad date format, etc.

## Editor workflow

1. Open `assets/activities-data.mjs`.
2. Add or edit an activity object. Required fields:
   `slug`, `name`, `section`, `category`, `ageRange`, `ageMin`, `ageMax`,
   `town`, `timing`, `cost`, `beginnerFriendly`, `lastVerified`.
3. Set `lastVerified` to today's date (YYYY-MM-DD) whenever you confirm an
   entry. The freshness badge on every card is derived from this date:
   - `< 30 days` → "Verified N days ago" (green)
   - `30–90 days` → neutral
   - `> 90 days` → "Needs update" (amber)
   - `status: 'reported-closed'` → red banner, sinks to bottom of lists
4. Run `npm run build && npm test`.
5. Open a PR. CI runs the same validator and tests.

Towns must be listed in `cities[].nearbyTowns` for at least one city — this
is enforced by the validator so activities can't be orphaned.

## Adding a city

Add an entry to the `cities` array in `assets/activities-data.mjs`:

```js
{ slug: 'my-town', name: 'My Town', nearbyTowns: ['My Town', 'Nearby Village'] }
```

Run `npm run build` and a new `cities/my-town/index.html` is generated.

## Contributions from the public

The deployed site links to two GitHub Issue templates:

- **Submit activity** — for new entries.
- **Suggest update** — for corrections, freshness re-verification, or
  reporting an activity as closed.

Issues are triaged into PRs against `activities-data.mjs`.
