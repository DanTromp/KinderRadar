# Expansion Workspace

The expansion workspace is for review-first market planning. Nothing in this
folder is live public activity data. Activities become public only after a human
manually applies reviewed data through the trusted source-data workflow.

## First test market: Borken Region

The first real local planning seed lives at
`expansion/markets/borken-region.json`. It contains the Borken Region market,
seven places/sub-areas, and a source checklist with empty URLs for manual
research. It is planning data only and is not used by the public site.

Inspect the workspace:

```bash
npm run expansion:report
```

Manually fill checklist URLs only after checking trusted public sources. Keep
items with `status: "missing"` and `url: ""` until a real source has been found.
This workflow does not scrape, publish, write Supabase, deploy, or modify
`assets/activities-data.mjs`.

Suggested market file:

```json
{
  "id": "recklinghausen",
  "name": "Recklinghausen",
  "places": [
    { "id": "recklinghausen", "name": "Recklinghausen", "town": "Recklinghausen" }
  ],
  "sources": [
    {
      "id": "recklinghausen-city",
      "url": "https://www.recklinghausen.de/",
      "organizerName": "Stadt Recklinghausen"
    }
  ],
  "candidates": [
    {
      "id": "recklinghausen-sample-course",
      "candidateType": "activity",
      "status": "approved_for_manual_apply",
      "title": "Sample kids course",
      "placeId": "recklinghausen",
      "sourceId": "recklinghausen-city",
      "sourceUrl": "https://www.recklinghausen.de/",
      "organizerName": "Stadt Recklinghausen",
      "possibleCategory": "Sports",
      "possibleAgeRange": "6-10",
      "possibleSchedule": "Tuesday afternoon",
      "possibleLocation": "Town hall",
      "reviewNotes": "Human-approved candidate; complete before applying."
    }
  ]
}
```

Generate one draft:

```bash
npm run expansion:draft:create -- --market=recklinghausen --candidate=recklinghausen-sample-course
```

Generate all approved activity candidates:

```bash
npm run expansion:draft:create -- --all
```

Drafts are written under `expansion/drafts/<market>/<candidate>.json`, which is
ignored by git. The generator skips existing drafts unless `--overwrite` is
passed. Candidate `sourceId` values can point at sources in the market file or
at trusted entries in `data/source-registry.json`; pass
`--source-registry=<path>` only for alternate local review workspaces. Drafts are
local-only preparation files; they do not write Supabase, edit
`assets/activities-data.mjs`, publish, deploy, scrape, or use AI extraction.

Review draft health:

```bash
npm run expansion:draft:report
```

Validate readiness before manually applying a draft:

```bash
npm run expansion:draft:validate
```

Generate manual apply packets for drafts marked `ready_for_manual_apply`:

```bash
npm run expansion:apply-packet
```

Packets are written to `expansion/apply-packets/<market>/<draft-id>.md`, which
is ignored by git. Use a packet as a human review and copy/reference aid when
manually adding the activity through the trusted workflow. The packet includes
activity fields, source context, candidate notes, duplicate warnings, missing
fields, validation warnings, and a final manual checklist. It is not a live
activity.

Read `missingFields` as live activity fields that still need manual completion.
Read `warnings` as uncertain mappings, duplicate risks, or values that could not
be safely copied into the live activity shape.

Readiness statuses:

- `draft`: local preparation is still in progress.
- `needs_manual_completion`: required fields or references are missing.
- `ready_for_manual_apply`: the validator found no blocking errors; warnings may
  still need human review.
- `manually_applied`: a human has already applied the draft through the trusted
  data workflow. The validator never sets this automatically.

Validator errors mean the draft is blocked before manual apply. Validator
warnings mean the draft may be structurally complete but still needs human
judgment, such as duplicate review, organizer confirmation, source specificity,
or placeholder cleanup.

Manual checklist before applying:

- source checked manually
- organizer verified
- schedule verified
- location verified
- price verified
- age range verified
- category verified
- duplicate check completed
- German/English text checked where applicable

Validation is read-only. It does not publish anything, write Supabase, modify
`assets/activities-data.mjs`, create live activities, deploy, scrape, or use AI
extraction.

Packet generation is also local-only. It writes Markdown packets only and does
not write Supabase, modify `assets/activities-data.mjs`, publish, deploy,
scrape, use AI extraction, or auto-apply anything.

Workflow:

```text
create market
-> add places
-> generate source checklist
-> manually add trusted sources
-> manually add review candidates
-> review duplicates
-> mark candidate approved_for_manual_apply
-> generate local activity draft
-> validate draft readiness
-> generate manual apply packet
-> manually add through trusted workflow
-> export/build/deploy
```
