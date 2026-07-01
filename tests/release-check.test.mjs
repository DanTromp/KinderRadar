import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReleaseSummary,
  detectReleaseRisks,
  renderReleaseSummary,
} from '../scripts/release-check.mjs';

const sections = [
  { id: 'weekly-activities', label: 'Weekly activities' },
];

const categories = ['Sports', 'Music'];

const cities = [
  {
    slug: 'haltern-am-see',
    name: 'Haltern am See',
    kind: 'region',
    heroImage: 'hero.png',
    nearbyTowns: ['Haltern am See'],
  },
];

function activity(overrides = {}) {
  return {
    slug: overrides.slug ?? 'activity',
    name: overrides.name ?? 'Activity',
    section: overrides.section ?? 'weekly-activities',
    category: overrides.category ?? 'Sports',
    ageRange: overrides.ageRange ?? '4-8',
    ageMin: overrides.ageMin ?? 4,
    ageMax: overrides.ageMax ?? 8,
    town: overrides.town ?? 'Haltern am See',
    timing: overrides.timing ?? 'Monday, 16:00',
    cost: overrides.cost ?? 'Free',
    beginnerFriendly: overrides.beginnerFriendly ?? true,
    lastVerified: overrides.lastVerified ?? '2026-06-01',
    status: overrides.status ?? 'active',
    dayOfWeek: overrides.dayOfWeek ?? 'Monday',
    startTime: overrides.startTime ?? '16:00',
    price: overrides.price ?? { free: true, unit: 'free', amount: 0 },
    organizer: overrides.organizer ?? { name: 'Club', slug: 'club' },
    ...overrides,
  };
}

async function makeDist() {
  const dir = join(tmpdir(), `kr-release-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'cities', 'haltern-am-see'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<html><head><link rel="canonical" href="https://example.test/"></head><body>Home</body></html>', 'utf8');
  await writeFile(join(dir, 'cities', 'haltern-am-see', 'index.html'), '<html><head><link rel="canonical" href="https://example.test/cities/haltern-am-see/"></head><body>City</body></html>', 'utf8');
  await writeFile(join(dir, 'sitemap.xml'), '<urlset><url><loc>https://example.test/</loc></url><url><loc>https://example.test/cities/haltern-am-see/</loc></url></urlset>', 'utf8');
  await writeFile(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n', 'utf8');
  return dir;
}

test('release summary counts data, dist output, freshness, and metadata', async () => {
  const distDir = await makeDist();
  try {
    const summary = await buildReleaseSummary({
      now: new Date('2026-07-01T12:00:00Z'),
      distDir,
      allActivities: [
        activity({ slug: 'fresh', lastVerified: '2026-06-20' }),
        activity({ slug: 'stale', lastVerified: '2026-03-01', startTime: '', dayOfWeek: '' }),
        activity({ slug: 'closed', status: 'reported-closed' }),
      ],
      allCategories: categories,
      allCities: cities,
      allSections: sections,
      includeGit: false,
    });

    assert.equal(summary.totals.activities, 3);
    assert.equal(summary.totals.activeActivities, 2);
    assert.equal(summary.totals.cityPages, 1);
    assert.equal(summary.dist.htmlPageCount, 2);
    assert.equal(summary.dist.sitemapUrlCount, 2);
    assert.equal(summary.dist.robotsHasSitemap, true);
    assert.equal(summary.verification.stale.over90, 1);
    assert.equal(summary.metadata.missingStartTime, 1);
    assert.equal(summary.metadata.missingDayOfWeek, 1);
    assert.match(renderReleaseSummary(summary), /Manual deploy note/);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test('release risks hard-fail broken generated output and warn on count drops', () => {
  const risks = detectReleaseRisks({
    totals: { activeActivities: 0, cityPages: 0 },
    dist: {
      htmlPageCount: 0,
      sitemapUrlCount: 0,
      robotsHasSitemap: false,
      canonicalPageCount: 0,
    },
    git: {
      diff: {
        activeActivities: -6,
        inactiveActivities: 6,
      },
    },
  });

  assert.ok(risks.hardFailures.some((risk) => /No active activities/.test(risk)));
  assert.ok(risks.hardFailures.some((risk) => /robots\.txt/.test(risk)));
  assert.ok(risks.warnings.some((warning) => /Active activity count changed by -6/.test(warning)));
  assert.ok(risks.warnings.some((warning) => /Inactive\/reported-closed activity count increased by 6/.test(warning)));
});
