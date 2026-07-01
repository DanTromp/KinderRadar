import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceMonitorReport,
  hashContent,
  renderSourceMonitorMarkdown,
  renderSourceMonitorReport,
  validateSourceRegistry,
} from '../scripts/source-monitor.mjs';

function source(overrides = {}) {
  return {
    id: overrides.id ?? 'duelmen-vhs',
    town: overrides.town ?? 'Dülmen',
    sourceType: overrides.sourceType ?? 'course_provider',
    organizerName: overrides.organizerName ?? 'VHS Dülmen',
    url: overrides.url ?? 'https://example.com/vhs',
    trustLevel: overrides.trustLevel ?? 'organizer',
    crawlFrequency: overrides.crawlFrequency ?? 'monthly',
    active: overrides.active ?? true,
    notes: overrides.notes ?? 'Trusted source for course changes.',
  };
}

function responseFetch(bodyByUrl) {
  return async (url) => {
    if (bodyByUrl[url] instanceof Error) throw bodyByUrl[url];
    const item = bodyByUrl[url] ?? { body: 'ok', status: 200 };
    return new Response(item.body ?? 'ok', {
      status: item.status ?? 200,
      statusText: item.statusText ?? '',
      headers: item.headers ?? {},
    });
  };
}

test('source registry validation detects duplicate ids and urls', () => {
  const result = validateSourceRegistry([
    source({ id: 'same', url: 'https://example.com/a' }),
    source({ id: 'same', url: 'https://example.com/b' }),
    source({ id: 'other', url: 'https://example.com/a/' }),
    source({ id: 'bad-url', url: 'not-a-url' }),
  ]);

  assert.match(result.errors.join('\n'), /Duplicate source id "same"/);
  assert.match(result.errors.join('\n'), /Duplicate source url "https:\/\/example.com\/a\/"/);
  assert.match(result.errors.join('\n'), /invalid url "not-a-url"/);
});

test('inactive sources are skipped without fetching', async () => {
  let fetches = 0;
  const registry = [
    source({ id: 'active', url: 'https://example.com/active' }),
    source({ id: 'inactive', url: 'https://example.com/inactive', active: false }),
  ];

  const report = await buildSourceMonitorReport({
    registry,
    snapshot: { exists: false, sources: [] },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: async () => {
      fetches += 1;
      return new Response('active');
    },
  });

  assert.equal(fetches, 1);
  assert.equal(report.totals.activeSources, 1);
  assert.deepEqual(report.skippedInactive.map((item) => item.sourceId), ['inactive']);
});

test('changed source hash creates a stable review candidate', async () => {
  const registry = [source({ id: 'duelmen-vhs', url: 'https://example.com/vhs' })];
  const report = await buildSourceMonitorReport({
    registry,
    snapshot: {
      exists: true,
      sources: [{
        sourceId: 'duelmen-vhs',
        url: 'https://example.com/vhs',
        result: 'reachable',
        httpStatus: 200,
        hash: hashContent('old page'),
      }],
    },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: responseFetch({
      'https://example.com/vhs': { body: 'new page', status: 200 },
    }),
  });

  assert.equal(report.checks[0].state, 'changed');
  assert.equal(report.candidates.length, 1);
  assert.deepEqual(Object.keys(report.candidates[0]), [
    'id',
    'sourceId',
    'sourceUrl',
    'town',
    'organizerName',
    'candidateType',
    'detectedChangeType',
    'confidence',
    'reason',
    'detectedAt',
    'checkedAt',
    'status',
    'reviewStatus',
    'rawSnapshotRef',
  ]);
  assert.equal(report.candidates[0].candidateType, 'source_change');
  assert.equal(report.candidates[0].detectedChangeType, 'content_changed');
  assert.equal(report.candidates[0].status, 'needs_review');
  assert.equal(report.candidates[0].reviewStatus, 'needs_review');
  assert.match(report.candidates[0].rawSnapshotRef, /^sha256:/);
});

test('unchanged source hash does not create a review candidate', async () => {
  const body = 'same page';
  const registry = [source({ id: 'haltern-dlrg', town: 'Haltern am See', url: 'https://example.com/dlrg' })];
  const report = await buildSourceMonitorReport({
    registry,
    snapshot: {
      exists: true,
      sources: [{
        sourceId: 'haltern-dlrg',
        url: 'https://example.com/dlrg',
        result: 'reachable',
        httpStatus: 200,
        hash: hashContent(body),
      }],
    },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: responseFetch({
      'https://example.com/dlrg': { body, status: 200 },
    }),
  });

  assert.equal(report.checks[0].state, 'unchanged');
  assert.equal(report.candidates.length, 0);
});

test('unreachable source is reported without crashing', async () => {
  const registry = [source({ id: 'dorsten-ferienprogramm', town: 'Dorsten', url: 'https://example.com/down' })];
  const report = await buildSourceMonitorReport({
    registry,
    snapshot: {
      exists: true,
      sources: [{
        sourceId: 'dorsten-ferienprogramm',
        url: 'https://example.com/down',
        result: 'reachable',
        httpStatus: 200,
        hash: hashContent('old'),
      }],
    },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: responseFetch({
      'https://example.com/down': new Error('network down'),
    }),
  });

  assert.equal(report.totals.unreachableSources, 1);
  assert.equal(report.checks[0].result, 'unreachable');
  assert.equal(report.candidates[0].detectedChangeType, 'availability_changed');
  assert.match(renderSourceMonitorReport(report), /dorsten-ferienprogramm/);
});

test('first run establishes a baseline and preserves umlaut town names', async () => {
  const registry = [source({ town: 'Dülmen', url: 'https://example.com/duelmen' })];
  const report = await buildSourceMonitorReport({
    registry,
    snapshot: { exists: false, sources: [] },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: responseFetch({
      'https://example.com/duelmen': { body: 'baseline', status: 200 },
    }),
  });

  assert.equal(report.checks[0].state, 'baseline');
  assert.equal(report.candidates.length, 0);
  assert.match(renderSourceMonitorReport(report), /Dülmen/);
  assert.match(renderSourceMonitorReport(report), /establishes the baseline/);
});

test('markdown report includes stable summary and review-only notice', async () => {
  const registry = [source({ id: 'changed', town: 'Haltern am See', url: 'https://example.com/changed' })];
  const report = await buildSourceMonitorReport({
    registry,
    snapshot: {
      exists: true,
      sources: [{
        sourceId: 'changed',
        url: 'https://example.com/changed',
        result: 'reachable',
        httpStatus: 200,
        hash: hashContent('old'),
      }],
    },
    now: new Date('2026-07-01T10:00:00Z'),
    fetchImpl: responseFetch({
      'https://example.com/changed': { body: 'new', status: 200 },
    }),
  });

  const markdown = renderSourceMonitorMarkdown(report);
  assert.match(markdown, /# KinderRadar Source Monitor Report/);
  assert.match(markdown, /Sources checked: 1\/1/);
  assert.match(markdown, /\| changed \| Haltern am See \| content_changed \| medium \|/);
  assert.match(markdown, /does not publish activities, update Supabase, or modify live activity data/);
});
