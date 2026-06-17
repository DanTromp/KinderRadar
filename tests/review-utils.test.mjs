import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeUpdate,
  escapeHtml,
  renderHtml,
  renderMarkdown,
  subjectForUpdate,
  suggestedAction,
} from '../scripts/review-utils.mjs';

const update = {
  id: '123',
  created_at: '2026-06-17T12:00:00Z',
  update_type: 'submission',
  status: 'new',
  activity_slug: null,
  evidence_url: 'https://example.com/source',
  reporter_email: 'parent@example.com',
  payload: {
    activityName: 'Kids Tennis',
    town: 'Sythen',
    notes: 'Looks suitable for beginners.',
  },
};

test('subjectForUpdate falls back to payload activity name', () => {
  assert.equal(subjectForUpdate(update), 'Kids Tennis');
});

test('suggestedAction maps update types to editor actions', () => {
  assert.match(suggestedAction(update), /Verify source/);
  assert.match(suggestedAction({ update_type: 'closed' }), /Confirm closure/);
  assert.match(suggestedAction({ update_type: 'claim' }), /organizer identity/);
});

test('describeUpdate includes action, evidence, and notes', () => {
  const text = describeUpdate(update);
  assert.match(text, /\[submission\] Kids Tennis, Sythen/);
  assert.match(text, /evidence: https:\/\/example\.com\/source/);
  assert.match(text, /Looks suitable/);
  assert.match(text, /action:/);
});

test('renderMarkdown includes status commands', () => {
  const markdown = renderMarkdown([update], { status: 'new' });
  assert.match(markdown, /# KinderRadar Review Queue/);
  assert.match(markdown, /npm run supabase:update-status -- --id=123 --status=needs_review/);
  assert.match(markdown, /npm run supabase:update-status -- --id=123 --status=applied/);
});

test('renderHtml escapes user-provided content', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const html = renderHtml([{ ...update, payload: { activityName: '<b>Bad</b>' } }], { status: 'new' });
  assert.match(html, /&lt;b&gt;Bad&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Bad<\/b>/);
});
