import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeUpdate,
  escapeHtml,
  renderAdminHtml,
  renderHtml,
  renderMarkdown,
  reviewItem,
  subjectForUpdate,
  suggestedAction,
  townForUpdate,
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

test('digest signups are labelled for review', () => {
  const digest = {
    ...update,
    evidence_url: null,
    payload: { type: 'digest_signup', cityName: 'Dülmen', citySlug: 'duelmen' },
  };
  assert.equal(subjectForUpdate(digest), 'Digest signup: Dülmen');
  assert.equal(townForUpdate(digest), 'Dülmen');
  assert.match(suggestedAction(digest), /digest audience/);
});

test('suggestedAction maps update types to editor actions', () => {
  assert.match(suggestedAction(update), /Verify source/);
  assert.match(suggestedAction({ update_type: 'closed' }), /Confirm closure/);
  assert.match(suggestedAction({ update_type: 'claim' }), /organizer identity/);
  assert.match(suggestedAction({ update_type: 'organizer_claim' }), /organizer profile fields/);
});

test('describeUpdate includes action, evidence, and notes', () => {
  const text = describeUpdate(update);
  assert.match(text, /\[submission\] Kids Tennis, Sythen/);
  assert.match(text, /evidence: https:\/\/example\.com\/source/);
  assert.match(text, /Looks suitable/);
  assert.match(text, /action:/);
});

test('reviewItem maps optional admin fields safely', () => {
  const item = reviewItem({
    ...update,
    payload: {
      ...update.payload,
      organizerName: 'Tennis Club',
      reporterName: 'A parent',
    },
  });
  assert.equal(item.type, 'submission');
  assert.equal(item.status, 'new');
  assert.equal(item.activityName, 'Kids Tennis');
  assert.equal(item.organizerName, 'Tennis Club');
  assert.equal(item.submitter, 'parent@example.com');
  assert.equal(item.message, 'Looks suitable for beginners.');
});

test('renderMarkdown includes status commands', () => {
  const markdown = renderMarkdown([update], { status: 'new' });
  assert.match(markdown, /# My Kids Radar Review Queue/);
  assert.match(markdown, /npm run supabase:update-status -- --id=123 --status=needs_review/);
  assert.match(markdown, /npm run supabase:update-status -- --id=123 --status=applied/);
});

test('renderHtml escapes user-provided content', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const html = renderHtml([{ ...update, payload: { activityName: '<b>Bad</b>' } }], { status: 'new' });
  assert.match(html, /&lt;b&gt;Bad&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Bad<\/b>/);
});

test('renderAdminHtml includes filters, commands, and no service-role key', () => {
  const html = renderAdminHtml([update], { status: 'all' });
  assert.match(html, /data-filter-status/);
  assert.match(html, /data-filter-type/);
  assert.match(html, /Kids Tennis/);
  assert.match(html, /npm run supabase:update-status -- --id=123 --status=applied/);
  assert.match(html, /Read-only by design/);
  assert.doesNotMatch(html, /SERVICE_ROLE/i);
});

test('admin review utilities display organizer claim submissions', () => {
  const claim = {
    id: 'claim-1',
    created_at: '2026-06-20T10:00:00Z',
    update_type: 'organizer_claim',
    status: 'new',
    activity_slug: null,
    evidence_url: 'https://tushaltern.de/kontakt',
    reporter_email: 'coach@example.com',
    payload: {
      organizerId: 'tus-haltern',
      organizerName: 'TuS Haltern',
      claimantName: 'Coach Example',
      claimantRole: 'Youth coach',
      message: 'Please verify this profile.',
    },
  };

  assert.equal(subjectForUpdate(claim), 'Organizer claim: TuS Haltern');
  const item = reviewItem(claim);
  assert.equal(item.type, 'organizer_claim');
  assert.equal(item.organizerId, 'tus-haltern');
  assert.equal(item.organizerName, 'TuS Haltern');
  assert.equal(item.submitter, 'coach@example.com');
  assert.equal(item.message, 'Please verify this profile.');

  const html = renderAdminHtml([claim], { status: 'all' });
  assert.match(html, /organizer_claim/);
  assert.match(html, /TuS Haltern/);
  assert.match(html, /coach@example.com/);
});

test('renderAdminHtml handles an empty queue', () => {
  const html = renderAdminHtml([], { status: 'all' });
  assert.match(html, /Nothing is waiting in this review queue/);
  assert.match(html, /<option value="all" selected>all<\/option>/);
});
