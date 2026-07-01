import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  activityDraftFromCandidate,
  buildDraftReadinessReport,
  buildDraftReport,
  buildExpansionReport,
  createApplyPackets,
  createExpansionDrafts,
  loadExpansionWorkspace,
  renderDraftReadinessReport,
  renderDraftReport,
  renderExpansionReport,
} from '../scripts/expansion-drafts.mjs';

const CHECKLIST_STATUSES = new Set(['missing', 'found', 'reviewing', 'approved', 'rejected', 'not_applicable']);

async function loadBorkenMarket() {
  return JSON.parse(await readFile(new URL('../expansion/markets/borken-region.json', import.meta.url), 'utf8'));
}

async function makeWorkspace(market = {}) {
  const dir = join(tmpdir(), `kr-expansion-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(dir, 'markets'), { recursive: true });
  const data = {
    id: 'duelmen',
    name: 'Dülmen',
    places: [
      { id: 'duelmen', name: 'Dülmen', town: 'Dülmen' },
      { id: 'buldern', name: 'Buldern', town: 'Buldern' },
    ],
    sources: [
      { id: 'duelmen-city', url: 'https://duelmen.example.test/', organizerName: 'Stadt Dülmen' },
    ],
    candidates: [],
    ...market,
  };
  await writeFile(join(dir, 'markets', `${data.id}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { dir, market: data };
}

function candidate(overrides = {}) {
  return {
    id: overrides.id ?? 'duelmen-kids-course',
    candidateType: overrides.candidateType ?? 'activity',
    status: overrides.status ?? 'approved_for_manual_apply',
    title: overrides.title ?? 'Dülmen Kids Course',
    placeId: overrides.placeId ?? 'duelmen',
    sourceId: overrides.sourceId ?? 'duelmen-city',
    sourceUrl: overrides.sourceUrl ?? 'https://duelmen.example.test/course',
    organizerName: overrides.organizerName ?? 'Stadt Dülmen',
    possibleCategory: overrides.possibleCategory ?? 'Sports',
    possibleAgeRange: overrides.possibleAgeRange ?? '6-10',
    possibleSchedule: overrides.possibleSchedule ?? 'Tuesday, 16:00',
    possibleLocation: overrides.possibleLocation ?? 'Town hall',
    possibleCost: overrides.possibleCost ?? 'Free',
    reviewNotes: overrides.reviewNotes ?? 'Approved after manual review.',
    ...overrides,
  };
}

function completeDraft(overrides = {}) {
  const activityDraft = {
    slug: 'duelmen-kids-course',
    name: 'Dülmen Kids Course',
    section: 'weekly-activities',
    category: 'Sports',
    ageRange: '6-10',
    ageMin: 6,
    ageMax: 10,
    town: 'Dülmen',
    timing: 'Tuesday, 16:00',
    cost: 'Free',
    beginnerFriendly: true,
    lastVerified: '2026-07-01',
    status: 'active',
    sourceUrl: 'https://www.vhs-duelmen.de/kids-course',
    contactUrl: 'https://www.vhs-duelmen.de/kids-course',
    organizer: { name: 'VHS Dülmen-Haltern-Dorsten', slug: 'vhs-duelmen-haltern-dorsten' },
    address: 'Town hall',
    dayOfWeek: 'Tuesday',
    startTime: '16:00',
    ...(overrides.activityDraft ?? {}),
  };
  return {
    draftId: 'draft:duelmen:duelmen-kids-course',
    sourceCandidateId: 'duelmen-kids-course',
    marketId: 'duelmen',
    placeId: 'duelmen',
    status: 'draft',
    generatedAt: '2026-07-01T12:00:00.000Z',
    reviewNotes: 'Ready after manual completion.',
    missingFields: [],
    warnings: [],
    activityDraft,
    ...overrides,
  };
}

async function writeDraft(dir, draft, marketSlug = 'duelmen') {
  const draftDir = join(dir, 'drafts', marketSlug);
  await mkdir(draftDir, { recursive: true });
  const path = join(draftDir, `${draft.sourceCandidateId || 'draft'}.json`);
  await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return path;
}

test('Borken Region expansion market seed validates basic shape', async () => {
  const market = await loadBorkenMarket();
  assert.equal(market.id, 'borken-region');
  assert.equal(market.slug, 'borken-region');
  assert.equal(market.status, 'planning');
  assert.equal(market.targetListingCount, 80);
  assert.equal(market.places.length, 7);
  assert.equal(market.sourceChecklist.length, 40);
  assert.deepEqual(market.sources, []);
  assert.deepEqual(market.candidates, []);
});

test('Borken Region places have unique slugs and aliases arrays', async () => {
  const market = await loadBorkenMarket();
  const slugs = new Set();
  for (const place of market.places) {
    assert.match(place.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!slugs.has(place.slug), `duplicate place slug ${place.slug}`);
    slugs.add(place.slug);
    assert.ok(Array.isArray(place.aliases), `${place.id} aliases must be an array`);
  }
});

test('Borken Region source checklist references known places and allows missing urls', async () => {
  const market = await loadBorkenMarket();
  const placeIds = new Set(market.places.map((place) => place.id));
  for (const item of market.sourceChecklist) {
    assert.ok(placeIds.has(item.placeId), `unknown checklist placeId ${item.placeId}`);
    assert.ok(CHECKLIST_STATUSES.has(item.status), `invalid checklist status ${item.status}`);
    assert.equal(item.status, 'missing');
    assert.equal(item.url, '');
  }
});

test('expansion report handles Borken Region seed safely', async () => {
  const report = await buildExpansionReport({ workspaceDir: 'expansion' });
  const borken = report.markets.find((market) => market.id === 'borken-region');
  assert.ok(borken, 'expected Borken Region in expansion report');
  assert.equal(borken.places, 7);
  assert.equal(borken.checklistItems, 40);
  assert.equal(borken.missingChecklistItems, 40);
  assert.deepEqual(borken.errors, []);
  assert.match(renderExpansionReport(report), /Borken Region/);
});

test('expansion report does not modify live activity data or require Supabase', async () => {
  const before = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
  await buildExpansionReport({ workspaceDir: 'expansion' });
  const after = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
  assert.equal(after, before);
});

test('approved expansion candidate generates a local activity draft', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    const result = await createExpansionDrafts({
      workspaceDir: dir,
      marketId: 'duelmen',
      candidateId: 'duelmen-kids-course',
      now: new Date('2026-07-01T12:00:00Z'),
      live: [],
    });

    assert.equal(result.created.length, 1);
    assert.equal(result.errors.length, 0);
    const draft = JSON.parse(await readFile(result.created[0].path, 'utf8'));
    assert.equal(draft.sourceCandidateId, 'duelmen-kids-course');
    assert.equal(draft.marketId, 'duelmen');
    assert.equal(draft.activityDraft.name, 'Dülmen Kids Course');
    assert.equal(draft.activityDraft.category, 'Sports');
    assert.equal(draft.activityDraft.ageMin, 6);
    assert.equal(draft.activityDraft.ageMax, 10);
    assert.ok(draft.missingFields.includes('section'));
    assert.ok(draft.missingFields.includes('lastVerified'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-approved candidates are skipped in all mode', async () => {
  const { dir } = await makeWorkspace({
    candidates: [
      candidate({ id: 'draft-me', status: 'needs_review' }),
    ],
  });
  try {
    const result = await createExpansionDrafts({
      workspaceDir: dir,
      all: true,
      live: [],
    });
    assert.equal(result.created.length, 0);
    assert.equal(result.skipped[0].reason, 'not approved_for_manual_apply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('candidate references are validated before draft generation', async () => {
  const { dir } = await makeWorkspace({
    candidates: [
      candidate({ id: 'bad-place', placeId: 'missing-place' }),
      candidate({ id: 'bad-source', sourceId: 'missing-source' }),
      candidate({ id: 'bad-type', candidateType: 'source_change' }),
    ],
  });
  try {
    const result = await createExpansionDrafts({
      workspaceDir: dir,
      all: true,
      live: [],
    });
    assert.equal(result.created.length, 0);
    assert.equal(result.errors.length, 3);
    assert.ok(result.errors.some((item) => item.errors.some((error) => /placeId/.test(error))));
    assert.ok(result.errors.some((item) => item.errors.some((error) => /sourceId/.test(error))));
    assert.ok(result.errors.some((item) => item.errors.some((error) => /candidateType/.test(error))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('candidate source references can resolve through the trusted source registry', async () => {
  const { dir } = await makeWorkspace({
    sources: [],
    candidates: [
      candidate({
        sourceId: 'duelmen-vhs',
        sourceUrl: '',
        organizerName: '',
      }),
    ],
  });
  const registryPath = join(dir, 'source-registry.json');
  await writeFile(registryPath, `${JSON.stringify([
    {
      id: 'duelmen-vhs',
      town: 'Dülmen',
      sourceType: 'course_provider',
      organizerName: 'VHS Dülmen',
      url: 'https://vhs-duelmen.example.test/',
      trustLevel: 'organizer',
      crawlFrequency: 'manual',
      active: true,
    },
  ], null, 2)}\n`, 'utf8');

  try {
    const result = await createExpansionDrafts({
      workspaceDir: dir,
      sourceRegistryPath: registryPath,
      all: true,
      live: [],
    });

    assert.equal(result.created.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.created[0].draft.activityDraft.sourceUrl, 'https://vhs-duelmen.example.test/');
    assert.equal(result.created[0].draft.activityDraft.organizer.name, 'VHS Dülmen');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unknown category is warned and not silently accepted', async () => {
  const { dir } = await makeWorkspace({
    candidates: [
      candidate({ id: 'unknown-category', possibleCategory: 'Magic lessons' }),
    ],
  });
  try {
    const result = await createExpansionDrafts({
      workspaceDir: dir,
      all: true,
      live: [],
    });
    const draft = result.created[0].draft;
    assert.equal(draft.activityDraft.category, '');
    assert.ok(draft.missingFields.includes('category'));
    assert.ok(draft.warnings.some((warning) => /Unknown category/.test(warning)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate draft generation is skipped safely', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    const first = await createExpansionDrafts({ workspaceDir: dir, all: true, live: [] });
    const second = await createExpansionDrafts({ workspaceDir: dir, all: true, live: [] });
    assert.equal(first.created.length, 1);
    assert.equal(second.created.length, 0);
    assert.equal(second.skipped[0].reason, 'draft already exists');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draft generation does not modify live activity data', async () => {
  const before = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await createExpansionDrafts({ workspaceDir: dir, all: true, live: [] });
    const after = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
    assert.equal(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draft report works with zero drafts and groups by status', async () => {
  const { dir } = await makeWorkspace();
  try {
    const empty = await buildDraftReport({ workspaceDir: dir });
    assert.equal(empty.totals.drafts, 0);
    assert.match(renderDraftReport(empty), /- none/);

    await createExpansionDrafts({ workspaceDir: dir, all: true, live: [] });
    const marketPath = join(dir, 'markets', 'duelmen.json');
    const market = JSON.parse(await readFile(marketPath, 'utf8'));
    market.candidates = [candidate()];
    await writeFile(marketPath, `${JSON.stringify(market, null, 2)}\n`, 'utf8');
    await createExpansionDrafts({ workspaceDir: dir, all: true, live: [] });
    const report = await buildDraftReport({ workspaceDir: dir });
    assert.equal(report.totals.drafts, 1);
    assert.equal(report.byStatus.needs_manual_completion, 1);
    assert.ok(report.totals.missingRequired > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('valid complete draft is recommended ready by readiness validation', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft());
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });

    assert.equal(report.totals.drafts, 1);
    assert.equal(report.totals.withErrors, 0);
    assert.equal(report.totals.recommendedReady, 1);
    assert.equal(report.drafts[0].recommendation, 'ready_for_manual_apply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readiness validation reports missing required fields unknown categories and unknown places', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({
      placeId: 'missing-place',
      activityDraft: {
        name: '',
        category: 'Magic lessons',
      },
    }));
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    const errors = report.drafts[0].errors.join('\n');

    assert.equal(report.totals.withErrors, 1);
    assert.match(errors, /missing required field "name"/);
    assert.match(errors, /category/);
    assert.match(errors, /placeId "missing-place"/);
    assert.equal(report.drafts[0].recommendation, 'needs_manual_completion');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readiness validation rejects invalid source urls', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({
      activityDraft: {
        sourceUrl: 'not-a-url',
        contactUrl: 'not-a-url',
      },
    }));
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    const errors = report.drafts[0].errors.join('\n');

    assert.match(errors, /sourceUrl/);
    assert.match(errors, /contactUrl/);
    assert.equal(report.totals.missingSourceUrl, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readiness validation preserves duplicate warnings and detects placeholders', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({
      possibleDuplicateActivityIds: ['existing-activity'],
      activityDraft: {
        cost: 'TODO confirm',
      },
    }));
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    const warnings = report.drafts[0].warnings.join('\n');

    assert.match(warnings, /Possible duplicate activity id/);
    assert.match(warnings, /Placeholder detected/);
    assert.equal(report.totals.possibleDuplicateActivityIds, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ready-for-manual-apply drafts still report warnings', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({
      status: 'ready_for_manual_apply',
      warnings: ['Category was inferred from candidate and needs confirmation.'],
    }));
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    const warnings = report.drafts[0].warnings.join('\n');

    assert.equal(report.drafts[0].recommendation, 'ready_for_manual_apply');
    assert.match(warnings, /Category was inferred/);
    assert.match(warnings, /marked ready_for_manual_apply/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draft readiness report works with zero drafts', async () => {
  const { dir } = await makeWorkspace();
  try {
    const report = await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    assert.equal(report.totals.drafts, 0);
    assert.match(renderDraftReadinessReport(report), /- none/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readiness validation does not modify live activity data or require Supabase', async () => {
  const before = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft());
    await buildDraftReadinessReport({ workspaceDir: dir, live: [] });
    const after = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
    assert.equal(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ready draft generates a manual apply Markdown packet with context and checklist', async () => {
  const { dir } = await makeWorkspace({
    sources: [
      {
        id: 'duelmen-city',
        url: 'https://duelmen.example.test/',
        organizerName: 'Stadt Dülmen',
        sourceType: 'municipal',
        trustLevel: 'official',
        notes: 'Official family page.',
        lastChecked: '2026-07-01',
      },
    ],
    candidates: [
      candidate({
        confidence: 'medium',
        reviewNotes: 'Manually reviewed candidate.',
      }),
    ],
  });
  try {
    await writeDraft(dir, completeDraft({
      status: 'ready_for_manual_apply',
      warnings: ['Possible duplicate: inspect duelmen-existing.'],
      possibleDuplicateActivityIds: ['duelmen-existing'],
      missingFields: ['description'],
    }));

    const result = await createApplyPackets({ workspaceDir: dir, live: [] });
    assert.equal(result.generated.length, 1);
    assert.equal(result.skipped.length, 0);

    const markdown = await readFile(result.generated[0].path, 'utf8');
    assert.match(markdown, /# Manual Apply Packet: D/);
    assert.match(markdown, /## Activity Draft/);
    assert.match(markdown, /## Source Context/);
    assert.match(markdown, /Official family page/);
    assert.match(markdown, /## Candidate Context/);
    assert.match(markdown, /Manually reviewed candidate/);
    assert.match(markdown, /duelmen-existing/);
    assert.match(markdown, /description/);
    assert.match(markdown, /- \[ \] Source URL opens and is still current/);
    assert.match(markdown, /Packets only|not a live activity|does not write Supabase/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-ready draft is skipped by apply packet generation by default', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({ status: 'draft' }));
    const result = await createApplyPackets({ workspaceDir: dir, live: [] });
    assert.equal(result.generated.length, 0);
    assert.equal(result.skipped[0].reason, 'not ready_for_manual_apply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply packet generation can include one selected non-ready draft explicitly', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({ status: 'needs_manual_completion' }));
    const result = await createApplyPackets({
      workspaceDir: dir,
      draftId: 'draft:duelmen:duelmen-kids-course',
      includeNotReady: true,
      live: [],
    });
    assert.equal(result.generated.length, 1);
    assert.match(await readFile(result.generated[0].path, 'utf8'), /needs_manual_completion/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('existing apply packet is not overwritten by default', async () => {
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({ status: 'ready_for_manual_apply' }));
    const first = await createApplyPackets({ workspaceDir: dir, live: [] });
    await writeFile(first.generated[0].path, 'custom packet\n', 'utf8');
    const second = await createApplyPackets({ workspaceDir: dir, live: [] });

    assert.equal(second.generated.length, 0);
    assert.equal(second.skipped[0].reason, 'packet already exists');
    assert.equal(await readFile(first.generated[0].path, 'utf8'), 'custom packet\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply packet generation works with zero drafts', async () => {
  const { dir } = await makeWorkspace();
  try {
    const result = await createApplyPackets({ workspaceDir: dir, live: [] });
    assert.equal(result.generated.length, 0);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply packet generation does not modify live activity data or require Supabase', async () => {
  const before = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
  const { dir } = await makeWorkspace({ candidates: [candidate()] });
  try {
    await writeDraft(dir, completeDraft({ status: 'ready_for_manual_apply' }));
    await createApplyPackets({ workspaceDir: dir, live: [] });
    const after = await readFile(new URL('../assets/activities-data.mjs', import.meta.url), 'utf8');
    assert.equal(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('umlaut names produce stable draft slugs', async () => {
  const { dir } = await makeWorkspace({
    candidates: [
      candidate({ id: 'duelmen-malen', title: 'Dülmen Malen & Basteln' }),
    ],
  });
  try {
    const workspace = await loadExpansionWorkspace({ workspaceDir: dir });
    const market = workspace.markets[0];
    const draft = activityDraftFromCandidate({
      candidate: market.candidates[0],
      market,
      place: market.places[0],
      now: new Date('2026-07-01T12:00:00Z'),
      live: [],
    });
    assert.equal(draft.activityDraft.slug, 'dulmen-malen-basteln');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
