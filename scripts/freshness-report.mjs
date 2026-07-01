import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activities as defaultActivities } from '../assets/activities-data.mjs';
import {
  FRESHNESS_THRESHOLDS,
  freshnessStatus,
  verificationAgeDays,
} from '../assets/render.mjs';
import {
  buildOrganizers,
  organizerNameForActivity,
  organizerSlugForActivity,
} from '../assets/organizers.mjs';

const DEFAULT_REPORT_JSON = 'review/freshness/report.json';
const DEFAULT_REPORT_MARKDOWN = 'review/freshness/report.md';
const DEFAULT_CANDIDATES = 'review/freshness/candidates.json';

function isActiveActivity(activity) {
  return activity?.status !== 'reported-closed' && activity?.status !== 'inactive';
}

function compact(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = compact(keyFn(item), 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortedCountRows(counts) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function validLastVerified(activity, now) {
  const days = verificationAgeDays(activity?.lastVerified, now);
  if (days === null || days < 0) return null;
  return activity.lastVerified;
}

function freshnessCandidateId(activity, freshness) {
  return [
    'freshness',
    compact(activity?.slug, 'unknown-activity'),
    compact(freshness.status, 'unknown'),
    compact(activity?.lastVerified, 'missing'),
  ].join(':').replace(/\s+/g, '-');
}

function organizerCandidateId(organizer, lastVerified) {
  return [
    'freshness-organizer',
    compact(organizer?.slug, 'unknown-organizer'),
    compact(lastVerified, 'missing'),
  ].join(':').replace(/\s+/g, '-');
}

function reasonForFreshness(freshness) {
  if (freshness.issue === 'future_last_verified') return 'lastVerified is in the future and needs a manual data check.';
  if (freshness.issue === 'invalid_last_verified') return 'lastVerified is invalid and needs a manual data check.';
  if (freshness.issue === 'missing_last_verified') return 'lastVerified is missing and needs a manual data check.';
  if (freshness.status === 'stale') return `Listing was last verified ${freshness.days} days ago (> ${FRESHNESS_THRESHOLDS.staleDays}).`;
  if (freshness.status === 'needs_verification_soon') return `Listing was last verified ${freshness.days} days ago and is approaching the ${FRESHNESS_THRESHOLDS.staleDays}-day stale threshold.`;
  return 'Listing freshness should be reviewed.';
}

function activityCandidate(activity, freshness, now) {
  const organizerId = organizerSlugForActivity(activity);
  const organizerName = organizerNameForActivity(activity);
  return {
    id: freshnessCandidateId(activity, freshness),
    source: 'freshness_monitor',
    candidateType: 'verify_activity_freshness',
    type: 'verify_activity_freshness',
    status: 'needs_review',
    reviewStatus: 'needs_review',
    detectedAt: now.toISOString(),
    activityId: compact(activity.slug),
    activityName: compact(activity.name, activity.slug),
    organizerId,
    organizerName,
    town: compact(activity.town),
    category: compact(activity.category),
    section: compact(activity.section),
    lastVerified: activity.lastVerified ?? null,
    freshnessStatus: freshness.status,
    daysSinceVerified: freshness.days,
    reason: reasonForFreshness(freshness),
    sourceUrl: compact(activity.sourceUrl || activity.contactUrl),
    suggestedAction: 'Verify the source or organizer manually, then update lastVerified only through the reviewed source-data workflow.',
  };
}

function organizerCandidatesFrom(activityCandidates, organizers, now) {
  const byOrganizer = new Map();
  for (const candidate of activityCandidates) {
    const key = compact(candidate.organizerId);
    if (!key) continue;
    const group = byOrganizer.get(key) ?? [];
    group.push(candidate);
    byOrganizer.set(key, group);
  }

  return [...byOrganizer.entries()]
    .filter(([, candidates]) => candidates.length >= 2)
    .map(([organizerId, candidates]) => {
      const organizer = organizers.find((item) => item.slug === organizerId);
      const oldest = candidates
        .map((candidate) => candidate.lastVerified)
        .filter(Boolean)
        .sort()[0] ?? null;
      return {
        id: organizerCandidateId({ slug: organizerId }, oldest),
        source: 'freshness_monitor',
        candidateType: 'verify_organizer_freshness',
        type: 'verify_organizer_freshness',
        status: 'needs_review',
        reviewStatus: 'needs_review',
        detectedAt: now.toISOString(),
        organizerId,
        organizerName: organizer?.name ?? candidates[0]?.organizerName ?? organizerId,
        town: organizer?.towns?.join(', ') ?? candidates[0]?.town ?? '',
        activityIds: candidates.map((candidate) => candidate.activityId),
        affectedListings: candidates.length,
        lastVerified: oldest,
        freshnessStatus: 'needs_verification_soon',
        reason: `${candidates.length} listings for this organizer need freshness review.`,
        sourceUrl: organizer?.websiteUrl ?? '',
        contactEmail: organizer?.contactEmail ?? '',
        suggestedAction: 'Review organizer-level source/contact information manually before applying any listing updates.',
      };
    });
}

function reminderDraftsFrom(organizerCandidates) {
  return organizerCandidates
    .filter((candidate) => candidate.contactEmail)
    .map((candidate) => ({
      organizerId: candidate.organizerId,
      organizerName: candidate.organizerName,
      contactEmail: candidate.contactEmail,
      affectedListings: candidate.affectedListings,
      reason: candidate.reason,
      note: 'Draft only. No email is sent by this script.',
    }));
}

export function buildFreshnessReport({
  activities = defaultActivities,
  now = new Date(),
} = {}) {
  const allActivities = Array.isArray(activities) ? activities : [];
  const activeActivities = allActivities.filter(isActiveActivity);
  const inactiveActivities = allActivities.filter((activity) => !isActiveActivity(activity));
  const organizers = buildOrganizers(activeActivities);
  const enriched = activeActivities.map((activity) => ({
    activity,
    freshness: freshnessStatus(activity, now),
  }));

  const statusCounts = countBy(enriched, (item) => item.freshness.status);
  const withinDays = (days) => enriched.filter((item) => {
    const age = verificationAgeDays(item.activity.lastVerified, now);
    return age !== null && age >= 0 && age <= days;
  }).length;
  const missingVerification = enriched.filter((item) => item.freshness.status === 'missing_verification');
  const olderThan90 = enriched.filter((item) => item.freshness.status === 'stale');
  const soonStale = enriched.filter((item) => item.freshness.status === 'needs_verification_soon');
  const needsReview = enriched.filter((item) => ['needs_verification_soon', 'stale', 'missing_verification'].includes(item.freshness.status));
  const oldestLastVerified = activeActivities
    .map((activity) => validLastVerified(activity, now))
    .filter(Boolean)
    .sort()[0] ?? null;

  const activityCandidates = needsReview.map(({ activity, freshness }) => activityCandidate(activity, freshness, now));
  const organizerCandidates = organizerCandidatesFrom(activityCandidates, organizers, now);
  const candidates = [...activityCandidates, ...organizerCandidates]
    .sort((a, b) => compact(a.town).localeCompare(compact(b.town)) || compact(a.activityName || a.organizerName).localeCompare(compact(b.activityName || b.organizerName)));
  const candidateIds = new Set();
  const dedupedCandidates = candidates.filter((candidate) => {
    if (candidateIds.has(candidate.id)) return false;
    candidateIds.add(candidate.id);
    return true;
  });

  return {
    generatedAt: now.toISOString(),
    thresholds: {
      freshDays: FRESHNESS_THRESHOLDS.freshDays,
      staleSoonDays: FRESHNESS_THRESHOLDS.staleSoonDays,
      staleDays: FRESHNESS_THRESHOLDS.staleDays,
    },
    totals: {
      activities: allActivities.length,
      activeActivities: activeActivities.length,
      inactiveActivities: inactiveActivities.length,
      verifiedWithin30Days: withinDays(30),
      verifiedWithin60Days: withinDays(60),
      verifiedWithin90Days: withinDays(90),
      olderThan90Days: olderThan90.length,
      missingOrInvalidLastVerified: missingVerification.length,
      futureLastVerified: missingVerification.filter((item) => item.freshness.issue === 'future_last_verified').length,
      staleSoon: soonStale.length,
      oldestLastVerified,
    },
    statusCounts,
    groups: {
      staleOrSoonByTown: sortedCountRows(countBy(needsReview, (item) => item.activity.town)),
      staleOrSoonByOrganizer: sortedCountRows(countBy(needsReview, (item) => organizerNameForActivity(item.activity))),
      staleOrSoonByCategory: sortedCountRows(countBy(needsReview, (item) => item.activity.category)),
      staleOrSoonBySection: sortedCountRows(countBy(needsReview, (item) => item.activity.section)),
    },
    listings: {
      soonStale: soonStale.map(({ activity, freshness }) => ({
        slug: activity.slug,
        name: activity.name,
        town: activity.town,
        organizer: organizerNameForActivity(activity),
        category: activity.category,
        section: activity.section,
        lastVerified: activity.lastVerified ?? null,
        daysSinceVerified: freshness.days,
      })),
      stale: olderThan90.map(({ activity, freshness }) => ({
        slug: activity.slug,
        name: activity.name,
        town: activity.town,
        organizer: organizerNameForActivity(activity),
        category: activity.category,
        section: activity.section,
        lastVerified: activity.lastVerified ?? null,
        daysSinceVerified: freshness.days,
      })),
      missingVerification: missingVerification.map(({ activity, freshness }) => ({
        slug: activity.slug,
        name: activity.name,
        town: activity.town,
        organizer: organizerNameForActivity(activity),
        lastVerified: activity.lastVerified ?? null,
        issue: freshness.issue,
        daysSinceVerified: freshness.days,
      })),
    },
    candidates: dedupedCandidates,
    reminderDrafts: reminderDraftsFrom(organizerCandidates),
  };
}

function formatGroup(rows) {
  return rows.length ? rows.map((row) => `- ${row.name}: ${row.count}`).join('\n') : '- none';
}

function formatListings(rows) {
  return rows.length
    ? rows.slice(0, 12).map((item) => `- ${item.name} (${item.slug}) | ${item.town || 'unknown town'} | ${item.daysSinceVerified ?? 'unknown'} days | ${item.lastVerified ?? 'missing'}`).join('\n')
    : '- none';
}

export function renderFreshnessReport(report) {
  const active = report.totals.activeActivities || 0;
  return [
    'KinderRadar Freshness Report',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${active}/${report.totals.activities} active listings, ${report.totals.inactiveActivities} inactive/reported closed.`,
    `Thresholds: fresh <${report.thresholds.freshDays} days, review soon >=${report.thresholds.staleSoonDays} days, stale >${report.thresholds.staleDays} days.`,
    '',
    'Freshness windows:',
    `- Verified within 30 days: ${report.totals.verifiedWithin30Days}/${active}`,
    `- Verified within 60 days: ${report.totals.verifiedWithin60Days}/${active}`,
    `- Verified within 90 days: ${report.totals.verifiedWithin90Days}/${active}`,
    `- Becoming stale soon: ${report.totals.staleSoon}/${active}`,
    `- Older than 90 days: ${report.totals.olderThan90Days}/${active}`,
    `- Missing/invalid lastVerified: ${report.totals.missingOrInvalidLastVerified}/${active}`,
    `- Future lastVerified dates: ${report.totals.futureLastVerified}/${active}`,
    `- Oldest lastVerified: ${report.totals.oldestLastVerified ?? 'unknown'}`,
    '',
    'Status counts:',
    ...Object.entries(report.statusCounts).sort().map(([status, count]) => `- ${status}: ${count}`),
    '',
    'Needs review by town/place:',
    formatGroup(report.groups.staleOrSoonByTown),
    '',
    'Needs review by organizer:',
    formatGroup(report.groups.staleOrSoonByOrganizer),
    '',
    'Needs review by category:',
    formatGroup(report.groups.staleOrSoonByCategory),
    '',
    'Needs review by section:',
    formatGroup(report.groups.staleOrSoonBySection),
    '',
    'Listings becoming stale soon:',
    formatListings(report.listings.soonStale),
    '',
    'Stale listings:',
    formatListings(report.listings.stale),
    '',
    'Missing/invalid verification listings:',
    formatListings(report.listings.missingVerification),
    '',
    `Review candidates prepared: ${report.candidates.length}`,
    `Organizer reminder drafts prepared: ${report.reminderDrafts.length} (draft only; no emails sent)`,
    '',
    'Manual process: freshness report -> review task -> verify source/organizer -> manual apply -> release check -> deploy.',
    'This script reads static data only. It does not update listings, change lastVerified, write Supabase, deploy, or send emails.',
  ].join('\n') + '\n';
}

function wantsJson(args) {
  return args.includes('--json') || args.includes('--format=json');
}

function hasFlag(args, name) {
  return args.includes(name);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function arg(args, name, fallback = '') {
  const prefix = `--${name}=`;
  return args.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function printHelp() {
  console.log([
    'Usage: node scripts/freshness-report.mjs [--json|--format=json] [--no-write]',
    '',
    'Reads assets/activities-data.mjs only. Writes review-only artifacts under review/freshness/ by default.',
    'Does not query Supabase, update lastVerified, deploy, or send emails.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    return;
  }

  const report = buildFreshnessReport();
  if (!hasFlag(args, '--no-write')) {
    const reportJsonPath = arg(args, 'report-json', DEFAULT_REPORT_JSON);
    const reportMarkdownPath = arg(args, 'report-md', DEFAULT_REPORT_MARKDOWN);
    const candidatesPath = arg(args, 'candidates', DEFAULT_CANDIDATES);
    await writeJson(reportJsonPath, report);
    await writeText(reportMarkdownPath, renderFreshnessReport(report));
    await writeJson(candidatesPath, report.candidates);
  }

  if (wantsJson(args)) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderFreshnessReport(report));
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
