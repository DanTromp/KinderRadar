export const UPDATE_STATUSES = new Set(['new', 'needs_review', 'accepted', 'rejected', 'applied']);
export const SOURCE_CANDIDATE_TYPES = new Set(['source_change', 'source_unreachable', 'possible_new_activity', 'possible_activity_update', 'possible_closure']);
export const FRESHNESS_CANDIDATE_TYPES = new Set(['verify_activity_freshness', 'verify_organizer_freshness']);
export const VERIFICATION_REVIEW_TYPES = new Set(['activity_verification']);
export const SOURCE_CANDIDATE_STATUSES = new Set(['needs_review', 'reviewed', 'ignored', 'needs_follow_up']);
export const REVIEW_STATUSES = new Set(['needs_review', 'in_review', 'needs_follow_up', 'approved_for_manual_apply', 'rejected', 'ignored_duplicate', 'handled']);

const LEGACY_STATUS_MAP = new Map([
  ['new', 'needs_review'],
  ['needs_review', 'needs_review'],
  ['accepted', 'approved_for_manual_apply'],
  ['applied', 'handled'],
  ['rejected', 'rejected'],
  ['reviewed', 'handled'],
  ['ignored', 'ignored_duplicate'],
  ['needs_follow_up', 'needs_follow_up'],
]);

export function compact(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function escapeHtml(value) {
  return compact(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function payload(update) {
  return update?.payload && typeof update.payload === 'object' ? update.payload : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const next = compact(value);
    if (next) return next;
  }
  return '';
}

function shortText(value, maxLength = 500) {
  const valueText = compact(value);
  if (valueText.length <= maxLength) return valueText;
  if (maxLength <= 3) return valueText.slice(0, maxLength);
  return `${valueText.slice(0, maxLength - 3)}...`;
}

function stableSourceCandidateId(candidate) {
  return [
    'source',
    compact(candidate?.sourceId, 'unknown'),
    compact(candidate?.candidateType || candidate?.detectedChangeType, 'source_change'),
    compact(candidate?.rawSnapshotRef || candidate?.checkedAt || candidate?.detectedAt, 'snapshot'),
  ].join(':').replace(/\s+/g, '-');
}

function stableFreshnessCandidateId(candidate) {
  return [
    'freshness',
    compact(candidate?.activityId || candidate?.organizerId, 'unknown'),
    compact(candidate?.candidateType || candidate?.type, 'verify_activity_freshness'),
    compact(candidate?.lastVerified || candidate?.detectedAt, 'missing'),
  ].join(':').replace(/\s+/g, '-');
}

export function normalizeReviewStatus(value) {
  const status = compact(value).toLowerCase();
  if (REVIEW_STATUSES.has(status)) return status;
  if (LEGACY_STATUS_MAP.has(status)) return LEGACY_STATUS_MAP.get(status);
  return 'needs_review';
}

export function reviewerNotes(value, maxLength = 500) {
  return shortText(value, maxLength);
}

function daysBetween(a, b) {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return null;
  return Math.abs(aTime - bTime) / 86400000;
}

export function subjectForUpdate(update) {
  const data = payload(update);
  if (data.type === 'digest_signup') {
    return `Digest signup: ${compact(data.cityName || data.citySlug, 'unknown area')}`;
  }
  if (update?.update_type === 'organizer_claim') {
    return `Organizer claim: ${compact(data.organizerName || data.organizerId, 'unknown organizer')}`;
  }
  return compact(update?.activity_slug || data.activityName, '(missing activity name)');
}

export function townForUpdate(update) {
  const data = payload(update);
  return compact(data.town || data.cityName);
}

export function suggestedAction(update) {
  if (payload(update).type === 'digest_signup') {
    return 'Add to the digest audience list, then mark applied.';
  }
  switch (update?.update_type) {
    case 'submission':
      return 'Verify source, add activity data, then mark accepted/applied.';
    case 'update':
      return 'Compare evidence with current listing, update changed fields, then mark applied.';
    case 'closed':
      return 'Confirm closure from evidence or organizer, then set activity status to reported-closed.';
    case 'confirm':
      return 'Bump lastVerified; if organizer-confirmed, consider verifiedBy: organizer.';
    case 'claim':
      return 'Verify organizer identity before changing verifiedBy or contact details.';
    case 'organizer_claim':
      return 'Verify claimant identity, then update organizer profile fields in source data before export/build.';
    default:
      return 'Review evidence and decide whether to accept, reject, or request more detail.';
  }
}

export function reviewItem(update) {
  const data = payload(update);
  const type = compact(update?.update_type, 'unknown');
  const rawStatus = compact(update?.status, 'unknown');
  const isDigest = data.type === 'digest_signup';
  const activityId = isDigest ? '' : compact(update?.activity_slug);
  const activityName = isDigest ? '' : compact(data.activityName);
  const organizerId = compact(data.organizerSlug || data.organizerId);
  const organizerName = compact(data.organizerName || data.organizer);
  const submitter = firstNonEmpty(update?.reporter_email, data.claimantEmail, data.reporterEmail, data.email, data.claimantName, data.reporterName, 'not provided');
  const evidence = firstNonEmpty(update?.evidence_url, data.verificationUrl, data.evidenceUrl, data.sourceUrl, 'none');
  const message = firstNonEmpty(data.message, data.notes, data.details, data.claimantRole, data.interest, 'none');
  const area = firstNonEmpty(data.town, data.cityName, data.citySlug);
  return {
    id: compact(update?.id, 'unknown'),
    type,
    status: normalizeReviewStatus(rawStatus),
    rawStatus,
    subject: subjectForUpdate(update),
    activityId,
    activityName,
    organizerId,
    organizerName,
    submitter,
    evidence,
    message,
    area,
    createdAt: compact(update?.created_at, 'unknown'),
    reviewerNotes: reviewerNotes(data.reviewerNotes || data.reviewNotes),
    suggestedAction: suggestedAction(update),
  };
}

export function sourceCandidateItem(candidate) {
  const sourceUrl = compact(candidate?.sourceUrl);
  const detectedChangeType = compact(candidate?.detectedChangeType);
  const rawType = compact(candidate?.candidateType) || (detectedChangeType === 'availability_changed' ? 'source_unreachable' : 'source_change');
  const candidateType = SOURCE_CANDIDATE_TYPES.has(rawType) ? rawType : 'source_change';
  const rawStatus = compact(candidate?.status || candidate?.reviewStatus, 'needs_review');
  const status = normalizeReviewStatus(SOURCE_CANDIDATE_STATUSES.has(rawStatus) ? rawStatus : 'needs_review');
  const rawSnapshotRef = shortText(candidate?.rawSnapshotRef || candidate?.hash, 120);
  const sourceId = compact(candidate?.sourceId, 'unknown source');

  return {
    id: compact(candidate?.id, stableSourceCandidateId({ ...candidate, candidateType, rawSnapshotRef })),
    source: 'source_monitor',
    type: candidateType,
    status,
    rawStatus,
    subject: `Source candidate: ${sourceId}`,
    activityId: '',
    activityName: '',
    organizerId: '',
    organizerName: compact(candidate?.organizerName),
    submitter: 'machine-detected',
    evidence: sourceUrl || 'none',
    message: shortText(candidate?.reason, 500) || 'Source monitor detected a possible change.',
    area: compact(candidate?.town || candidate?.place),
    createdAt: compact(candidate?.detectedAt || candidate?.checkedAt, 'unknown'),
    reviewerNotes: reviewerNotes(candidate?.reviewerNotes),
    suggestedAction: 'Review the source manually. If it reflects a real activity change, update Supabase/source data through the normal reviewed workflow.',
    sourceId,
    sourceUrl,
    confidence: compact(candidate?.confidence, 'unknown'),
    rawSnapshotRef,
    detectedChangeType,
  };
}

export function normalizeSourceCandidates(input) {
  const rawCandidates = Array.isArray(input)
    ? input
    : Array.isArray(input?.candidates)
      ? input.candidates
      : [];
  const seen = new Set();
  const items = [];

  for (const candidate of rawCandidates) {
    const item = sourceCandidateItem(candidate);
    if (!item.sourceUrl || item.evidence === 'none') continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

export function freshnessCandidateItem(candidate) {
  const rawType = compact(candidate?.candidateType || candidate?.type, 'verify_activity_freshness');
  const candidateType = FRESHNESS_CANDIDATE_TYPES.has(rawType) ? rawType : 'verify_activity_freshness';
  const rawStatus = compact(candidate?.status || candidate?.reviewStatus, 'needs_review');
  const status = normalizeReviewStatus(rawStatus);
  const isOrganizer = candidateType === 'verify_organizer_freshness';
  const activityName = compact(candidate?.activityName || candidate?.activityId);
  const organizerName = compact(candidate?.organizerName || candidate?.organizerId);
  const subject = isOrganizer
    ? `Freshness check: ${organizerName || 'unknown organizer'}`
    : `Freshness check: ${activityName || 'unknown activity'}`;

  return {
    id: compact(candidate?.id, stableFreshnessCandidateId({ ...candidate, candidateType })),
    source: 'freshness_monitor',
    type: candidateType,
    status,
    rawStatus,
    subject,
    activityId: isOrganizer ? '' : compact(candidate?.activityId),
    activityName: isOrganizer ? '' : activityName,
    organizerId: compact(candidate?.organizerId),
    organizerName,
    submitter: 'machine-detected',
    evidence: compact(candidate?.sourceUrl, 'none'),
    message: shortText(candidate?.reason, 500) || 'Freshness monitor detected a listing that needs verification.',
    area: compact(candidate?.town || candidate?.place),
    createdAt: compact(candidate?.detectedAt || candidate?.createdAt, 'unknown'),
    reviewerNotes: reviewerNotes(candidate?.reviewerNotes),
    suggestedAction: compact(candidate?.suggestedAction, 'Verify manually, update source data if needed, then run release checks.'),
    freshnessStatus: compact(candidate?.freshnessStatus),
    lastVerified: compact(candidate?.lastVerified, 'missing'),
    daysSinceVerified: candidate?.daysSinceVerified ?? '',
    affectedListings: candidate?.affectedListings ?? '',
  };
}

export function normalizeFreshnessCandidates(input) {
  const rawCandidates = Array.isArray(input)
    ? input
    : Array.isArray(input?.candidates)
      ? input.candidates
      : [];
  const seen = new Set();
  const items = [];

  for (const candidate of rawCandidates) {
    const item = freshnessCandidateItem(candidate);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

export function verificationReviewItem(candidate) {
  const rawType = compact(candidate?.type || candidate?.candidateType, 'activity_verification');
  const type = VERIFICATION_REVIEW_TYPES.has(rawType) ? rawType : 'activity_verification';
  const rawStatus = compact(candidate?.status || candidate?.reviewStatus, 'needs_review');
  const activityId = compact(candidate?.activityId || candidate?.activitySlug);
  const activityName = compact(candidate?.activityName || activityId);
  const sourceUrl = compact(candidate?.verificationSource || candidate?.sourceUrl);
  const proposedLastVerified = compact(candidate?.proposedLastVerified || candidate?.verifiedAt, 'not provided');
  return {
    id: compact(candidate?.id, `verification:${activityId || 'unknown'}:${proposedLastVerified}`.replace(/\s+/g, '-')),
    source: 'verification_review',
    type,
    status: normalizeReviewStatus(rawStatus),
    rawStatus,
    subject: `Verification apply: ${activityName || 'unknown activity'}`,
    activityId,
    activityName,
    organizerId: compact(candidate?.organizerId),
    organizerName: compact(candidate?.organizerName),
    submitter: compact(candidate?.reviewer || candidate?.verifiedBy, 'reviewer'),
    evidence: sourceUrl || 'none',
    message: shortText(candidate?.reviewerNotes || candidate?.verificationNotes || candidate?.reason, 500) || 'Approved verification metadata update.',
    area: compact(candidate?.town || candidate?.place),
    createdAt: compact(candidate?.createdAt || candidate?.approvedAt || candidate?.detectedAt, 'unknown'),
    reviewerNotes: reviewerNotes(candidate?.reviewerNotes),
    suggestedAction: 'Preview with npm run review:apply-preview. Apply only after confirming the diff is limited to verification metadata.',
    previousLastVerified: compact(candidate?.previousLastVerified, 'not provided'),
    proposedLastVerified,
    verificationMethod: compact(candidate?.verificationMethod, 'source_check'),
    verificationSource: sourceUrl,
    verifiedBy: compact(candidate?.verifiedBy, 'editor'),
  };
}

export function normalizeVerificationReviewItems(input) {
  const rawItems = Array.isArray(input)
    ? input
    : Array.isArray(input?.items)
      ? input.items
      : Array.isArray(input?.candidates)
        ? input.candidates
        : [];
  const seen = new Set();
  const items = [];

  for (const candidate of rawItems) {
    const item = verificationReviewItem(candidate);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

function duplicateKeysForItem(item) {
  const keys = [];
  const sourceId = compact(item.sourceId).toLowerCase();
  const rawSnapshotRef = compact(item.rawSnapshotRef).toLowerCase();
  const sourceUrl = compact(item.sourceUrl || item.evidence).toLowerCase().replace(/\/$/, '');
  const activityId = compact(item.activityId).toLowerCase();
  const organizerId = compact(item.organizerId).toLowerCase();
  const submitter = compact(item.submitter).toLowerCase();
  const type = compact(item.type).toLowerCase();

  if (item.source === 'source_monitor' && sourceId && rawSnapshotRef) {
    keys.push({
      key: `source-hash:${sourceId}:${rawSnapshotRef}`,
      reason: 'Same source ID and snapshot/hash reference.',
    });
  }

  if (item.source === 'source_monitor' && sourceUrl && type) {
    keys.push({
      key: `source-url-type:${sourceUrl}:${type}`,
      reason: 'Same source URL and candidate type in this review batch.',
    });
  }

  if (item.source === 'freshness_monitor' && activityId && type) {
    keys.push({
      key: `freshness-activity:${activityId}:${type}`,
      reason: 'Same activity freshness task in this review batch.',
    });
  }

  if (item.source === 'freshness_monitor' && organizerId && type) {
    keys.push({
      key: `freshness-organizer:${organizerId}:${type}`,
      reason: 'Same organizer freshness task in this review batch.',
    });
  }

  if (item.source === 'verification_review' && activityId && type) {
    keys.push({
      key: `verification-activity:${activityId}:${type}`,
      reason: 'Same activity verification review task in this batch.',
    });
  }

  if (activityId && type) {
    keys.push({
      key: `activity-type:${activityId}:${type}`,
      reason: 'Same activity ID and submission type.',
    });
  }

  if ((type === 'claim' || type === 'organizer_claim') && organizerId && submitter && submitter !== 'not provided') {
    keys.push({
      key: `organizer-claim:${organizerId}:${submitter}`,
      reason: 'Same organizer claim submitter.',
    });
  }

  return keys;
}

export function detectLikelyDuplicates(items) {
  const byKey = new Map();
  for (const item of items) {
    for (const candidate of duplicateKeysForItem(item)) {
      const group = byKey.get(candidate.key) ?? { key: candidate.key, reason: candidate.reason, items: [] };
      group.items.push(item);
      byKey.set(candidate.key, group);
    }
  }

  const groups = [];
  for (const group of byKey.values()) {
    const unique = new Map(group.items.map((item) => [item.id, item]));
    if (unique.size < 2) continue;
    const sorted = [...unique.values()].sort((a, b) => compact(b.createdAt).localeCompare(compact(a.createdAt)));
    const datesClose = sorted.every((item, index) => {
      if (index === 0) return true;
      const gap = daysBetween(sorted[0].createdAt, item.createdAt);
      return gap === null || gap <= 14;
    });
    if (!datesClose) continue;
    groups.push({
      key: group.key,
      reason: group.reason,
      itemIds: sorted.map((item) => item.id),
    });
  }

  return groups;
}

export function annotateDuplicateReviewItems(items) {
  const groups = detectLikelyDuplicates(items);
  const byId = new Map(items.map((item) => [item.id, { ...item, duplicateGroups: [] }]));
  for (const group of groups) {
    for (const id of group.itemIds) {
      const item = byId.get(id);
      if (item) item.duplicateGroups.push({ key: group.key, reason: group.reason, itemIds: group.itemIds });
    }
  }
  return [...byId.values()];
}

export function describeUpdate(update) {
  const item = reviewItem(update);
  const townText = item.area ? `, ${item.area}` : '';
  return [
    `[${item.type}] ${item.subject}${townText}`,
    `  id: ${item.id}`,
    `  status: ${item.status}`,
    `  created: ${item.createdAt}`,
    `  evidence: ${item.evidence}`,
    `  notes: ${item.message}`,
    `  action: ${item.suggestedAction}`,
  ].join('\n');
}

export function renderMarkdown(updates, { status = 'new' } = {}) {
  const lines = [
    `# My Kids Radar Review Queue`,
    '',
    `Status: \`${status}\``,
    `Updates: ${updates.length}`,
    '',
  ];

  if (updates.length === 0) {
    lines.push('No updates found.');
    return `${lines.join('\n')}\n`;
  }

  for (const update of updates) {
    const data = payload(update);
    lines.push(
      `## ${subjectForUpdate(update)}`,
      '',
      `- Type: \`${compact(update.update_type, 'unknown')}\``,
      `- Status: \`${compact(update.status, 'unknown')}\``,
      `- ID: \`${compact(update.id, 'unknown')}\``,
      `- Town: ${townForUpdate(update) || 'not provided'}`,
      `- Created: ${compact(update.created_at, 'unknown')}`,
      `- Evidence: ${compact(update.evidence_url || data.verificationUrl || data.evidenceUrl || data.sourceUrl, 'none')}`,
      `- Reporter email: ${compact(update.reporter_email, 'not provided')}`,
      data.organizerName || data.organizerId ? `- Organizer: ${compact(data.organizerName || data.organizerId)}` : '',
      data.claimantName || data.claimantRole ? `- Claimant: ${compact(data.claimantName)}${data.claimantRole ? ` (${compact(data.claimantRole)})` : ''}` : '',
      `- Suggested action: ${suggestedAction(update)}`,
      '',
      `Notes: ${compact(data.message || data.notes, 'none')}`,
      '',
      `Command examples:`,
      '',
      '```bash',
      `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=needs_review`,
      `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=applied`,
      '```',
      '',
    );
  }

  return `${lines.join('\n')}\n`;
}

export function renderHtml(updates, { status = 'new' } = {}) {
  const cards = updates.length
    ? updates.map((update) => {
      const data = payload(update);
      const evidence = compact(update.evidence_url || data.verificationUrl || data.evidenceUrl || data.sourceUrl, 'none');
      const command = `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=needs_review`;
      return `      <article class="card">
        <div class="card-head">
          <span>${escapeHtml(update.update_type ?? 'unknown')}</span>
          <strong>${escapeHtml(subjectForUpdate(update))}</strong>
        </div>
        <dl>
          <dt>ID</dt><dd><code>${escapeHtml(update.id ?? 'unknown')}</code></dd>
          <dt>Status</dt><dd>${escapeHtml(update.status ?? 'unknown')}</dd>
          <dt>Town</dt><dd>${escapeHtml(townForUpdate(update) || 'not provided')}</dd>
          <dt>Created</dt><dd>${escapeHtml(update.created_at ?? 'unknown')}</dd>
          <dt>Evidence</dt><dd>${evidence.startsWith('http') ? `<a href="${escapeHtml(evidence)}">${escapeHtml(evidence)}</a>` : escapeHtml(evidence)}</dd>
          <dt>Email</dt><dd>${escapeHtml(update.reporter_email ?? 'not provided')}</dd>
        </dl>
        <p>${escapeHtml(compact(data.message || data.notes, 'No notes provided.'))}</p>
        <p class="action">${escapeHtml(suggestedAction(update))}</p>
        <code>${escapeHtml(command)}</code>
      </article>`;
    }).join('\n')
    : '      <p class="empty">No updates found.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Kids Radar Review Queue</title>
    <style>
      body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #172033; background: #f8f2e7; }
      main { width: min(1120px, calc(100% - 2rem)); margin: 2rem auto; }
      h1 { margin-bottom: 0.2rem; }
      .meta { color: #5d6a80; margin-top: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
      .card { border: 1px solid #d6dce5; border-radius: 8px; background: #fff; padding: 1rem; box-shadow: 0 12px 35px rgba(23,32,51,.08); }
      .card-head { display: grid; gap: .2rem; margin-bottom: .8rem; }
      .card-head span { color: #f05f4f; font-weight: 700; font-size: .8rem; text-transform: uppercase; }
      .card-head strong { font-size: 1.1rem; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .7rem; }
      dt { color: #5d6a80; font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; background: #eef7fb; border: 1px solid #d6dce5; border-radius: 6px; padding: .15rem .35rem; }
      .action { border-left: 3px solid #f05f4f; padding-left: .65rem; font-weight: 650; }
      .empty { border: 1px solid #d6dce5; border-radius: 8px; background: #fff; padding: 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>My Kids Radar Review Queue</h1>
      <p class="meta">Status: ${escapeHtml(status)} · Updates: ${updates.length}</p>
      <section class="grid">
${cards}
      </section>
    </main>
  </body>
</html>
`;
}

function statusCommand(id, status) {
  return `npm run supabase:update-status -- --id=${compact(id, '<id>')} --status=${status}`;
}

function commandButtons(id) {
  return ['needs_review', 'applied', 'rejected']
    .map((status) => `<button type="button" data-copy-command="${escapeHtml(statusCommand(id, status))}">${escapeHtml(status.replace('_', ' '))}</button>`)
    .join(' ');
}

export function renderAdminHtml(updates, { status = 'all', sourceCandidates = [], freshnessCandidates = [], verificationItems = [] } = {}) {
  const rawItems = [
    ...updates.map(reviewItem).map((item) => ({ ...item, source: item.source || 'activity_updates' })),
    ...normalizeSourceCandidates(sourceCandidates),
    ...normalizeFreshnessCandidates(freshnessCandidates),
    ...normalizeVerificationReviewItems(verificationItems),
  ];
  const items = annotateDuplicateReviewItems(rawItems)
    .sort((a, b) => compact(b.createdAt).localeCompare(compact(a.createdAt)));
  const statuses = [...new Set(items.map((item) => item.status))].sort();
  const statusFilterValues = [...new Set([...REVIEW_STATUSES, ...statuses])].sort();
  const types = [...new Set(items.map((item) => item.type))].sort();
  const sources = [...new Set(items.map((item) => item.source))].sort();
  const areas = [...new Set(items.map((item) => item.area).filter(Boolean))].sort();
  const statusOptions = ['all', ...statusFilterValues]
    .map((value) => `<option value="${escapeHtml(value)}"${value === status ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  const typeOptions = ['all', ...types]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');
  const sourceOptions = ['all', ...sources]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value.replace('_', ' '))}</option>`)
    .join('');
  const areaOptions = ['all', ...areas]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');
  const countsHtml = [
    ...statuses.map((value) => `<span><strong>${escapeHtml(value)}</strong> ${items.filter((item) => item.status === value).length}</span>`),
    ...types.map((value) => `<span><strong>${escapeHtml(value)}</strong> ${items.filter((item) => item.type === value).length}</span>`),
  ].join(' ');

  const cards = items.length
    ? items.map((item) => {
      const evidence = item.evidence.startsWith('http')
        ? `<a href="${escapeHtml(item.evidence)}" rel="noopener noreferrer">${escapeHtml(item.evidence)}</a>`
        : escapeHtml(item.evidence);
      const isSourceCandidate = item.source === 'source_monitor';
      const isFreshnessCandidate = item.source === 'freshness_monitor';
      const isVerificationItem = item.source === 'verification_review';
      const extraRows = isSourceCandidate
        ? `
            <dt>Source ID</dt><dd>${escapeHtml(item.sourceId)}</dd>
            <dt>Confidence</dt><dd>${escapeHtml(item.confidence)}</dd>
            <dt>Snapshot</dt><dd>${escapeHtml(item.rawSnapshotRef || 'not provided')}</dd>`
        : isFreshnessCandidate
          ? `
            <dt>Freshness</dt><dd>${escapeHtml(item.freshnessStatus || 'unknown')}</dd>
            <dt>Last verified</dt><dd>${escapeHtml(item.lastVerified || 'missing')}</dd>
            <dt>Age</dt><dd>${escapeHtml(item.daysSinceVerified === '' ? 'unknown' : `${item.daysSinceVerified} days`)}</dd>
            <dt>Affected listings</dt><dd>${escapeHtml(item.affectedListings || 'not provided')}</dd>`
          : isVerificationItem
            ? `
            <dt>Previous check</dt><dd>${escapeHtml(item.previousLastVerified)}</dd>
            <dt>Proposed check</dt><dd>${escapeHtml(item.proposedLastVerified)}</dd>
            <dt>Method</dt><dd>${escapeHtml(item.verificationMethod)}</dd>
            <dt>Verified by</dt><dd>${escapeHtml(item.verifiedBy)}</dd>`
        : '';
      const commandMarkup = isSourceCandidate || isFreshnessCandidate || isVerificationItem
        ? '<span>Local review item. Use the CLI preview/apply workflow; no browser write action is available.</span>'
        : commandButtons(item.id);
      const duplicateRows = item.duplicateGroups?.length
        ? `
            <dt>Possible duplicate</dt><dd>${escapeHtml(item.duplicateGroups.map((group) => `${group.reason} (${group.itemIds.length} items)`).join(' | '))}</dd>`
        : '';
      const notesText = item.reviewerNotes || 'No reviewer notes stored yet.';
      const statusText = `${item.status}${item.rawStatus && item.rawStatus !== item.status ? ` (raw: ${item.rawStatus})` : ''}`;
      return `        <article class="review-card" data-status="${escapeHtml(item.status)}" data-type="${escapeHtml(item.type)}" data-source="${escapeHtml(item.source)}" data-area="${escapeHtml(item.area || '')}">
          <header>
            <span>${escapeHtml(item.type)}</span>
            <strong>${escapeHtml(item.subject)}</strong>
            <small>${escapeHtml(statusText)} · ${escapeHtml(item.createdAt)}</small>
          </header>
          <dl>
            <dt>ID</dt><dd><code>${escapeHtml(item.id)}</code></dd>
            <dt>Activity</dt><dd>${escapeHtml(item.activityName || item.activityId || 'not provided')}</dd>
            <dt>Activity ID</dt><dd>${escapeHtml(item.activityId || 'not provided')}</dd>
            <dt>Organizer</dt><dd>${escapeHtml(item.organizerName || item.organizerId || 'not provided')}</dd>
            <dt>Submitter</dt><dd>${escapeHtml(item.submitter)}</dd>
            <dt>Area</dt><dd>${escapeHtml(item.area || 'not provided')}</dd>
            <dt>Evidence</dt><dd>${evidence}</dd>
            ${extraRows}
            ${duplicateRows}
            <dt>Message</dt><dd>${escapeHtml(item.message)}</dd>
            <dt>Reviewer notes</dt><dd>${escapeHtml(notesText)}</dd>
          </dl>
          <p class="action">${escapeHtml(item.suggestedAction)}</p>
          <div class="commands">
            <span>Status commands:</span>
            ${commandMarkup}
          </div>
        </article>`;
    }).join('\n')
    : '        <p class="empty" data-empty>Nothing is waiting in this review queue.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>My Kids Radar Admin Review</title>
    <style>
      :root { color-scheme: light; --ink: #172033; --muted: #5d6a80; --line: #d6dce5; --paper: #fff; --wash: #f7f9fb; --accent: #f05f4f; }
      body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
      main { width: min(1180px, calc(100% - 2rem)); margin: 2rem auto; display: grid; gap: 1rem; }
      h1 { margin: 0; font-size: clamp(1.8rem, 3vw, 2.6rem); }
      p { margin: 0; }
      .muted { color: var(--muted); }
      .toolbar, .notice, .empty { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 1rem; }
      .toolbar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
      label { display: grid; gap: .25rem; font-weight: 700; color: var(--muted); }
      select { min-width: 12rem; border: 1px solid var(--line); border-radius: 6px; padding: .45rem .55rem; background: #fff; color: var(--ink); }
      .review-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
      .review-card { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 1rem; display: grid; gap: .85rem; box-shadow: 0 12px 30px rgba(23,32,51,.06); }
      .review-card[hidden] { display: none; }
      .review-card header { display: grid; gap: .15rem; }
      .review-card header span { color: var(--accent); text-transform: uppercase; font-weight: 800; font-size: .78rem; }
      .review-card header strong { font-size: 1.08rem; }
      .review-card header small { color: var(--muted); }
      dl { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: .35rem .75rem; margin: 0; }
      dt { color: var(--muted); font-weight: 800; }
      dd { margin: 0; overflow-wrap: anywhere; }
      code { border: 1px solid var(--line); border-radius: 6px; background: #eef7fb; padding: .12rem .3rem; }
      .action { border-left: 3px solid var(--accent); padding-left: .65rem; font-weight: 650; }
      .commands { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; }
      .commands span { color: var(--muted); font-weight: 800; }
      .counts { display: flex; flex-wrap: wrap; gap: .45rem; color: var(--muted); }
      .counts span { border: 1px solid var(--line); border-radius: 999px; padding: .2rem .5rem; background: #fff; }
      button { border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: .4rem .55rem; cursor: pointer; }
      button:hover { border-color: var(--accent); }
      [data-copy-status] { min-height: 1.4rem; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="muted">Internal review</p>
        <h1>Review queue</h1>
        <p class="muted">Generated locally. Activity submissions come from Supabase; local source, freshness, and verification review items come from report artifacts. This static file contains review data but no Supabase secrets.</p>
      </header>
      <section class="notice">
        <strong>Read-only by design.</strong>
        Browser status and reviewer-note updates need a secure admin endpoint or Supabase Auth/RLS policy. Until then, use the copied CLI commands where available and apply verification review items only through the dry-run CLI workflow.
      </section>
      <section class="counts" aria-label="Queue counts">
        ${countsHtml || '<span><strong>empty</strong> 0</span>'}
      </section>
      <section class="toolbar" aria-label="Review filters">
        <label>Status
          <select data-filter-status>${statusOptions}</select>
        </label>
        <label>Type
          <select data-filter-type>${typeOptions}</select>
        </label>
        <label>Source
          <select data-filter-source>${sourceOptions}</select>
        </label>
        <label>Town/place
          <select data-filter-area>${areaOptions}</select>
        </label>
        <p data-copy-status aria-live="polite"></p>
      </section>
      <section class="review-grid" data-review-grid>
${cards}
      </section>
    </main>
    <script>
      const statusFilter = document.querySelector('[data-filter-status]');
      const typeFilter = document.querySelector('[data-filter-type]');
      const sourceFilter = document.querySelector('[data-filter-source]');
      const areaFilter = document.querySelector('[data-filter-area]');
      const cards = Array.from(document.querySelectorAll('.review-card'));
      const copyStatus = document.querySelector('[data-copy-status]');
      function applyFilters() {
        const status = statusFilter.value;
        const type = typeFilter.value;
        const source = sourceFilter.value;
        const area = areaFilter.value;
        for (const card of cards) {
          const visible = (status === 'all' || card.dataset.status === status)
            && (type === 'all' || card.dataset.type === type)
            && (source === 'all' || card.dataset.source === source)
            && (area === 'all' || card.dataset.area === area);
          card.hidden = !visible;
        }
      }
      statusFilter.addEventListener('change', applyFilters);
      typeFilter.addEventListener('change', applyFilters);
      sourceFilter.addEventListener('change', applyFilters);
      areaFilter.addEventListener('change', applyFilters);
      document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy-command]');
        if (!button) return;
        const command = button.dataset.copyCommand;
        try {
          await navigator.clipboard.writeText(command);
          copyStatus.textContent = 'Command copied.';
        } catch {
          copyStatus.textContent = command;
        }
      });
      applyFilters();
    </script>
  </body>
</html>
`;
}
