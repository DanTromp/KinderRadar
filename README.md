# Mein Kinder Radar / My Kids Radar

> **Find kids' activities that fit your child, schedule, budget, and confidence level — with listings that are actually kept fresh.**

A static, data-driven directory of local kids' activities. First city
shipped: **Haltern am See** (incl. Sythen, Hullern, Lavesum).

Pages are generated from a single source of truth
(`assets/activities-data.mjs`) so adding a city or an activity is a data
change, not an HTML change.

## Repository layout

```
/
  dist/                               generated static site (ignored by git)
  dist/index.html                     generated multi-place landing page
  dist/cities/<slug>/index.html       generated city pages
  dist/activities/<slug>/index.html   generated activity detail pages
  dist/robots.txt, dist/sitemap.xml   generated at build time
assets/
  activities-data.mjs                 ← source of truth (edit me)
  filtering.mjs                       pure filter / chip / search / sort logic
  render.mjs                          HTML rendering + freshness helpers
  filters.js                          browser glue (renders + filters in DOM)
  analytics.js                        cookieless, DNT-aware analytics shim
  styles.css
scripts/
  build-check.mjs                     schema validator (fails build on bad data)
  build.mjs                           static page generator + sitemap/robots into dist/
tests/
  filter.test.mjs                     filter, chip, search, sort tests
  render.test.mjs                     renderer + freshness tests
  data.test.mjs                       seed-data schema tests
.github/
  ISSUE_TEMPLATE/                     submit / update / closed / confirm / claim
  workflows/                          CI and issue labeller
```

## Commands

```bash
npm start       # build, then serve dist/ locally at http://localhost:4173/
npm run build   # validate data, then regenerate dist/
npm run build:supabase # export Supabase data, then run the static build
npm test        # run unit tests
npm run supabase:status # show table counts from Supabase
npm run supabase:updates # list new parent/organizer reports
npm run supabase:review # write a local HTML review pack to review/activity-updates.html
npm run supabase:update-status -- --id=<uuid> --status=applied
```

`npm run build` exits non-zero if any activity is missing required fields,
uses an `example.org` URL, has a bad date format, etc. It also prints
warnings when `lastVerified` is older than 90 days or when any filter
facet (section / town / category) has zero active listings.

## Editor workflow

1. Open `assets/activities-data.mjs`.
2. Add or edit an activity object. Required fields:
   `slug`, `name`, `section`, `category`, `ageRange`, `ageMin`, `ageMax`,
   `town`, `timing`, `cost`, `beginnerFriendly`, `lastVerified`. Always set
   a real `sourceUrl` and `contactUrl` (no `example.org`).
3. Set `lastVerified` to today's date (YYYY-MM-DD) whenever you confirm an
   entry. The freshness chip on every card is derived from this date:
   - `< 30 days` → "Verified N days ago" (green)
   - `30–90 days` → neutral
   - `> 90 days` → "Needs update" (amber)
   - `status: 'reported-closed'` → hidden from city grid + red banner on
     the detail page
4. Run `npm test` (it builds `dist/` first).
5. Open a PR. CI runs the same validator and tests.

Towns must be listed in `cities[].nearbyTowns` for at least one city — this
is enforced by the validator so activities can't be orphaned.

### Triaging public issues

Issues use the `data` label plus exactly one `type:*` label, applied by
the issue template (and reinforced by `.github/workflows/label-data-issues.yml`
for issues opened from the pre-filled query-string links on detail pages):

| Label              | Source template                  | Editor action                                                                 |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| `type:submission`  | `submit-activity.yml`            | Add a new entry to `activities-data.mjs`; cite the issue in the PR.            |
| `type:update`      | `suggest-update.yml`             | Edit the affected fields; verify against the evidence URL; bump `lastVerified`.|
| `type:closed`      | `report-closed.yml`              | Set `status: 'reported-closed'`; entry disappears from the city grid on deploy.|
| `type:confirm`     | `confirm-still-running.yml`      | Bump `lastVerified` to today; if the reporter is the organizer, set `verifiedBy: 'organizer'`. |
| `type:claim`       | `organizer-claim.yml`            | Do a quick courtesy check, then flip `verifiedBy: 'organizer'`.                |

Convention: one PR per batch of issues, prefixed `data:` in the commit message.

## Analytics

The site uses a cookieless analytics shim (`assets/analytics.js`) that:
- Respects `navigator.doNotTrack` — no events sent.
- Strips PII; only the search input is logged (trimmed, lowercased, ≤60 chars).
- Talks to **Plausible** if `window.MEINKINDERRADAR_PLAUSIBLE_DOMAIN` is set,
  otherwise no-ops (and prints to devtools console when `MEINKINDERRADAR_DEBUG`
  is true). Cloudflare Web Analytics page views work out of the box if
  the CF beacon `<script>` is added to `scripts/build.mjs`'s `layoutHtml`.

For Cloudflare Pages, set the environment variable
`MEINKINDERRADAR_PLAUSIBLE_DOMAIN` to enable Plausible during the deploy build.
Leave it unset for a no-op analytics build.

### Event schema (keep stable)

| Event                          | Properties                                            |
| ------------------------------ | ----------------------------------------------------- |
| `search`                       | `q`, `results`                                        |
| `filter_change`                | `name`, `value`, `results` (also fires for chip toggles as `name: "chip:<id>"`) |
| `zero_results`                 | `q`, `town`, `age`, `category`, `day`, `beginnerFriendly`, `chips` |
| `listing_click`                | `slug`                                                |
| `detail_view`                  | `slug`, `town`, `confidence`                          |
| `intent_select`                | `intent`, `results`                                   |
| `empty_state_recovery`         | `action`, `results`                                   |
| `suggest_update_click`         | —                                                     |
| `report_closed_click`          | —                                                     |
| `confirm_still_running_click`  | —                                                     |
| `organizer_claim_click`        | —                                                     |
| `submit_activity_click`        | —                                                     |
| `missing_listing_click`        | — (zero-results CTA; passes failing query via URL)    |
| `contact_click`                | —                                                     |

Renaming an event = breaking history. Add a new event instead.

## Public contributions

Each listing detail page and the city page include Supabase-backed forms.
Parents and organizers can submit, update, confirm, claim, or report closures
without an account. Activity reports land in `activity_updates` with
`status: "new"` for review; digest signups land in `digest_subscribers`.

### Review workflow

Use the service-role key only locally in `.env`; it is never exposed to the
deployed site. Typical flow:

```bash
npm run supabase:updates
npm run supabase:review
npm run supabase:update-status -- --id=<uuid> --status=needs_review
```

`npm run supabase:review` writes `review/activity-updates.html`, which is
ignored by git. After applying a data change and exporting/building, mark the
row `applied`; use `rejected` for spam or unverifiable reports.

## Deploy

The default deployment target is **Cloudflare Pages** using its native Git
integration. Do not add a GitHub Pages deploy workflow; Cloudflare should own
the production deploy. Set the Cloudflare environment variable
`MEINKINDERRADAR_BASE_URL` (e.g. `https://meinkinderradar.de`) once a custom
domain is in place; the value is baked into Open Graph URLs and `sitemap.xml`.

Internal links and assets are emitted as relative URLs, so the site works
both on a project subpath (`/MeinKinderRadar/`) and on a custom root
domain.

Point Cloudflare Pages at the repo and use:
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `MEINKINDERRADAR_BASE_URL`

This project does not require Wrangler for normal Cloudflare Pages Git
deployment: it is a static site with no `wrangler.toml` and the build writes
the deployable pages into `dist/`. Native Cloudflare Pages Git deployment is
therefore enough when Cloudflare builds from the connected repo.

Use Wrangler only for Direct Upload or external CI deployment. In that case,
the deploy step must authenticate to Cloudflare and upload a prepared static
asset directory:

```bash
wrangler pages deploy dist --project-name meinkinderradar
```

Set these deployment secrets/environment variables in the CI or Cloudflare
dashboard, not in the repo:
- `CLOUDFLARE_ACCOUNT_ID`: the target Cloudflare account ID
- `CLOUDFLARE_API_TOKEN`: an API token scoped to the target account with
  `Account -> Cloudflare Pages -> Edit`

The command above expects `dist` to exist before it runs. `npm run build`
creates that directory.
