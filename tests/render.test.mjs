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
  renderListingHtml,
} from '../assets/render.mjs';

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
});
