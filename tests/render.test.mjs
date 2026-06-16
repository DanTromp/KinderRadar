import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  daysSince,
  freshnessBadge,
  verifierLabel,
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
  assert.equal(verifierLabel('organizer'), 'Organizer submitted');
  assert.equal(verifierLabel('parent'), 'Parent confirmed');
  assert.equal(verifierLabel('editor'), 'Editor curated');
  assert.equal(verifierLabel('alien'), null);
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
