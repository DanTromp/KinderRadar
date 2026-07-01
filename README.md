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
npm run release:check # run tests/build/coverage and print a manual deploy preflight summary
npm run expansion:apply-packet
npm run expansion:report
npm run expansion:draft:create -- --market=<market-id> --candidate=<candidate-id>
npm run expansion:draft:report
npm run expansion:draft:validate
npm run freshness:report # report stale/soon-stale listings and local freshness review tasks
npm run verification:drafts # prepare draft-only organizer outreach messages
npm run review:apply-preview -- --file=review/verification/candidates.json --id=<review-id>
npm run review:apply -- --file=review/verification/candidates.json --id=<review-id>
npm run supabase:status # show table counts from Supabase
npm run supabase:updates # list new parent/organizer reports
npm run supabase:review # write a local HTML review pack to review/activity-updates.html
npm run supabase:update-status -- --id=<uuid> --status=applied
npm run sources:check # check trusted source URLs and write local review candidates
npm run sources:review # render source candidates without querying Supabase
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
   - `30-74 days` -> neutral aging
   - `75-90 days` -> needs verification soon in operational reports
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

## Source monitoring

Repeatable city expansion starts with `data/source-registry.json`: a small
trusted-source list for official town pages, organizers, libraries, course
providers, and similar public pages. Add one source per stable page with a
unique `id`, `town`, `sourceType`, `organizerName`, `url`, `trustLevel`,
`crawlFrequency`, `active`, and editor-facing `notes`.

Run:

```bash
npm run sources:check
```

The checker fetches each active source once with a clear user agent, records
HTTP status plus a small hash/ETag/Last-Modified snapshot, and compares it with
the previous local snapshot. It writes review-only files to
`review/source-monitor/`, which is ignored by git:

- `report.md` for human review
- `report.json` for machine-readable review
- `candidates.json` for changed/unreachable source candidates
- `snapshot.json` for the next comparison

The scheduled GitHub Actions workflow `.github/workflows/source-monitor.yml`
runs every Monday at 06:17 UTC and can also be started manually from the Actions
tab. It restores the previous snapshot from the Actions cache, runs
`npm run sources:check`, and uploads the report files as the
`source-monitor-report` artifact. The workflow has `contents: read`, does not
deploy, does not commit files, and does not require Supabase secrets.

When `review/source-monitor/candidates.json` exists locally, `npm run admin:review`
includes those source-monitor candidates as read-only machine-detected cards
beside the Supabase `activity_updates` queue. They are labelled as source
candidates and include the source URL, town, organizer, confidence, reason, and
snapshot hash reference. They are not inserted into Supabase and there is no
approve/apply button; editors still verify manually before changing source data
or exporting/building.

If Supabase is unavailable, run `npm run sources:review` to render only the
local source-monitor candidates into `review/admin/source-candidates/index.html`
without reading `.env` or querying Supabase.

The generated admin review page uses this operational status model for queue
organization: `needs_review`, `in_review`, `needs_follow_up`,
`approved_for_manual_apply`, `rejected`, `ignored_duplicate`, and `handled`.
Existing Supabase `activity_updates` statuses are mapped for display
(`new` -> `needs_review`, `accepted` -> `approved_for_manual_apply`,
`applied` -> `handled`) while preserving the raw status on the card. Browser
status changes and reviewer notes remain read-only because the current schema
does not include reviewer-note storage or a secure admin write endpoint for the
new status model.

The admin page also surfaces likely duplicates without deleting anything:
matching source ID plus snapshot/hash, matching source URL plus candidate type
in the current batch, matching activity ID plus submission type, and matching
organizer claim submitter.

The checker does not follow arbitrary links, scrape social platforms, collect
personal data, write to Supabase, edit `assets/activities-data.mjs`, or publish
anything.

Future path: scheduled source check -> review candidates -> manual approval ->
Supabase update -> export/build/deploy.

## Expansion activity drafts

Expansion planning can create local activity drafts from approved review
candidates without touching public data. Market/candidate files live under
`expansion/`; generated drafts are written to ignored local files under
`expansion/drafts/<market-slug>/<candidate-id>.json`.
Candidate `sourceId` values are validated against the market's own `sources`
array and the trusted source registry at `data/source-registry.json`.

Create a draft for one approved activity candidate:

```bash
npm run expansion:draft:create -- --market=<market-id> --candidate=<candidate-id>
```

Use `--source-registry=<path>` only for local tests or alternate review
workspaces; the default is `data/source-registry.json`.

Create drafts for all approved activity candidates:

```bash
npm run expansion:draft:create -- --all
```

Report draft health:

```bash
npm run expansion:draft:report
```

Validate draft readiness before manual apply:

```bash
npm run expansion:draft:validate
```

Generate manual apply packets for ready drafts:

```bash
npm run expansion:apply-packet
```

Drafts include `missingFields` for required live activity fields that still need
manual completion and `warnings` for uncertain mappings, unknown categories, or
possible live duplicates. This workflow does not edit
`assets/activities-data.mjs`, write Supabase, publish, deploy, scrape, run AI
extraction, or create live activities.

The readiness validator is stricter than the summary report. It reads local
draft JSON files, compares `activityDraft` objects with the live activity
validator, checks market/candidate/place/source references, preserves duplicate
warnings, and reports a recommendation of `ready_for_manual_apply` only when no
readiness errors remain. Warnings mean a human should inspect the draft before
applying it; errors mean the draft is blocked until completed. The command is
read-only and does not mark drafts `manually_applied`.

Manual apply packets are Markdown files under
`expansion/apply-packets/<market-slug>/`, ignored by git. They collect the
activity draft, source context, candidate notes, duplicate warnings, missing
fields, and a final checklist so a human can copy data through the normal
trusted workflow. Packet generation does not edit `assets/activities-data.mjs`,
write Supabase, publish, deploy, scrape, or auto-apply anything.

The expansion workspace report summarizes local market planning files:

```bash
npm run expansion:report
```

It validates local market shape, place references, and source checklist status
without touching live activity data.

## Freshness monitoring

Run:

```bash
npm run freshness:report
```

The freshness report reads only `assets/activities-data.mjs`. It does not query
Supabase, update `lastVerified`, mark listings inactive, deploy, or send email.
It classifies active listings as:

- `fresh`: verified less than 30 days ago
- `aging`: verified 30-74 days ago
- `needs_verification_soon`: verified 75-90 days ago
- `stale`: verified more than 90 days ago
- `missing_verification`: missing, invalid, or future `lastVerified`

By default it writes review-only local artifacts under `review/freshness/`,
which is ignored by git:

- `report.md` for human planning notes
- `report.json` for machine-readable planning
- `candidates.json` for read-only freshness review tasks

When `review/freshness/candidates.json` exists, `npm run admin:review` includes
those freshness tasks as machine-detected, read-only cards. They are not inserted
into Supabase and cannot change public data from the browser.

Manual process: freshness report -> review task -> verify source/organizer ->
manual apply -> release check -> deploy. Organizer reminder data is draft-only;
no emails are sent and no email provider is configured.

## Organizer verification drafts

Run:

```bash
npm run verification:drafts
```

The draft generator reads only `assets/activities-data.mjs`, finds active
activities with freshness status `needs_verification_soon`, `stale`, or
`missing_verification`, and groups them by derived organizer. It writes
review-only local artifacts under `review/verification-drafts/`, which is
ignored by git:

- `report.md` for human review
- `report.json` for machine-readable planning
- `drafts.json` for the generated draft objects

Drafts are separated into organizers with `contactEmail`, organizers with only
a website/contact URL, and organizers with no contact info. The script creates
German draft text first plus an English fallback, but it does not send email,
open a mail client, contact organizers, write Supabase, update `lastVerified`,
or modify activity/organizer data.

Manual process: freshness report -> generate drafts -> manually contact
organizer -> receive confirmation -> create `activity_verification` review item
-> approve/apply -> release check.

## Manual verification apply

Freshness tasks do not update listings by themselves. After a human checks an
activity source or organizer confirmation, create a local review item with
`type: "activity_verification"` and `status: "approved_for_manual_apply"`.
Keep internal notes in `reviewerNotes`; only put non-sensitive public notes in
`verificationNotes`, because `assets/activities-data.mjs` is shipped to the
browser.

Example:

```json
{
  "id": "verify-dlrg-haltern-anfaengerschwimmen-2026-07-01",
  "type": "activity_verification",
  "status": "approved_for_manual_apply",
  "activityId": "dlrg-haltern-anfaengerschwimmen",
  "activityName": "DLRG Haltern Anfängerschwimmen",
  "previousLastVerified": "2026-06-16",
  "proposedLastVerified": "2026-07-01",
  "verificationSource": "https://haltern.dlrg.de/",
  "verificationMethod": "source_check",
  "verifiedBy": "editor",
  "reviewerNotes": "Checked the public course page manually."
}
```

Preview first:

```bash
npm run review:apply-preview -- --file=review/verification/candidates.json --id=verify-dlrg-haltern-anfaengerschwimmen-2026-07-01
```

Apply only after the preview shows the expected verification-only diff:

```bash
npm run review:apply -- --file=review/verification/candidates.json --id=verify-dlrg-haltern-anfaengerschwimmen-2026-07-01
```

The apply script rejects missing/unknown/inactive activities, future proposed
dates, stale `previousLastVerified` values, missing evidence URLs, and any item
that is not `approved_for_manual_apply`. It updates only `lastVerified`,
`verifiedBy`, `verifiedAt`, `verificationSource`, `verificationMethod`, and
optional public `verificationNotes`, then validates the activity dataset.

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

### Release preflight

Safe publish flow:

1. Review public submissions and source-monitor candidates.
2. Approve changes for manual apply only after checking the source.
3. Update Supabase/source data manually.
4. Export data with `npm run supabase:export` or use `npm run build:supabase`.
5. Run `npm run release:check`.
6. Inspect the `assets/activities-data.mjs` diff and the release summary.
7. Commit reviewed source-data changes.
8. Let Cloudflare Pages deploy from Git, if the connected branch is the current production path.

`npm run release:check` is local preflight only. It runs the existing tests,
build, and coverage report, then summarizes active activity count, place pages,
organizers, categories, collections, generated pages, sitemap/robots/canonical
signals, freshness, metadata gaps, and whether `assets/activities-data.mjs`
changed against Git `HEAD`.

Warnings mean "inspect before publishing", for example a large active-listing
drop, increased inactive/reported-closed count, sitemap count lower than HTML
page count, or missing metadata. Hard failures mean the site should not be
published until fixed, for example zero active activities, no place pages, no
generated HTML, empty sitemap, or missing sitemap reference in `robots.txt`.

The release check does not deploy, commit, write to Supabase, export from
Supabase, change review statuses, or modify activity data.
