import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activities as defaultActivities } from '../assets/activities-data.mjs';
import {
  buildOrganizers,
  organizerNameForActivity,
  organizerSlugForActivity,
} from '../assets/organizers.mjs';
import { freshnessStatus } from '../assets/render.mjs';

const DEFAULT_REPORT_JSON = 'review/verification-drafts/report.json';
const DEFAULT_REPORT_MARKDOWN = 'review/verification-drafts/report.md';
const DEFAULT_DRAFTS = 'review/verification-drafts/drafts.json';
const DRAFT_STATUSES = new Set(['needs_verification_soon', 'stale', 'missing_verification']);

function compact(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function shortText(value, maxLength = 160) {
  const text = compact(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isActiveActivity(activity) {
  return activity?.status !== 'reported-closed' && activity?.status !== 'inactive';
}

function contactGroupFor(organizer) {
  if (compact(organizer?.contactEmail)) return 'with_email';
  if (compact(organizer?.websiteUrl)) return 'website_only';
  return 'no_contact';
}

function activityLine(activity, freshness) {
  const schedule = compact(activity.timing || [activity.dayOfWeek, activity.startTime].filter(Boolean).join(' '), 'Zeit noch nicht sicher');
  const location = compact(activity.address || activity.location?.address || activity.town, 'Ort noch nicht sicher');
  const lastVerified = compact(activity.lastVerified, 'unbekannt');
  return `- ${shortText(activity.name)} (${activity.slug}): ${schedule}; ${location}; zuletzt geprueft: ${lastVerified}; Status: ${freshness.status}`;
}

function draftId(organizerId, activities) {
  const activityKey = activities.map((item) => item.activity.slug).sort().join('+') || 'no-activities';
  return `verification-draft:${organizerId || 'unknown'}:${activityKey}`.replace(/\s+/g, '-');
}

function draftSubject(organizerName) {
  return `Bitte Aktivitaeten fuer MeinKinderRadar pruefen: ${organizerName}`;
}

function germanBody({ organizerName, activities }) {
  const lines = activities.map(({ activity, freshness }) => activityLine(activity, freshness)).join('\n');
  return [
    `Guten Tag ${organizerName},`,
    '',
    'ich pflege MeinKinderRadar/KinderRadar, ein lokales, manuell geprueftes Verzeichnis fuer Kinder- und Familienaktivitaeten.',
    'Damit Eltern keine veralteten Informationen sehen, pruefe ich regelmaessig die Angaben zu Zeiten, Kosten, Anmeldung und Kontaktwegen.',
    '',
    'Koennen Sie bitte kurz bestaetigen, ob diese Eintraege noch stimmen? Falls sich etwas geaendert hat, reicht eine kurze Korrektur als Antwort.',
    '',
    lines || '- Keine Aktivitaeten gelistet.',
    '',
    'Vielen Dank!',
    'MeinKinderRadar Redaktion',
    '',
    'Hinweis: Diese Nachricht ist nur ein Entwurf. Sie wurde nicht automatisch versendet.',
  ].join('\n');
}

function englishBody({ organizerName, activities }) {
  const lines = activities.map(({ activity, freshness }) => activityLine(activity, freshness)).join('\n');
  return [
    `Hello ${organizerName},`,
    '',
    'I maintain MeinKinderRadar/KinderRadar, a local manually reviewed directory for kids and family activities.',
    'Could you please confirm whether the following listings are still correct, or send corrections if something changed?',
    '',
    lines || '- No activities listed.',
    '',
    'Thank you!',
    'MeinKinderRadar editorial team',
    '',
    'Note: this is a draft only. It was not sent automatically.',
  ].join('\n');
}

function organizerDraft({ organizer, activities, generatedAt }) {
  const organizerId = organizer?.slug ?? organizerSlugForActivity(activities[0]?.activity);
  const organizerName = organizer?.name ?? organizerNameForActivity(activities[0]?.activity);
  const activityRows = activities.map(({ activity, freshness }) => ({
    activityId: activity.slug,
    activityName: activity.name,
    town: activity.town ?? '',
    timing: activity.timing ?? '',
    dayOfWeek: activity.dayOfWeek ?? '',
    startTime: activity.startTime ?? '',
    location: activity.address || activity.location?.address || activity.town || '',
    lastVerified: activity.lastVerified ?? null,
    freshnessStatus: freshness.status,
    freshnessIssue: freshness.issue,
  }));

  return {
    id: draftId(organizerId, activities),
    generatedAt,
    sendStatus: 'draft_only',
    organizerId,
    organizerName,
    contactEmail: organizer?.contactEmail || '',
    contactUrl: organizer?.websiteUrl || '',
    websiteUrl: organizer?.websiteUrl || '',
    phone: organizer?.phone || '',
    contactGroup: contactGroupFor(organizer),
    activityIds: activityRows.map((item) => item.activityId),
    activityNames: activityRows.map((item) => item.activityName),
    freshnessStatuses: [...new Set(activityRows.map((item) => item.freshnessStatus))].sort(),
    activities: activityRows,
    subject: draftSubject(organizerName),
    bodyDe: germanBody({ organizerName, activities }),
    bodyEn: englishBody({ organizerName, activities }),
  };
}

export function buildVerificationDraftReport({
  activities = defaultActivities,
  now = new Date(),
} = {}) {
  const allActivities = Array.isArray(activities) ? activities : [];
  const activeActivities = allActivities.filter(isActiveActivity);
  const organizers = buildOrganizers(activeActivities);
  const organizerBySlug = new Map(organizers.map((organizer) => [organizer.slug, organizer]));
  const generatedAt = now.toISOString();
  const grouped = new Map();

  for (const activity of activeActivities) {
    const freshness = freshnessStatus(activity, now);
    if (!DRAFT_STATUSES.has(freshness.status)) continue;
    const organizerId = organizerSlugForActivity(activity);
    const group = grouped.get(organizerId) ?? [];
    if (!group.some((item) => item.activity.slug === activity.slug)) {
      group.push({ activity, freshness });
    }
    grouped.set(organizerId, group);
  }

  const drafts = [...grouped.entries()]
    .map(([organizerId, items]) => organizerDraft({
      organizer: organizerBySlug.get(organizerId) ?? {
        slug: organizerId,
        name: organizerNameForActivity(items[0]?.activity),
        websiteUrl: items[0]?.activity?.contactUrl || items[0]?.activity?.sourceUrl || '',
        contactEmail: '',
        phone: '',
      },
      activities: items.sort((a, b) => compact(a.activity.name).localeCompare(compact(b.activity.name))),
      generatedAt,
    }))
    .sort((a, b) => a.contactGroup.localeCompare(b.contactGroup) || a.organizerName.localeCompare(b.organizerName));

  const withEmail = drafts.filter((draft) => draft.contactGroup === 'with_email');
  const websiteOnly = drafts.filter((draft) => draft.contactGroup === 'website_only');
  const noContact = drafts.filter((draft) => draft.contactGroup === 'no_contact');

  return {
    generatedAt,
    totals: {
      activities: allActivities.length,
      activeActivities: activeActivities.length,
      activitiesNeedingVerification: drafts.reduce((sum, draft) => sum + draft.activities.length, 0),
      drafts: drafts.length,
      withEmail: withEmail.length,
      websiteOnly: websiteOnly.length,
      noContact: noContact.length,
    },
    drafts,
    groups: {
      withEmail,
      websiteOnly,
      noContact,
    },
    notice: 'Drafts only. This script does not send emails, contact organizers, write Supabase, update lastVerified, or modify activity data.',
  };
}

function formatDraftSummary(draft) {
  const contact = draft.contactEmail || draft.websiteUrl || draft.contactUrl || 'no contact info';
  return `- ${draft.organizerName} (${draft.organizerId}): ${draft.activities.length} activit${draft.activities.length === 1 ? 'y' : 'ies'} | ${draft.contactGroup} | ${contact}`;
}

export function renderVerificationDraftReport(report) {
  const lines = [
    'KinderRadar Organizer Verification Drafts',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${report.totals.activitiesNeedingVerification} activities needing verification, ${report.totals.drafts} organizer draft(s).`,
    `Contact groups: ${report.totals.withEmail} with email, ${report.totals.websiteOnly} website only, ${report.totals.noContact} no contact info.`,
    '',
    'Organizers with email:',
    ...(report.groups.withEmail.length ? report.groups.withEmail.map(formatDraftSummary) : ['- none']),
    '',
    'Organizers with website/contact URL only:',
    ...(report.groups.websiteOnly.length ? report.groups.websiteOnly.map(formatDraftSummary) : ['- none']),
    '',
    'Organizers with no contact info:',
    ...(report.groups.noContact.length ? report.groups.noContact.map(formatDraftSummary) : ['- none']),
    '',
    'Draft previews:',
  ];

  if (report.drafts.length === 0) {
    lines.push('- none');
  } else {
    for (const draft of report.drafts.slice(0, 5)) {
      lines.push(
        '',
        `## ${draft.organizerName}`,
        `ID: ${draft.id}`,
        `Contact: ${draft.contactEmail || draft.websiteUrl || draft.contactUrl || 'not available'}`,
        `Subject: ${draft.subject}`,
        '',
        '```text',
        draft.bodyDe,
        '```',
      );
    }
  }

  lines.push(
    '',
    report.notice,
  );

  return `${lines.join('\n')}\n`;
}

function wantsJson(args) {
  return args.includes('--json') || args.includes('--format=json');
}

function hasFlag(args, name) {
  return args.includes(name);
}

function arg(args, name, fallback = '') {
  const prefix = `--${name}=`;
  return args.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function printHelp() {
  console.log([
    'Usage: node scripts/verification-drafts.mjs [--json|--format=json] [--no-write]',
    '',
    'Reads assets/activities-data.mjs only and writes draft-only review artifacts under review/verification-drafts/ by default.',
    'Does not send emails, contact organizers, query Supabase, update lastVerified, or modify activity data.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    return;
  }

  const report = buildVerificationDraftReport();
  if (!hasFlag(args, '--no-write')) {
    await writeJson(arg(args, 'report-json', DEFAULT_REPORT_JSON), report);
    await writeText(arg(args, 'report-md', DEFAULT_REPORT_MARKDOWN), renderVerificationDraftReport(report));
    await writeJson(arg(args, 'drafts', DEFAULT_DRAFTS), report.drafts);
  }

  if (wantsJson(args)) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderVerificationDraftReport(report));
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
