import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annotateDuplicateReviewItems,
  detectLikelyDuplicates,
  describeUpdate,
  escapeHtml,
  freshnessCandidateItem,
  normalizeFreshnessCandidates,
  normalizeSourceCandidates,
  normalizeVerificationReviewItems,
  normalizeReviewStatus,
  renderAdminHtml,
  renderHtml,
  renderMarkdown,
  reviewItem,
  reviewerNotes,
  sourceCandidateItem,
  subjectForUpdate,
  suggestedAction,
  townForUpdate,
  verificationReviewItem,
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
  assert.equal(item.status, 'needs_review');
  assert.equal(item.rawStatus, 'new');
  assert.equal(item.activityName, 'Kids Tennis');
  assert.equal(item.organizerName, 'Tennis Club');
  assert.equal(item.submitter, 'parent@example.com');
  assert.equal(item.message, 'Looks suitable for beginners.');
});

test('review status mapping handles legacy and unknown statuses safely', () => {
  assert.equal(normalizeReviewStatus('new'), 'needs_review');
  assert.equal(normalizeReviewStatus('accepted'), 'approved_for_manual_apply');
  assert.equal(normalizeReviewStatus('applied'), 'handled');
  assert.equal(normalizeReviewStatus('mystery'), 'needs_review');
});

test('reviewer notes are trimmed and length-limited', () => {
  assert.equal(reviewerNotes('  check city page  '), 'check city page');
  const note = reviewerNotes(` ${'x'.repeat(520)} `, 20);
  assert.equal(note.length, 20);
  assert.match(note, /\.\.\.$/);
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
  assert.match(html, /data-filter-source/);
  assert.match(html, /data-filter-area/);
  assert.match(html, /<option value="in_review">in_review<\/option>/);
  assert.match(html, /Kids Tennis/);
  assert.match(html, /needs_review \(raw: new\)/);
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

test('source candidate shape is normalized for admin review', () => {
  const item = sourceCandidateItem({
    id: 'source:haltern-dlrg:source_change:abc',
    sourceId: 'haltern-dlrg',
    sourceUrl: 'https://haltern.dlrg.de/',
    town: 'Haltern am See',
    organizerName: 'DLRG Haltern am See',
    candidateType: 'source_change',
    confidence: 'medium',
    reason: 'Page content hash changed since the previous snapshot.',
    detectedAt: '2026-07-01T10:00:00Z',
    status: 'needs_review',
    rawSnapshotRef: 'sha256:abc123',
  });

  assert.equal(item.source, 'source_monitor');
  assert.equal(item.type, 'source_change');
  assert.equal(item.status, 'needs_review');
  assert.equal(item.subject, 'Source candidate: haltern-dlrg');
  assert.equal(item.submitter, 'machine-detected');
  assert.equal(item.evidence, 'https://haltern.dlrg.de/');
  assert.match(item.suggestedAction, /Review the source manually/);
});

test('malformed and duplicate source candidates are skipped safely', () => {
  const candidates = normalizeSourceCandidates({
    candidates: [
      {
        id: 'dup',
        sourceId: 'one',
        sourceUrl: 'https://example.com/one',
        reason: 'changed',
      },
      {
        id: 'dup',
        sourceId: 'one-again',
        sourceUrl: 'https://example.com/one-again',
        reason: 'duplicate',
      },
      {
        id: 'missing-url',
        sourceId: 'bad',
        reason: 'no url',
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'dup');
});

test('renderAdminHtml displays source candidates without live-data commands', () => {
  const html = renderAdminHtml([update], {
    status: 'all',
    sourceCandidates: [{
      id: 'source:haltern-dlrg:source_change:abc',
      sourceId: 'haltern-dlrg',
      sourceUrl: 'https://haltern.dlrg.de/',
      town: 'Haltern am See',
      organizerName: 'DLRG Haltern am See',
      candidateType: 'source_change',
      confidence: 'medium',
      reason: 'Page content hash changed since the previous snapshot.',
      detectedAt: '2026-07-01T10:00:00Z',
      status: 'needs_review',
      rawSnapshotRef: 'sha256:abc123',
    }],
  });

  assert.match(html, /Review queue/);
  assert.match(html, /data-source="source_monitor"/);
  assert.match(html, /data-area="Haltern am See"/);
  assert.match(html, /Source candidate: haltern-dlrg/);
  assert.match(html, /machine-detected/);
  assert.match(html, /Local review item/);
  assert.match(html, /No reviewer notes stored yet/);
  assert.match(html, /Kids Tennis/);
  assert.match(html, /npm run supabase:update-status -- --id=123 --status=applied/);
  assert.doesNotMatch(html, /SERVICE_ROLE/i);
});

test('freshness candidate shape is normalized for admin review', () => {
  const item = freshnessCandidateItem({
    id: 'freshness:swim:stale:2026-03-01',
    type: 'verify_activity_freshness',
    activityId: 'swim',
    activityName: 'Swim Club',
    organizerId: 'club',
    organizerName: 'Club',
    town: 'Dülmen',
    lastVerified: '2026-03-01',
    freshnessStatus: 'stale',
    daysSinceVerified: 122,
    reason: 'Listing was last verified 122 days ago.',
    sourceUrl: 'https://example.test/swim',
  });

  assert.equal(item.source, 'freshness_monitor');
  assert.equal(item.type, 'verify_activity_freshness');
  assert.equal(item.status, 'needs_review');
  assert.equal(item.activityId, 'swim');
  assert.equal(item.freshnessStatus, 'stale');
});

test('freshness candidates are de-duplicated and rendered read-only', () => {
  const candidates = [
    {
      id: 'freshness:swim:stale:2026-03-01',
      type: 'verify_activity_freshness',
      activityId: 'swim',
      activityName: 'Swim Club',
      town: 'Dülmen',
      lastVerified: '2026-03-01',
      freshnessStatus: 'stale',
      daysSinceVerified: 122,
    },
    {
      id: 'freshness:swim:stale:2026-03-01',
      type: 'verify_activity_freshness',
      activityId: 'swim',
      activityName: 'Swim Club',
      town: 'Dülmen',
      lastVerified: '2026-03-01',
      freshnessStatus: 'stale',
      daysSinceVerified: 122,
    },
  ];

  assert.equal(normalizeFreshnessCandidates(candidates).length, 1);
  const html = renderAdminHtml([], { freshnessCandidates: candidates });
  assert.match(html, /freshness_monitor/);
  assert.match(html, /Local review item/);
  assert.match(html, /Last verified/);
});

test('verification review item renders previous and proposed dates read-only', () => {
  const item = verificationReviewItem({
    id: 'verify-swim-2026-07-01',
    type: 'activity_verification',
    status: 'approved_for_manual_apply',
    activityId: 'swim',
    activityName: 'Swim Club',
    previousLastVerified: '2026-03-01',
    proposedLastVerified: '2026-07-01',
    verificationSource: 'https://example.test/swim',
    verificationMethod: 'source_check',
    verifiedBy: 'editor',
    reviewerNotes: 'Checked manually.',
  });

  assert.equal(item.source, 'verification_review');
  assert.equal(item.type, 'activity_verification');
  assert.equal(item.status, 'approved_for_manual_apply');
  assert.equal(item.previousLastVerified, '2026-03-01');
  assert.equal(item.proposedLastVerified, '2026-07-01');

  assert.equal(normalizeVerificationReviewItems([item, item]).length, 1);
  const html = renderAdminHtml([], { verificationItems: [item] });
  assert.match(html, /Verification apply: Swim Club/);
  assert.match(html, /Previous check/);
  assert.match(html, /Proposed check/);
  assert.match(html, /Local review item/);
  assert.doesNotMatch(html, /SERVICE_ROLE/i);
});

test('duplicate detection identifies likely duplicates without deleting data', () => {
  const items = [
    reviewItem({
      ...update,
      id: 'a',
      status: 'new',
      activity_slug: 'kids-tennis',
      update_type: 'update',
      created_at: '2026-07-01T10:00:00Z',
    }),
    reviewItem({
      ...update,
      id: 'b',
      status: 'new',
      activity_slug: 'kids-tennis',
      update_type: 'update',
      created_at: '2026-07-01T11:00:00Z',
    }),
    sourceCandidateItem({
      id: 'source-one',
      sourceId: 'haltern-city',
      sourceUrl: 'https://www.haltern-am-see.de/',
      candidateType: 'source_change',
      rawSnapshotRef: 'sha256:abc',
      checkedAt: '2026-07-01T10:00:00Z',
    }),
    sourceCandidateItem({
      id: 'source-two',
      sourceId: 'haltern-city',
      sourceUrl: 'https://www.haltern-am-see.de/',
      candidateType: 'source_change',
      rawSnapshotRef: 'sha256:abc',
      checkedAt: '2026-07-01T10:05:00Z',
    }),
  ];

  const groups = detectLikelyDuplicates(items);
  assert.ok(groups.some((group) => group.reason === 'Same activity ID and submission type.'));
  assert.ok(groups.some((group) => group.reason === 'Same source ID and snapshot/hash reference.'));
  assert.equal(items.length, 4);

  const annotated = annotateDuplicateReviewItems(items);
  assert.equal(annotated.find((item) => item.id === 'a').duplicateGroups.length, 1);
  assert.equal(annotated.find((item) => item.id === 'source-one').duplicateGroups.length >= 1, true);
});
