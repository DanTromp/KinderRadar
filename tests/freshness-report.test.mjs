import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFreshnessReport,
  renderFreshnessReport,
} from '../scripts/freshness-report.mjs';

function activity(overrides = {}) {
  return {
    slug: overrides.slug ?? 'sample',
    name: overrides.name ?? 'Sample Activity',
    town: overrides.town ?? 'Dülmen',
    category: overrides.category ?? 'Sports',
    section: overrides.section ?? 'weekly-activities',
    status: overrides.status ?? 'active',
    lastVerified: overrides.lastVerified ?? '2026-06-20',
    sourceUrl: overrides.sourceUrl ?? 'https://example.test/activity',
    organizer: overrides.organizer ?? { name: 'Sample Club', slug: 'sample-club' },
    ...overrides,
  };
}

test('freshness report counts active listings and excludes inactive records from freshness windows', () => {
  const report = buildFreshnessReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({ slug: 'fresh', lastVerified: '2026-06-20' }),
      activity({ slug: 'soon', lastVerified: '2026-04-10' }),
      activity({ slug: 'stale', lastVerified: '2026-03-01' }),
      activity({ slug: 'missing', lastVerified: '' }),
      activity({ slug: 'closed', status: 'reported-closed', lastVerified: '2025-01-01' }),
    ],
  });

  assert.equal(report.totals.activities, 5);
  assert.equal(report.totals.activeActivities, 4);
  assert.equal(report.totals.inactiveActivities, 1);
  assert.equal(report.totals.verifiedWithin30Days, 1);
  assert.equal(report.totals.verifiedWithin90Days, 2);
  assert.equal(report.totals.staleSoon, 1);
  assert.equal(report.totals.olderThan90Days, 1);
  assert.equal(report.totals.missingOrInvalidLastVerified, 1);
  assert.equal(report.candidates.filter((candidate) => candidate.type === 'verify_activity_freshness').length, 3);
});

test('freshness report flags future verification dates without treating them as fresh', () => {
  const report = buildFreshnessReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({ slug: 'future', lastVerified: '2026-07-10' }),
    ],
  });

  assert.equal(report.statusCounts.missing_verification, 1);
  assert.equal(report.totals.futureLastVerified, 1);
  assert.equal(report.totals.verifiedWithin30Days, 0);
  assert.match(report.candidates[0].reason, /future/);
});

test('freshness report groups stale and soon-stale listings by town organizer category and section', () => {
  const report = buildFreshnessReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({ slug: 'duelmen-soon', name: 'Dülmen Soon', lastVerified: '2026-04-10' }),
      activity({
        slug: 'buldern-stale',
        name: 'Buldern Stale',
        town: 'Buldern',
        category: 'Music',
        section: 'holiday-camps',
        lastVerified: '2026-03-01',
        organizer: { name: 'Music Team', slug: 'music-team' },
      }),
    ],
  });

  assert.deepEqual(report.groups.staleOrSoonByTown.map((row) => [row.name, row.count]), [['Buldern', 1], ['Dülmen', 1]]);
  assert.ok(report.groups.staleOrSoonByOrganizer.some((row) => row.name === 'Sample Club'));
  assert.ok(report.groups.staleOrSoonByCategory.some((row) => row.name === 'Music'));
  assert.ok(report.groups.staleOrSoonBySection.some((row) => row.name === 'holiday-camps'));
  assert.match(renderFreshnessReport(report), /Dülmen/);
});

test('freshness report creates deterministic organizer candidates without duplicates', () => {
  const report = buildFreshnessReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({ slug: 'one', lastVerified: '2026-03-01', organizer: { name: 'Shared Club', slug: 'shared-club' } }),
      activity({ slug: 'two', lastVerified: '2026-04-10', organizer: { name: 'Shared Club', slug: 'shared-club' } }),
    ],
  });

  const organizerCandidates = report.candidates.filter((candidate) => candidate.type === 'verify_organizer_freshness');
  assert.equal(organizerCandidates.length, 1);
  assert.equal(new Set(report.candidates.map((candidate) => candidate.id)).size, report.candidates.length);
  assert.equal(report.reminderDrafts.length, 0);
});
