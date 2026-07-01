import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { categories, cities, sections } from '../assets/activities-data.mjs';
import { validateActivity } from './build-check.mjs';

const DEFAULT_DATA_PATH = 'assets/activities-data.mjs';
const APPROVED_STATUS = 'approved_for_manual_apply';
const VERIFIED_BY = new Set(['organizer', 'parent', 'editor']);
const VERIFICATION_METHODS = new Set(['source_check', 'organizer_confirmation', 'parent_confirmation', 'editor_review', 'phone', 'email', 'form']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const APPLY_FIELDS = [
  'lastVerified',
  'verifiedBy',
  'verifiedAt',
  'verificationSource',
  'verificationMethod',
  'verificationNotes',
];

function compact(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day;
}

function validUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function reviewItemsFrom(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.items)) return input.items;
  if (Array.isArray(input?.candidates)) return input.candidates;
  if (input && typeof input === 'object') return [input];
  return [];
}

export function selectReviewItem(input, id) {
  const items = reviewItemsFrom(input);
  if (!id && items.length === 1) return items[0];
  return items.find((item) => compact(item?.id) === id) ?? null;
}

export async function loadReviewItem(path, id) {
  const raw = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  const item = selectReviewItem(raw, id);
  if (!item) {
    throw new Error(id ? `Review item "${id}" was not found in ${path}.` : `Review item id is required when ${path} contains multiple items.`);
  }
  return item;
}

export function validateVerificationReviewItem(item, activities, { now = new Date(), requireApproved = true } = {}) {
  const errors = [];
  const activityId = compact(item?.activityId || item?.activitySlug);
  const proposedLastVerified = compact(item?.proposedLastVerified || item?.verifiedAt);
  const previousLastVerified = compact(item?.previousLastVerified);
  const verificationSource = compact(item?.verificationSource || item?.sourceUrl);
  const verificationMethod = compact(item?.verificationMethod, 'source_check');
  const verifiedBy = compact(item?.verifiedBy, 'editor');
  const notes = compact(item?.verificationNotes);

  if (compact(item?.type || item?.candidateType) !== 'activity_verification') {
    errors.push('type must be "activity_verification".');
  }
  if (requireApproved && compact(item?.status || item?.reviewStatus) !== APPROVED_STATUS) {
    errors.push(`status must be "${APPROVED_STATUS}" before applying verification updates.`);
  }
  if (!activityId) {
    errors.push('activityId is required.');
  }

  const activity = activities.find((candidate) => candidate.slug === activityId);
  if (activityId && !activity) {
    errors.push(`activityId "${activityId}" does not match any exported activity.`);
  }
  if (activity && (activity.status === 'reported-closed' || activity.status === 'inactive')) {
    errors.push(`activityId "${activityId}" is not active.`);
  }
  if (activity && previousLastVerified && activity.lastVerified !== previousLastVerified) {
    errors.push(`previousLastVerified "${previousLastVerified}" does not match current lastVerified "${activity.lastVerified}".`);
  }
  if (!proposedLastVerified) {
    errors.push('proposedLastVerified is required.');
  } else if (!validDate(proposedLastVerified)) {
    errors.push(`proposedLastVerified "${proposedLastVerified}" must be a valid YYYY-MM-DD date.`);
  } else if (proposedLastVerified > todayIso(now)) {
    errors.push(`proposedLastVerified "${proposedLastVerified}" cannot be in the future.`);
  }
  if (!verificationSource) {
    errors.push('verificationSource or sourceUrl is required.');
  } else if (!validUrl(verificationSource)) {
    errors.push(`verificationSource "${verificationSource}" is not a valid http(s) URL.`);
  }
  if (!VERIFICATION_METHODS.has(verificationMethod)) {
    errors.push(`verificationMethod "${verificationMethod}" must be one of ${[...VERIFICATION_METHODS].join(', ')}.`);
  }
  if (!VERIFIED_BY.has(verifiedBy)) {
    errors.push(`verifiedBy "${verifiedBy}" must be one of ${[...VERIFIED_BY].join(', ')}.`);
  }
  if (notes.length > 500) {
    errors.push('verificationNotes must be 500 characters or fewer. Keep internal notes in reviewerNotes instead.');
  }

  return { ok: errors.length === 0, errors, activity };
}

export function buildVerificationPatch(item) {
  const patch = {
    lastVerified: compact(item.proposedLastVerified || item.verifiedAt),
    verifiedBy: compact(item.verifiedBy, 'editor'),
    verifiedAt: compact(item.verifiedAt || item.proposedLastVerified),
    verificationSource: compact(item.verificationSource || item.sourceUrl),
    verificationMethod: compact(item.verificationMethod, 'source_check'),
  };
  const notes = compact(item.verificationNotes);
  if (notes) patch.verificationNotes = notes;
  return patch;
}

export function applyVerificationPatch(activity, patch) {
  const updated = { ...activity };
  for (const field of APPLY_FIELDS) {
    if (patch[field] !== undefined && patch[field] !== '') {
      updated[field] = patch[field];
    }
  }
  return updated;
}

export function diffVerificationFields(before, after) {
  return APPLY_FIELDS
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: before[field] ?? null,
      after: after[field] ?? null,
    }));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findActivityObjectRange(source, slug) {
  const slugPattern = new RegExp(`"slug"\\s*:\\s*"${escapeRegExp(slug)}"`);
  const match = slugPattern.exec(source);
  if (!match) return null;

  let start = source.lastIndexOf('\n  {', match.index);
  if (start === -1) start = source.lastIndexOf('{', match.index);
  else start += 3;
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  return null;
}

function replaceActivityObject(source, slug, updatedActivity) {
  const range = findActivityObjectRange(source, slug);
  if (!range) throw new Error(`Could not locate activity "${slug}" in data source.`);
  const replacement = JSON.stringify(updatedActivity, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? `  ${line}` : `  ${line}`))
    .join('\n');
  return `${source.slice(0, range.start)}${replacement}${source.slice(range.end)}`;
}

async function loadActivitiesFromDataPath(dataPath) {
  const url = pathToFileURL(resolve(dataPath));
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  const module = await import(url.href);
  return Array.isArray(module.activities) ? module.activities : [];
}

export function validateActivityDataset(activities) {
  const errors = [];
  const sectionIds = new Set(sections.map((section) => section.id));
  const cityTowns = new Set(cities.flatMap((city) => city.nearbyTowns));
  const seen = new Set();
  for (const activity of activities) {
    const id = activity.slug ?? activity.name ?? '<unknown>';
    for (const error of validateActivity(activity, sectionIds)) {
      errors.push(`activity "${id}": ${error}`);
    }
    if (activity.slug) {
      if (seen.has(activity.slug)) errors.push(`duplicate slug "${activity.slug}"`);
      seen.add(activity.slug);
    }
    if (activity.town && !cityTowns.has(activity.town)) {
      errors.push(`activity "${id}": town "${activity.town}" is not covered by any city in cities[]`);
    }
    if (activity.category && !categories.includes(activity.category)) {
      errors.push(`activity "${id}": unknown category "${activity.category}"`);
    }
  }
  return errors;
}

export async function previewVerificationApply({
  reviewItem,
  dataPath = DEFAULT_DATA_PATH,
  now = new Date(),
} = {}) {
  const activities = await loadActivitiesFromDataPath(dataPath);
  const validation = validateVerificationReviewItem(reviewItem, activities, { now, requireApproved: true });
  if (!validation.ok) {
    throw new Error(`Verification review item is not applyable:\n- ${validation.errors.join('\n- ')}`);
  }
  const patch = buildVerificationPatch(reviewItem);
  const before = validation.activity;
  const after = applyVerificationPatch(before, patch);
  const updatedActivities = activities.map((activity) => (activity.slug === before.slug ? after : activity));
  const datasetErrors = validateActivityDataset(updatedActivities);
  if (datasetErrors.length > 0) {
    throw new Error(`Updated activity dataset would not validate:\n- ${datasetErrors.join('\n- ')}`);
  }
  const diff = diffVerificationFields(before, after);
  return {
    activityId: before.slug,
    activityName: before.name,
    reviewItemId: compact(reviewItem.id, 'unknown'),
    before,
    after,
    diff,
    patch,
    updatedActivities,
  };
}

export async function applyVerificationReview({
  reviewItem,
  dataPath = DEFAULT_DATA_PATH,
  apply = false,
  now = new Date(),
} = {}) {
  const preview = await previewVerificationApply({ reviewItem, dataPath, now });
  if (!apply) return { ...preview, written: false };

  const source = await readFile(dataPath, 'utf8');
  const updatedSource = replaceActivityObject(source, preview.activityId, preview.after);
  await writeFile(dataPath, updatedSource, 'utf8');
  return { ...preview, written: true };
}

export function renderApplyPreview(result) {
  const lines = [
    'KinderRadar Verification Apply Preview',
    `Review item: ${result.reviewItemId}`,
    `Activity: ${result.activityName} (${result.activityId})`,
    '',
    'Before/after:',
    ...(result.diff.length
      ? result.diff.map((item) => `- ${item.field}: ${item.before ?? '(missing)'} -> ${item.after ?? '(missing)'}`)
      : ['- no verification metadata changes']),
  ];
  return `${lines.join('\n')}\n`;
}

function arg(args, name, fallback = '') {
  const prefix = `--${name}=`;
  return args.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log([
    'Usage: node scripts/review-apply.mjs --file=review/verification/item.json --id=<review-id> [--apply]',
    '',
    'Dry-run is the default. Only activity_verification items with status approved_for_manual_apply can be applied.',
    'The script updates only lastVerified/verifiedBy/verifiedAt/verificationSource/verificationMethod/verificationNotes.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    return;
  }

  const file = arg(args, 'file');
  const id = arg(args, 'id');
  const dataPath = arg(args, 'data', DEFAULT_DATA_PATH);
  const shouldApply = hasFlag(args, '--apply');
  if (!file) throw new Error('Pass --file=<review item json>.');

  const reviewItem = await loadReviewItem(file, id);
  const result = await applyVerificationReview({
    reviewItem,
    dataPath,
    apply: shouldApply,
  });
  process.stdout.write(renderApplyPreview(result));
  console.log(shouldApply
    ? `Applied verification metadata to ${dataPath}.`
    : 'Dry run only. Re-run with --apply, or use npm run review:apply, after reviewing the preview.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
