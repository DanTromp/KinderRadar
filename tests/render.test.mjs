import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  daysSince,
  freshnessBadge,
  freshnessCoverage,
  verifierLabel,
  sourceSignal,
  confidenceSignal,
  escapeHtml,
  normalizedAccessibility,
  normalizedLocation,
  renderListingHtml,
} from '../assets/render.mjs';
import { activityDetailPage, organizerProfilePage } from '../scripts/build.mjs';

test('slugify produces kebab-case', () => {
  assert.equal(slugify('Rookie Swim Start'), 'rookie-swim-start');
  assert.equal(slugify('Arts & Crafts'), 'arts-crafts');
  assert.equal(slugify('Café Müller'), 'cafe-muller');
});

test('escapeHtml escapes dangerous characters', () => {
  assert.equal(
    escapeHtml('<script>alert("x" & \'y\')</script>'),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
  );
});

test('daysSince computes whole-day differences', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(daysSince('2026-06-15', now), 0);
  assert.equal(daysSince('2026-06-10', now), 5);
  assert.equal(daysSince('not-a-date', now), null);
});

test('freshnessBadge classifies by age and status', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(freshnessBadge({ lastVerified: '2026-06-10' }, now).tone, 'fresh');
  assert.equal(freshnessBadge({ lastVerified: '2026-05-01' }, now).tone, 'neutral');
  assert.equal(freshnessBadge({ lastVerified: '2025-01-01' }, now).tone, 'stale');
  assert.equal(freshnessBadge({ lastVerified: '2026-06-10', status: 'reported-closed' }, now).tone, 'closed');
  assert.equal(freshnessBadge({}, now).tone, 'stale');
});

test('verifierLabel maps known values, returns null otherwise', () => {
  assert.deepEqual(verifierLabel('organizer'), { label: 'Organizer submitted', i18nKey: 'enum.verifier.organizer' });
  assert.deepEqual(verifierLabel('parent'), { label: 'Parent confirmed', i18nKey: 'enum.verifier.parent' });
  assert.deepEqual(verifierLabel('editor'), { label: 'Editor curated', i18nKey: 'enum.verifier.editor' });
  assert.equal(verifierLabel('alien'), null);
});

test('freshnessBadge exposes i18n key and params for translation', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(freshnessBadge({ lastVerified: '2026-06-14' }, now).i18nKey, 'freshness.fresh.one');
  assert.deepEqual(freshnessBadge({ lastVerified: '2026-06-10' }, now).i18nParams, { days: 5 });
  assert.equal(freshnessBadge({ lastVerified: '2025-01-01' }, now).i18nKey, 'freshness.stale');
  assert.equal(freshnessBadge({ status: 'reported-closed' }, now).i18nKey, 'freshness.closed');
  assert.equal(freshnessBadge({}, now).i18nKey, 'freshness.unknown');
});

test('freshnessCoverage summarizes active listings by 30/90-day windows', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const stats = freshnessCoverage([
    { lastVerified: '2026-06-14', status: 'active' },
    { lastVerified: '2026-05-20', status: 'active' },
    { lastVerified: '2025-01-01', status: 'active' },
    { lastVerified: '2026-06-01', status: 'reported-closed' },
  ], now);
  assert.deepEqual(stats, {
    total: 3,
    fresh30: 2,
    checked90: 2,
    stale: 1,
    fresh30Pct: 67,
    checked90Pct: 67,
  });
});

test('sourceSignal and confidenceSignal summarize trust cues', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.deepEqual(sourceSignal({ sourceUrl: 'https://example.com' }), {
    tone: 'linked',
    label: 'Public source linked',
    i18nKey: 'trust.source.linked',
  });
  assert.equal(confidenceSignal({
    sourceUrl: 'https://example.com',
    lastVerified: '2026-06-10',
    verifiedBy: 'organizer',
  }, now).tone, 'strong');
  assert.equal(confidenceSignal({
    sourceUrl: '',
    lastVerified: '2026-06-10',
    verifiedBy: 'editor',
  }, now).tone, 'caution');
});

test('metadata helpers normalize optional accessibility and location data', () => {
  assert.equal(normalizedAccessibility({}), null);
  assert.deepEqual(normalizedAccessibility({
    accessibility: {
      strollerFriendly: true,
      parkingNearby: false,
      notes: 'Step-free side entrance',
    },
  }), {
    fields: [{ label: 'Stroller friendly', i18nKey: 'accessibility.strollerFriendly' }],
    notes: 'Step-free side entrance',
  });
  assert.deepEqual(normalizedLocation({
    address: 'Lake Road 1',
    geo: { lat: 51.75, lng: 7.18, accuracy: 'venue' },
  }), {
    address: 'Lake Road 1',
    latitude: 51.75,
    longitude: 7.18,
    locationAccuracy: 'venue',
  });
});

const sampleListing = {
  slug: 'demo',
  name: 'Demo Activity',
  section: 'weekly-activities',
  category: 'Sports',
  ageRange: '4-6',
  ageMin: 4,
  ageMax: 6,
  town: 'Haltern am See',
  timing: 'Tuesday 16:00',
  cost: 'Free',
  beginnerFriendly: true,
  lastVerified: '2026-06-10',
  status: 'active',
  setting: 'outdoor',
  language: 'de',
  dayOfWeek: 'Tuesday',
  startTime: '16:00',
  trial: { available: true, notes: 'Two trials' },
  price: { free: true, unit: 'free' },
};

const sections = [
  { id: 'weekly-activities', label: 'Weekly', tag: 'Weekly', intro: '' },
];

test('renderListingHtml preserves data-* attributes the filter pipeline reads', () => {
  const html = renderListingHtml(sampleListing, { sections, repoSlug: 'o/r' });
  assert.match(html, /data-slug="demo"/);
  assert.match(html, /data-age-min="4"/);
  assert.match(html, /data-age-max="6"/);
  assert.match(html, /data-town="Haltern am See"/);
  assert.match(html, /data-category="Sports"/);
  assert.match(html, /data-beginner-friendly="true"/);
  assert.match(html, /data-day-of-week="Tuesday"/);
  assert.match(html, /data-start-time="16:00"/);
  assert.match(html, /data-setting="outdoor"/);
  assert.match(html, /data-price-free="true"/);
  assert.match(html, /data-trial-available="true"/);
  assert.match(html, /data-status="active"/);
});

test('renderListingHtml includes a freshness badge and a detail-page link', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const html = renderListingHtml({ ...sampleListing, lastVerified: now.toISOString().slice(0, 10) }, { sections });
  assert.match(html, /class="freshness/);
  assert.match(html, /href="\/activities\/demo\/"/);
  assert.match(html, /trust-pill/);
});

test('renderListingHtml supports relative activity links for project-page hosting', () => {
  const html = renderListingHtml(sampleListing, {
    sections,
    activityHrefPrefix: '../../activities',
  });
  assert.match(html, /href="\.\.\/\.\.\/activities\/demo\/"/);
});

test('renderListingHtml renders a closed banner when status is reported-closed', () => {
  const html = renderListingHtml({ ...sampleListing, status: 'reported-closed' }, { sections });
  assert.match(html, /reported closed/i);
  assert.match(html, /freshness-closed/);
});

test('renderListingHtml escapes user-supplied strings', () => {
  const html = renderListingHtml({
    ...sampleListing,
    name: '<img src=x onerror=alert(1)>',
    town: '"><script>',
  }, { sections });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('"><script>'));
  assert.match(html, /&lt;img/);
});

test('renderListingHtml emits data-i18n attributes for translation', () => {
  const html = renderListingHtml(sampleListing, { sections, repoSlug: 'o/r' });
  // Field labels carry i18n keys.
  assert.match(html, /data-i18n="field\.when"/);
  assert.match(html, /data-i18n="field\.cost"/);
  // Enum values carry i18n keys.
  assert.match(html, /data-i18n="enum\.category\.Sports"/);
  // Freshness badge carries an i18n key + params.
  assert.match(html, /data-i18n="freshness\./);
  // Section tag and listing.suggestUpdate too.
  assert.match(html, /data-i18n="section\.weekly-activities\.tag"/);
  assert.match(html, /data-i18n="listing\.viewDetails"/);
  assert.match(html, /data-i18n="listing\.suggestUpdate"/);
  assert.match(html, /data-export-calendar="demo"/);
  assert.match(html, /data-i18n="activity\.calendar\.export"/);
});

test('activity detail page hides empty accessibility/location sections', () => {
  const html = activityDetailPage(sampleListing);
  assert.doesNotMatch(html, /accessibility-heading/);
  assert.doesNotMatch(html, /location-heading/);
});

test('activity detail page renders accessibility and location when present', () => {
  const html = activityDetailPage({
    ...sampleListing,
    accessibility: {
      wheelchairAccessible: true,
      strollerFriendly: true,
      notes: 'Use the side entrance.',
    },
    address: 'Lake Road 1',
    geo: { lat: 51.75, lng: 7.18, accuracy: 'venue' },
  });
  assert.match(html, /accessibility-heading/);
  assert.match(html, /data-i18n="accessibility\.wheelchairAccessible"/);
  assert.match(html, /Use the side entrance\./);
  assert.match(html, /location-heading/);
  assert.match(html, /Lake Road 1/);
  assert.match(html, /51\.75, 7\.18/);
});

test('organizer profile omits empty optional metadata and renders claim form', () => {
  const html = organizerProfilePage({
    slug: 'sample-organizer',
    name: 'Sample Organizer',
    host: '',
    websiteUrl: '',
    contactMethod: '',
    activitySlugs: [],
    towns: [],
    categories: [],
    claimed: false,
    sponsorship: null,
    activityCount: 0,
  });

  assert.match(html, /data-update-type="organizer_claim"/);
  assert.match(html, /data-organizer-id="sample-organizer"/);
  assert.doesNotMatch(html, /Not specified/);
  assert.doesNotMatch(html, /listing\.contact\.notListed/);
});

test('organizer profile renders optional metadata when present', () => {
  const html = organizerProfilePage({
    slug: 'sample-organizer',
    name: 'Sample Organizer',
    host: 'example.org',
    websiteUrl: 'https://example.org/',
    contactEmail: 'info@example.org',
    phone: '+49 123',
    address: 'Market 1',
    logoUrl: 'https://example.org/logo.png',
    description: 'Local youth club.',
    verificationStatus: 'verified',
    contactMethod: 'email',
    activitySlugs: [],
    towns: ['Dülmen'],
    categories: ['Sports'],
    claimed: true,
    sponsorship: null,
    activityCount: 0,
  });

  assert.match(html, /https:\/\/example\.org\//);
  assert.match(html, /info@example\.org/);
  assert.match(html, /\+49 123/);
  assert.match(html, /Market 1/);
  assert.match(html, /Local youth club\./);
  assert.match(html, /data-i18n="organizer\.profile\.verification"/);
  assert.match(html, /Claimed/);
});
