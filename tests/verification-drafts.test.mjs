import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVerificationDraftReport,
  renderVerificationDraftReport,
} from '../scripts/verification-drafts.mjs';

function activity(overrides = {}) {
  return {
    slug: overrides.slug ?? 'sample',
    name: overrides.name ?? 'Sample Activity',
    town: overrides.town ?? 'Dülmen',
    category: overrides.category ?? 'Sports',
    section: overrides.section ?? 'weekly-activities',
    status: overrides.status ?? 'active',
    timing: overrides.timing ?? 'Monday, 16:00',
    dayOfWeek: overrides.dayOfWeek ?? 'Monday',
    startTime: overrides.startTime ?? '16:00',
    address: overrides.address ?? 'Market 1',
    lastVerified: overrides.lastVerified ?? '2026-03-01',
    contactUrl: overrides.contactUrl ?? 'https://example.test/contact',
    sourceUrl: overrides.sourceUrl ?? 'https://example.test/source',
    organizer: overrides.organizer ?? { name: 'Sample Club', slug: 'sample-club' },
    ...overrides,
  };
}

test('stale and soon-stale activities produce organizer draft candidates', () => {
  const report = buildVerificationDraftReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({ slug: 'stale', name: 'Stale Swim', lastVerified: '2026-03-01' }),
      activity({ slug: 'soon', name: 'Soon Tennis', lastVerified: '2026-04-10' }),
      activity({ slug: 'fresh', name: 'Fresh Music', lastVerified: '2026-06-20' }),
    ],
  });

  assert.equal(report.totals.activitiesNeedingVerification, 2);
  assert.equal(report.totals.drafts, 1);
  assert.deepEqual(report.drafts[0].activityIds.sort(), ['soon', 'stale']);
  assert.doesNotMatch(report.drafts[0].bodyDe, /Fresh Music/);
});

test('activities are grouped by organizer and draft text includes review details', () => {
  const report = buildVerificationDraftReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({
        slug: 'one',
        name: 'Dülmen Schwimmen',
        lastVerified: '2026-03-01',
        organizer: { name: 'Shared Club', slug: 'shared-club', contactEmail: 'info@example.test' },
      }),
      activity({
        slug: 'two',
        name: 'Dülmen Turnen',
        lastVerified: '2026-04-10',
        organizer: { name: 'Shared Club', slug: 'shared-club', contactEmail: 'info@example.test' },
      }),
    ],
  });

  assert.equal(report.totals.withEmail, 1);
  assert.equal(report.drafts[0].organizerId, 'shared-club');
  assert.equal(report.drafts[0].contactEmail, 'info@example.test');
  assert.match(report.drafts[0].bodyDe, /Dülmen Schwimmen/);
  assert.match(report.drafts[0].bodyDe, /2026-03-01/);
  assert.match(report.drafts[0].bodyDe, /MeinKinderRadar/);
});

test('organizers without email are reported separately by contact availability', () => {
  const report = buildVerificationDraftReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({
        slug: 'web',
        name: 'Website Only',
        lastVerified: '2026-03-01',
        contactUrl: 'https://club.example.test',
        sourceUrl: 'https://club.example.test',
        organizer: { name: 'Website Club', slug: 'website-club' },
      }),
      activity({
        slug: 'none',
        name: 'No Contact',
        lastVerified: '2026-03-01',
        contactUrl: '',
        sourceUrl: '',
        organizer: { name: 'No Contact Club', slug: 'no-contact-club' },
      }),
    ],
  });

  assert.equal(report.totals.websiteOnly, 1);
  assert.equal(report.totals.noContact, 1);
  assert.equal(report.groups.websiteOnly[0].organizerName, 'Website Club');
  assert.equal(report.groups.noContact[0].organizerName, 'No Contact Club');
});

test('missing organizer metadata and missing schedule do not crash draft generation', () => {
  const report = buildVerificationDraftReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities: [
      activity({
        slug: 'fallback',
        name: 'Fallback Activity',
        timing: '',
        dayOfWeek: '',
        startTime: '',
        address: '',
        lastVerified: '',
        organizer: undefined,
        contactUrl: '',
        sourceUrl: '',
      }),
      activity({ slug: 'closed', status: 'reported-closed', lastVerified: '2025-01-01' }),
    ],
  });

  assert.equal(report.totals.activitiesNeedingVerification, 1);
  assert.equal(report.drafts[0].sendStatus, 'draft_only');
  assert.match(report.drafts[0].bodyDe, /Zeit noch nicht sicher/);
  assert.match(renderVerificationDraftReport(report), /Drafts only/);
});

test('draft generation does not mutate input activities', () => {
  const activities = [
    activity({ slug: 'stale', lastVerified: '2026-03-01' }),
  ];
  const before = JSON.stringify(activities);
  buildVerificationDraftReport({
    now: new Date('2026-07-01T12:00:00Z'),
    activities,
  });
  assert.equal(JSON.stringify(activities), before);
});
