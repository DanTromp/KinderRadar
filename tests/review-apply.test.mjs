import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildFreshnessReport } from '../scripts/freshness-report.mjs';
import {
  applyVerificationReview,
  buildVerificationPatch,
  loadReviewItem,
  previewVerificationApply,
  renderApplyPreview,
  validateVerificationReviewItem,
} from '../scripts/review-apply.mjs';

function activity(overrides = {}) {
  return {
    slug: overrides.slug ?? 'sample-activity',
    name: overrides.name ?? 'Sample Activity',
    section: overrides.section ?? 'weekly-activities',
    category: overrides.category ?? 'Sports',
    ageRange: overrides.ageRange ?? '4-8',
    ageMin: overrides.ageMin ?? 4,
    ageMax: overrides.ageMax ?? 8,
    town: overrides.town ?? 'Haltern am See',
    timing: overrides.timing ?? 'Monday 16:00',
    cost: overrides.cost ?? 'Free',
    beginnerFriendly: overrides.beginnerFriendly ?? true,
    lastVerified: overrides.lastVerified ?? '2026-03-01',
    verifiedBy: overrides.verifiedBy ?? 'editor',
    status: overrides.status ?? 'active',
    contactUrl: overrides.contactUrl ?? 'https://example.test/contact',
    sourceUrl: overrides.sourceUrl ?? 'https://example.test/source',
    ...overrides,
  };
}

function reviewItem(overrides = {}) {
  return {
    id: overrides.id ?? 'verify-sample-activity-2026-07-01',
    type: 'activity_verification',
    status: overrides.status ?? 'approved_for_manual_apply',
    activityId: overrides.activityId ?? 'sample-activity',
    activityName: overrides.activityName ?? 'Sample Activity',
    previousLastVerified: overrides.previousLastVerified ?? '2026-03-01',
    proposedLastVerified: overrides.proposedLastVerified ?? '2026-07-01',
    verificationSource: overrides.verificationSource ?? 'https://example.test/source',
    verificationMethod: overrides.verificationMethod ?? 'source_check',
    verifiedBy: overrides.verifiedBy ?? 'editor',
    reviewerNotes: overrides.reviewerNotes ?? 'Checked manually.',
    ...overrides,
  };
}

async function makeDataFile(activities) {
  const dir = join(tmpdir(), `kr-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'activities-data.mjs');
  const output = [
    'export const sections = [{"id":"weekly-activities","label":"Weekly activities"}];',
    'export const categories = ["Sports"];',
    'export const cities = [{"slug":"haltern-am-see","name":"Haltern am See","heroImage":"hero.png","nearbyTowns":["Haltern am See"]}];',
    `export const activities = ${JSON.stringify(activities, null, 2)};`,
    '',
  ].join('\n');
  await writeFile(path, output, 'utf8');
  return { dir, path };
}

async function importActivities(path) {
  const url = pathToFileURL(path);
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return (await import(url.href)).activities;
}

test('verification review item validates required fields and approved status', () => {
  const activities = [activity()];
  const valid = validateVerificationReviewItem(reviewItem(), activities, {
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.equal(valid.ok, true);

  const unapproved = validateVerificationReviewItem(reviewItem({ status: 'needs_review' }), activities, {
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.equal(unapproved.ok, false);
  assert.ok(unapproved.errors.some((error) => /approved_for_manual_apply/.test(error)));
});

test('review item loader tolerates UTF-8 BOM files', async () => {
  const { dir } = await makeDataFile([]);
  const path = join(dir, 'review-item.json');
  try {
    await writeFile(path, `\uFEFF${JSON.stringify(reviewItem())}`, 'utf8');
    const item = await loadReviewItem(path, 'verify-sample-activity-2026-07-01');
    assert.equal(item.activityId, 'sample-activity');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verification review item rejects missing unknown and inactive activities', () => {
  const activities = [activity(), activity({ slug: 'closed', status: 'reported-closed' })];
  assert.ok(validateVerificationReviewItem(reviewItem({ activityId: '' }), activities).errors.some((error) => /activityId is required/));
  assert.ok(validateVerificationReviewItem(reviewItem({ activityId: 'missing' }), activities).errors.some((error) => /does not match/));
  assert.ok(validateVerificationReviewItem(reviewItem({ activityId: 'closed' }), activities).errors.some((error) => /not active/));
});

test('verification review item rejects future date stale baseline and missing source', () => {
  const activities = [activity()];
  const future = validateVerificationReviewItem(reviewItem({ proposedLastVerified: '2026-07-02' }), activities, {
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.ok(future.errors.some((error) => /future/.test(error)));

  const staleBaseline = validateVerificationReviewItem(reviewItem({ previousLastVerified: '2026-02-01' }), activities, {
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.ok(staleBaseline.errors.some((error) => /does not match current lastVerified/));

  const missingSource = validateVerificationReviewItem(reviewItem({ verificationSource: '', sourceUrl: '' }), activities, {
    now: new Date('2026-07-01T12:00:00Z'),
  });
  assert.ok(missingSource.errors.some((error) => /verificationSource/.test(error)));
});

test('dry-run previews verification metadata without writing data', async () => {
  const { dir, path } = await makeDataFile([activity(), activity({ slug: 'other-activity', name: 'Other Activity' })]);
  try {
    const beforeText = await readFile(path, 'utf8');
    const result = await applyVerificationReview({
      reviewItem: reviewItem({ verificationNotes: 'Public note.' }),
      dataPath: path,
      now: new Date('2026-07-01T12:00:00Z'),
    });

    assert.equal(result.written, false);
    assert.equal(await readFile(path, 'utf8'), beforeText);
    assert.deepEqual(result.diff.map((item) => item.field), [
      'lastVerified',
      'verifiedAt',
      'verificationSource',
      'verificationMethod',
      'verificationNotes',
    ]);
    assert.match(renderApplyPreview(result), /Sample Activity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('apply updates only the targeted activity verification fields', async () => {
  const originalOther = activity({ slug: 'other-activity', name: 'Other Activity', lastVerified: '2026-03-01' });
  const { dir, path } = await makeDataFile([activity(), originalOther]);
  try {
    const result = await applyVerificationReview({
      reviewItem: reviewItem({ verificationMethod: 'organizer_confirmation', verifiedBy: 'organizer' }),
      dataPath: path,
      apply: true,
      now: new Date('2026-07-01T12:00:00Z'),
    });

    assert.equal(result.written, true);
    const updated = await importActivities(path);
    const target = updated.find((item) => item.slug === 'sample-activity');
    const other = updated.find((item) => item.slug === 'other-activity');
    assert.equal(target.lastVerified, '2026-07-01');
    assert.equal(target.verifiedBy, 'organizer');
    assert.equal(target.verifiedAt, '2026-07-01');
    assert.equal(target.verificationSource, 'https://example.test/source');
    assert.equal(target.verificationMethod, 'organizer_confirmation');
    assert.deepEqual(other, originalOther);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('freshness report reflects the updated verification date after apply', async () => {
  const { dir, path } = await makeDataFile([activity()]);
  try {
    await applyVerificationReview({
      reviewItem: reviewItem(),
      dataPath: path,
      apply: true,
      now: new Date('2026-07-01T12:00:00Z'),
    });
    const updated = await importActivities(path);
    const report = buildFreshnessReport({
      activities: updated,
      now: new Date('2026-07-01T12:00:00Z'),
    });
    assert.equal(report.totals.verifiedWithin30Days, 1);
    assert.equal(report.statusCounts.fresh, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verification patch is limited to verification fields', () => {
  const patch = buildVerificationPatch({
    ...reviewItem(),
    name: 'Should Not Apply',
    town: 'Should Not Apply',
  });
  assert.deepEqual(Object.keys(patch), [
    'lastVerified',
    'verifiedBy',
    'verifiedAt',
    'verificationSource',
    'verificationMethod',
  ]);
});
