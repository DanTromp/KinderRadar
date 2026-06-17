# KinderRadar

> **Find kids' activities that fit your child, schedule, budget, and confidence level — with listings that are actually kept fresh.**

A static, data-driven directory of local kids' activities. First city
shipped: **Haltern am See** (incl. Sythen, Hullern, Lavesum).

Pages are generated from a single source of truth
(`assets/activities-data.mjs`) so adding a city or an activity is a data
change, not an HTML change.

## Repository layout

```
/
  index.html                          single-city landing → redirects to Haltern
  cities/<slug>/index.html            generated city pages
  activities/<slug>/index.html        generated activity detail pages
  robots.txt, sitemap.xml             generated at build time
assets/
  activities-data.mjs                 ← source of truth (edit me)
  filtering.mjs                       pure filter / chip / search / sort logic
  render.mjs                          HTML rendering + freshness helpers
  filters.js                          browser glue (renders + filters in DOM)
  analytics.js                        cookieless, DNT-aware analytics shim
  styles.css
scripts/
  build-check.mjs                     schema validator (fails build on bad data)
  build.mjs                           static page generator + sitemap/robots
tests/
  filter.test.mjs                     filter, chip, search, sort tests
  render.test.mjs                     renderer + freshness tests
  data.test.mjs                       seed-data schema tests
.github/
  ISSUE_TEMPLATE/                     submit / update / closed / confirm / claim
  workflows/                          CI, deploy to GitHub Pages, issue labeller
```

## Commands

```bash
npm start       # serve the static app locally at http://localhost:4173/
npm run build   # validate data, then regenerate cities/ activities/ sitemap/ robots
npm run build:supabase # export Supabase data, then run the static build
npm test        # run unit tests
npm run supabase:status # show table counts from Supabase
npm run supabase:updates # list new parent/organizer reports
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
4. Run `npm run build && npm test`.
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
- Talks to **Plausible** if `window.KINDERRADAR_PLAUSIBLE_DOMAIN` is set,
  otherwise no-ops (and prints to devtools console when `KINDERRADAR_DEBUG`
  is true). Cloudflare Web Analytics page views work out of the box if
  the CF beacon `<script>` is added to `scripts/build.mjs`'s `layoutHtml`.

For GitHub Pages, set the repository variable
`KINDERRADAR_PLAUSIBLE_DOMAIN` to enable Plausible during the deploy build.
Leave it unset for a no-op analytics build.

### Event schema (keep stable)

| Event                          | Properties                                            |
| ------------------------------ | ----------------------------------------------------- |
| `search`                       | `q`, `results`                                        |
| `filter_change`                | `name`, `value`, `results` (also fires for chip toggles as `name: "chip:<id>"`) |
| `zero_results`                 | `q`, `town`, `age`, `category`, `beginnerFriendly`, `chips` |
| `listing_click`                | `slug`                                                |
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
without an account. Every report lands in `activity_updates` with
`status: "new"` for review.

## Deploy

The default deployment target is **GitHub Pages**, configured by
`.github/workflows/deploy.yml` on push to `main`. Set the repository
variable `KINDERRADAR_BASE_URL` (e.g. `https://haltern.kinderradar.de`)
once a custom domain is in place; the value is baked into Open Graph URLs
and `sitemap.xml`.

Internal links and assets are emitted as relative URLs, so the site works
both on a GitHub Pages project URL (`/KinderRadar/`) and on a custom root
domain.

To switch to Cloudflare Pages instead, point Cloudflare at the repo and
use:
- Build command: `npm run build`
- Output directory: `.` (the generator writes pages in place)
- Environment variable: `KINDERRADAR_BASE_URL`
