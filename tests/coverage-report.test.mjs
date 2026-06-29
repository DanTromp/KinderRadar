import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoverageReport,
  coverageTier,
  renderCoverageReport,
} from '../scripts/coverage-report.mjs';

const sampleSections = [
  { id: 'weekly-activities', label: 'Weekly activities' },
  { id: 'school-holiday-activities', label: 'School holiday activities' },
];

const sampleCategories = ['Sports', 'Music', 'Nature'];

const sampleCities = [
  {
    slug: 'duelmen',
    name: 'Dülmen',
    kind: 'region',
    nearbyTowns: ['Dülmen', 'Buldern', 'Weakdorf'],
  },
  {
    slug: 'empty-town',
    name: 'Empty Town',
    kind: 'town',
    nearbyTowns: ['Empty Town'],
  },
];

function activity(overrides = {}) {
  return {
    slug: overrides.slug ?? 'activity',
    name: overrides.name ?? 'Sample Activity',
    town: overrides.town ?? 'Dülmen',
    category: overrides.category ?? 'Sports',
    section: overrides.section ?? 'weekly-activities',
    status: overrides.status ?? 'active',
    ageMin: overrides.ageMin ?? 4,
    ageMax: overrides.ageMax ?? 8,
    dayOfWeek: overrides.dayOfWeek ?? 'Monday',
    startTime: overrides.startTime ?? '16:00',
    lastVerified: overrides.lastVerified ?? '2026-06-20',
    price: overrides.price ?? { free: true, unit: 'free' },
    trial: overrides.trial ?? { available: true },
    organizer: overrides.organizer ?? { name: 'Sample Organizer', slug: 'sample-organizer' },
    ...overrides,
  };
}

function sampleActivities() {
  return [
    activity({ slug: 'duelmen-sports', name: 'Dülmen Sports' }),
    activity({ slug: 'duelmen-music', name: 'Dülmen Music', category: 'Music', status: 'needs-update' }),
    activity({
      slug: 'buldern-nature',
      name: 'Buldern Nature',
      town: 'Buldern',
      category: 'Nature',
      startTime: '',
      organizer: { name: 'Nature Team', slug: 'nature-team' },
    }),
    activity({ slug: 'closed-sports', name: 'Closed Sports', status: 'reported-closed' }),
    ...Array.from({ length: 6 }, (_, index) => activity({
      slug: `weakdorf-sports-${index + 1}`,
      name: `Weakdorf Sports ${index + 1}`,
      town: 'Weakdorf',
      organizer: { name: 'Weakdorf Club', slug: 'weakdorf-club' },
    })),
  ];
}

test('coverage report counts active activities and separates inactive records', () => {
  const report = buildCoverageReport({
    activities: sampleActivities(),
    categories: sampleCategories,
    cities: sampleCities,
    sections: sampleSections,
    now: new Date('2026-06-29T12:00:00Z'),
  });

  assert.equal(report.totals.activities, 10);
  assert.equal(report.totals.activeActivities, 9);
  assert.equal(report.totals.inactiveActivities, 1);
  assert.equal(report.townCoverage.find((town) => town.town === 'Dülmen').activeListings, 2);
});

test('coverage report flags critical and weak towns', () => {
  const report = buildCoverageReport({
    activities: sampleActivities(),
    categories: sampleCategories,
    cities: sampleCities,
    sections: sampleSections,
    now: new Date('2026-06-29T12:00:00Z'),
  });

  assert.equal(coverageTier(4), 'critical');
  assert.equal(coverageTier(6), 'weak');
  assert.equal(coverageTier(10), 'acceptable');
  assert.equal(report.townCoverage.find((town) => town.town === 'Buldern').tier, 'critical');
  assert.equal(report.townCoverage.find((town) => town.town === 'Weakdorf').tier, 'weak');
  assert.equal(report.townCoverage.find((town) => town.town === 'Empty Town').activeListings, 0);
});

test('coverage report calculates category counts and metadata gaps', () => {
  const report = buildCoverageReport({
    activities: sampleActivities(),
    categories: sampleCategories,
    cities: sampleCities,
    sections: sampleSections,
    now: new Date('2026-06-29T12:00:00Z'),
  });

  assert.deepEqual(
    report.categoryCoverage.map((item) => [item.category, item.activeListings]),
    [['Sports', 7], ['Music', 1], ['Nature', 1]],
  );
  assert.equal(report.metadataGaps.missingStartTime, 1);
  assert.equal(report.metadataGaps.missingAccessibility, 9);
});

test('coverage report keeps town names with umlauts addressable', () => {
  const report = buildCoverageReport({
    activities: sampleActivities(),
    categories: sampleCategories,
    cities: sampleCities,
    sections: sampleSections,
    now: new Date('2026-06-29T12:00:00Z'),
  });

  const duelmen = report.townCoverage.find((town) => town.town === 'Dülmen');
  assert.equal(duelmen.slug, 'dulmen');
  assert.match(renderCoverageReport(report), /Dülmen/);
});
