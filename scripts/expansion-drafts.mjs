import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activities as liveActivities,
  categories,
  sections,
} from '../assets/activities-data.mjs';
import { organizers as liveOrganizers } from '../assets/organizers.mjs';
import { slugify } from '../assets/render.mjs';
import { validateActivity } from './build-check.mjs';

const DEFAULT_WORKSPACE = 'expansion';
const DEFAULT_SOURCE_REGISTRY = 'data/source-registry.json';
const APPROVED_STATUS = 'approved_for_manual_apply';
const REQUIRED_ACTIVITY_FIELDS = [
  'slug',
  'name',
  'section',
  'category',
  'ageRange',
  'ageMin',
  'ageMax',
  'town',
  'timing',
  'cost',
  'lastVerified',
  'beginnerFriendly',
];
const DRAFT_STATUSES = new Set(['draft', 'needs_manual_completion', 'ready_for_manual_apply', 'manually_applied']);
const MARKET_STATUSES = new Set(['planning', 'active', 'paused', 'archived']);
const PLACE_TYPES = new Set(['city', 'district', 'nearby_area', 'village', 'town']);
const CHECKLIST_STATUSES = new Set(['missing', 'found', 'reviewing', 'approved', 'rejected', 'not_applicable']);
const CHECKLIST_SOURCE_TYPES = new Set([
  'official_city_family_youth_page',
  'ferienprogramm',
  'sports_clubs',
  'music_schools',
  'dance_schools',
  'swimming_pools',
  'libraries',
  'museums',
  'vhs_family_courses',
  'family_centers',
  'church_community_groups',
  'indoor_play',
  'martial_arts',
  'football_clubs',
  'tennis_clubs',
  'gymnastics_clubs',
]);
const CHECKLIST_ITEMS = [
  ['sourceChecked', 'source checked manually'],
  ['organizerVerified', 'organizer verified'],
  ['scheduleVerified', 'schedule verified'],
  ['locationVerified', 'location verified'],
  ['priceVerified', 'price verified'],
  ['ageRangeVerified', 'age range verified'],
  ['categoryVerified', 'category verified'],
  ['duplicateCheckCompleted', 'duplicate check completed'],
  ['i18nChecked', 'German/English text checked'],
];

function compact(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function arg(args, name, fallback = '') {
  const prefix = `--${name}=`;
  return args.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeId(value) {
  return slugify(compact(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(dir, entry.name))
    .sort();
  const rows = [];
  for (const file of files) {
    rows.push({ path: file, data: await readJson(file) });
  }
  return rows;
}

async function readSourceRegistry(path = DEFAULT_SOURCE_REGISTRY) {
  if (!path || !existsSync(path)) return [];
  const parsed = await readJson(path);
  return asArray(parsed).map((source) => ({
    id: normalizeId(source?.id || source?.sourceId || source?.slug),
    sourceId: normalizeId(source?.id || source?.sourceId || source?.slug),
    url: compact(source?.url || source?.sourceUrl),
    organizerName: compact(source?.organizerName || source?.organizer_name),
    town: compact(source?.town || source?.place),
    sourceType: compact(source?.sourceType || source?.source_type),
    trustLevel: compact(source?.trustLevel || source?.trust_level),
    crawlFrequency: compact(source?.crawlFrequency || source?.crawl_frequency),
    active: source?.active !== false,
    notes: compact(source?.notes),
    lastChecked: compact(source?.lastChecked || source?.checkedAt || source?.last_checked),
  })).filter((source) => source.id);
}

function marketFromFile(data, path) {
  const id = normalizeId(data?.id || data?.slug || data?.marketId || data?.marketSlug || fileURLToPathName(path));
  return {
    ...data,
    id,
    slug: normalizeId(data?.slug || id),
    name: compact(data?.name, id),
    places: asArray(data?.places),
    sources: asArray(data?.sources),
    candidates: asArray(data?.candidates),
    path,
  };
}

function fileURLToPathName(path) {
  return String(path).split(/[\\/]/).pop()?.replace(/\.json$/i, '') ?? 'market';
}

function candidateMarketId(candidate, fallbackMarketId) {
  return normalizeId(candidate?.marketId || candidate?.marketSlug || fallbackMarketId);
}

export async function loadExpansionWorkspace({ workspaceDir = DEFAULT_WORKSPACE } = {}) {
  const root = resolve(workspaceDir);
  const marketFiles = await readJsonFiles(join(root, 'markets'));
  const markets = marketFiles.map(({ data, path }) => marketFromFile(data, path));
  const marketById = new Map(markets.flatMap((market) => [
    [market.id, market],
    [market.slug, market],
  ]));

  for (const { data } of await readJsonFiles(join(root, 'candidates'))) {
    const rawCandidates = Array.isArray(data) ? data : asArray(data?.candidates);
    for (const candidate of rawCandidates) {
      const marketId = candidateMarketId(candidate, data?.marketId || data?.marketSlug);
      const market = marketById.get(marketId);
      if (market) market.candidates.push(candidate);
    }
  }

  return { root, markets, marketById };
}

function findPlace(market, placeId) {
  const id = normalizeId(placeId);
  return market.places.find((place) => normalizeId(place.id || place.slug || place.placeId || place.name) === id) ?? null;
}

function findSource(market, sourceId, registrySources = []) {
  const id = normalizeId(sourceId);
  if (!id) return null;
  return [
    ...asArray(market.sources),
    ...asArray(registrySources),
  ].find((source) => normalizeId(source.id || source.sourceId || source.slug || source.url) === id) ?? null;
}

function validHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function urlKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return compact(value).replace(/\/$/, '').toLowerCase();
  }
}

function genericHomepageUrl(value) {
  if (!validHttpUrl(value)) return false;
  const url = new URL(value);
  return !url.search && !url.hash && (!url.pathname || url.pathname === '/');
}

function draftActivity(draft) {
  return draft?.activityDraft && typeof draft.activityDraft === 'object' && !Array.isArray(draft.activityDraft)
    ? draft.activityDraft
    : {};
}

function findCandidate(market, sourceCandidateId) {
  const id = normalizeId(sourceCandidateId);
  if (!id) return null;
  return asArray(market?.candidates).find((candidate) => candidateId(candidate) === id) ?? null;
}

function checklistValue(draft, key) {
  const checklist = draft?.checklist && typeof draft.checklist === 'object' ? draft.checklist : {};
  const manualChecks = draft?.manualChecks && typeof draft.manualChecks === 'object' ? draft.manualChecks : {};
  return checklist[key] === true || manualChecks[key] === true;
}

function placeholderEntries(value, path = 'draft') {
  const entries = [];
  if (value === null) return [{ path, reason: 'null placeholder' }];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text && path.startsWith('activityDraft.')) return [{ path, reason: 'empty placeholder' }];
    if (/^(todo|tbd|unknown|unsure|not sure|check|\?+)$|todo|tbd/i.test(text)) {
      return [{ path, reason: `placeholder text "${text}"` }];
    }
    return [];
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => entries.push(...placeholderEntries(item, `${path}[${index}]`)));
    return entries;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      entries.push(...placeholderEntries(child, `${path}.${key}`));
    }
  }
  return entries;
}

function uniqueMessages(messages) {
  return [...new Set(messages.filter(Boolean))];
}

function md(value, fallback = 'not provided') {
  const text = compact(value);
  return text || fallback;
}

function mdList(items, fallback = '- none') {
  const values = asArray(items).map((item) => compact(item)).filter(Boolean);
  return values.length ? values.map((item) => `- ${item}`).join('\n') : fallback;
}

function fieldLine(label, value) {
  return `- ${label}: ${md(value)}`;
}

function activityFieldLines(activity) {
  const fields = [
    ['Name', activity.name],
    ['Slug', activity.slug],
    ['Section', activity.section],
    ['Category', activity.category],
    ['Age range', activity.ageRange],
    ['Age min', activity.ageMin],
    ['Age max', activity.ageMax],
    ['Town/place', activity.town],
    ['Timing', activity.timing],
    ['Day of week', activity.dayOfWeek],
    ['Start time', activity.startTime],
    ['End time', activity.endTime],
    ['Cost', activity.cost],
    ['Status', activity.status],
    ['Beginner friendly', typeof activity.beginnerFriendly === 'boolean' ? String(activity.beginnerFriendly) : ''],
    ['Last verified', activity.lastVerified],
    ['Source URL', activity.sourceUrl],
    ['Contact URL', activity.contactUrl],
    ['Contact method', activity.contactMethod],
    ['Language', activity.language],
    ['Address', activity.address || activity.location?.address],
    ['Setting', activity.setting],
    ['Recurring', activity.recurring],
    ['Parent participation', activity.parentParticipation],
    ['Booking required', typeof activity.bookingRequired === 'boolean' ? String(activity.bookingRequired) : ''],
    ['Trial availability', activity.trialAvailability || activity.trial?.notes],
    ['Description', activity.description],
  ];
  const organizer = activity.organizer && typeof activity.organizer === 'object'
    ? [activity.organizer.name, activity.organizer.slug].filter(Boolean).join(' / ')
    : activity.organizer;
  return [
    ...fields.map(([label, value]) => fieldLine(label, value)),
    fieldLine('Organizer', organizer),
  ].join('\n');
}

function jsonBlock(value) {
  return ['```json', JSON.stringify(value ?? {}, null, 2), '```'].join('\n');
}

function categoryFor(candidate, warnings) {
  const category = compact(candidate.possibleCategory || candidate.category);
  if (!category) return '';
  const known = categories.find((item) => item.toLowerCase() === category.toLowerCase());
  if (!known) {
    warnings.push(`Unknown category "${category}" was not copied into activityDraft.category.`);
    return '';
  }
  return known;
}

function sectionFor(candidate, warnings) {
  const section = compact(candidate.possibleSection || candidate.section);
  if (!section) return '';
  const known = sections.find((item) => item.id === section || item.label.toLowerCase() === section.toLowerCase());
  if (!known) {
    warnings.push(`Unknown section "${section}" was not copied into activityDraft.section.`);
    return '';
  }
  return known.id;
}

function parseAgeRange(value, warnings) {
  const text = compact(value);
  if (!text) return { ageRange: '', ageMin: null, ageMax: null };
  const range = text.match(/(\d{1,2})\s*(?:-|–|to|bis)\s*(\d{1,2})/i);
  if (range) {
    const ageMin = Number(range[1]);
    const ageMax = Number(range[2]);
    return { ageRange: `${ageMin}-${ageMax}`, ageMin, ageMax };
  }
  const plus = text.match(/(\d{1,2})\s*\+/);
  if (plus) {
    const ageMin = Number(plus[1]);
    warnings.push(`Age range "${text}" is open-ended; ageMax needs manual completion.`);
    return { ageRange: text, ageMin, ageMax: null };
  }
  warnings.push(`Age range "${text}" could not be mapped safely.`);
  return { ageRange: text, ageMin: null, ageMax: null };
}

function draftPath(workspaceRoot, marketSlug, candidateId) {
  return join(workspaceRoot, 'drafts', marketSlug, `${candidateId}.json`);
}

function packetPath(workspaceRoot, marketSlug, draftId) {
  return join(workspaceRoot, 'apply-packets', marketSlug, `${normalizeId(draftId)}.md`);
}

function candidateId(candidate) {
  return normalizeId(candidate.id || candidate.candidateId || candidate.slug || candidate.title);
}

function candidateType(candidate) {
  return compact(candidate.candidateType || candidate.type || candidate.kind).toLowerCase();
}

function validateCandidateForDraft({ candidate, market, registrySources = [], live = liveActivities }) {
  const errors = [];
  const warnings = [];
  const id = candidateId(candidate);
  const type = candidateType(candidate);
  const placeId = compact(candidate.placeId || candidate.placeSlug || candidate.town || candidate.place);
  const sourceId = compact(candidate.sourceId || candidate.sourceRef);
  const title = compact(candidate.title || candidate.name);

  if (!id) errors.push('candidate id is required.');
  if (compact(candidate.status || candidate.reviewStatus) !== APPROVED_STATUS) {
    errors.push(`candidate status must be "${APPROVED_STATUS}".`);
  }
  if (type !== 'activity') {
    errors.push('candidateType must be "activity".');
  }
  if (!title) errors.push('candidate title is required.');
  const place = findPlace(market, placeId);
  if (!placeId) errors.push('candidate placeId is required.');
  else if (!place) errors.push(`placeId "${placeId}" does not exist in market "${market.id}".`);
  if (sourceId && !findSource(market, sourceId, registrySources)) {
    errors.push(`sourceId "${sourceId}" does not exist in market "${market.id}" sources or ${DEFAULT_SOURCE_REGISTRY}.`);
  }

  const slug = normalizeId(candidate.proposedSlug || candidate.slug || title);
  if (live.some((activity) => activity.slug === slug)) {
    warnings.push(`Possible live duplicate: activity slug "${slug}" already exists.`);
  }
  if (live.some((activity) => compact(activity.name).toLowerCase() === title.toLowerCase())) {
    warnings.push(`Possible live duplicate: activity name "${title}" already exists.`);
  }

  return { ok: errors.length === 0, errors, warnings, id, title, place, slug };
}

function buildReviewNotes(candidate, warnings) {
  const notes = [
    compact(candidate.reviewNotes),
    compact(candidate.notes),
    compact(candidate.description),
    compact(candidate.possibleSchedule) ? `Possible schedule: ${compact(candidate.possibleSchedule)}` : '',
    compact(candidate.possibleLocation) ? `Possible location: ${compact(candidate.possibleLocation)}` : '',
    compact(candidate.organizerName) ? `Possible organizer: ${compact(candidate.organizerName)}` : '',
    compact(candidate.possibleAgeRange) ? `Possible age range: ${compact(candidate.possibleAgeRange)}` : '',
  ].filter(Boolean);
  if (warnings.length) notes.push(`Warnings: ${warnings.join(' | ')}`);
  return notes.join('\n');
}

export function activityDraftFromCandidate({ candidate, market, place, registrySources = [], now = new Date(), live = liveActivities }) {
  const warnings = [];
  const title = compact(candidate.title || candidate.name);
  const slug = normalizeId(candidate.proposedSlug || candidate.slug || title);
  const category = categoryFor(candidate, warnings);
  const section = sectionFor(candidate, warnings);
  const ages = parseAgeRange(candidate.possibleAgeRange || candidate.ageRange, warnings);
  const source = findSource(market, candidate.sourceId || candidate.sourceRef, registrySources);
  const town = compact(place?.town || place?.name || candidate.town || candidate.place);
  const timing = compact(candidate.possibleSchedule || candidate.timing);
  const cost = compact(candidate.possibleCost || candidate.cost);
  const sourceUrl = compact(candidate.sourceUrl || source?.url);
  const contactUrl = compact(candidate.contactUrl || candidate.website || sourceUrl);
  const organizerName = compact(candidate.organizerName || source?.organizerName);
  const location = compact(candidate.possibleLocation || candidate.location || candidate.address);

  if (!section) warnings.push('Section needs manual selection.');
  if (!category) warnings.push('Category needs manual selection.');
  if (!ages.ageRange || ages.ageMin === null || ages.ageMax === null) warnings.push('Age range needs manual completion.');
  if (!timing) warnings.push('Schedule/timing needs manual completion.');
  if (!cost) warnings.push('Cost needs manual completion.');
  if (!sourceUrl) warnings.push('Source URL needs manual completion.');
  if (!organizerName) warnings.push('Organizer needs manual confirmation.');
  if (location && !town) warnings.push('Location is present but no known town/place could be mapped.');
  if (live.some((activity) => activity.slug === slug)) warnings.push(`Possible live duplicate: activity slug "${slug}" already exists.`);

  const activityDraft = {
    slug,
    name: title,
    section,
    category,
    ageRange: ages.ageRange,
    ageMin: ages.ageMin,
    ageMax: ages.ageMax,
    town,
    timing,
    cost,
    beginnerFriendly: candidate.beginnerFriendly === true,
    lastVerified: '',
    status: 'draft',
    sourceUrl,
    contactUrl,
    organizer: organizerName ? { name: organizerName, slug: normalizeId(organizerName) } : null,
  };

  if (location) activityDraft.address = location;
  if (compact(candidate.dayOfWeek)) activityDraft.dayOfWeek = compact(candidate.dayOfWeek);
  if (compact(candidate.startTime)) activityDraft.startTime = compact(candidate.startTime);
  if (compact(candidate.endTime)) activityDraft.endTime = compact(candidate.endTime);

  const missingFields = REQUIRED_ACTIVITY_FIELDS.filter((field) => {
    const value = activityDraft[field];
    if (field === 'beginnerFriendly') return typeof value !== 'boolean';
    return value === undefined || value === null || value === '';
  });

  return {
    draftId: `draft:${market.slug}:${candidateId(candidate)}`,
    sourceCandidateId: candidateId(candidate),
    marketId: market.id,
    placeId: compact(candidate.placeId || candidate.placeSlug || place?.id || place?.slug),
    status: missingFields.length ? 'needs_manual_completion' : 'draft',
    generatedAt: now.toISOString(),
    reviewNotes: buildReviewNotes(candidate, warnings),
    missingFields,
    warnings: [...new Set(warnings)],
    activityDraft,
  };
}

export async function createExpansionDrafts({
  workspaceDir = DEFAULT_WORKSPACE,
  sourceRegistryPath = DEFAULT_SOURCE_REGISTRY,
  marketId = '',
  candidateId: requestedCandidateId = '',
  all = false,
  overwrite = false,
  now = new Date(),
  live = liveActivities,
} = {}) {
  const workspace = await loadExpansionWorkspace({ workspaceDir });
  const registrySources = await readSourceRegistry(sourceRegistryPath);
  const markets = marketId
    ? workspace.markets.filter((market) => market.id === normalizeId(marketId) || market.slug === normalizeId(marketId))
    : workspace.markets;
  if (marketId && markets.length === 0) {
    throw new Error(`Market "${marketId}" was not found in ${workspace.root}.`);
  }
  if (!all && !requestedCandidateId) {
    throw new Error('Pass --candidate=<id> for one draft or --all for all approved activity candidates.');
  }

  const created = [];
  const skipped = [];
  const errors = [];

  for (const market of markets) {
    for (const candidate of asArray(market.candidates)) {
      const id = candidateId(candidate);
      if (requestedCandidateId && id !== normalizeId(requestedCandidateId)) continue;
      if (!all && !requestedCandidateId) continue;
      if (all && compact(candidate.status || candidate.reviewStatus) !== APPROVED_STATUS) {
        skipped.push({ marketId: market.id, candidateId: id || '<missing>', reason: 'not approved_for_manual_apply' });
        continue;
      }
      const validation = validateCandidateForDraft({ candidate, market, registrySources, live });
      if (!validation.ok) {
        errors.push({ marketId: market.id, candidateId: id || '<missing>', errors: validation.errors });
        continue;
      }
      const path = draftPath(workspace.root, market.slug, validation.id);
      if (existsSync(path) && !overwrite) {
        skipped.push({ marketId: market.id, candidateId: validation.id, path, reason: 'draft already exists' });
        continue;
      }
      const draft = activityDraftFromCandidate({
        candidate,
        market,
        place: validation.place,
        registrySources,
        now,
        live,
      });
      draft.warnings = [...new Set([...validation.warnings, ...draft.warnings])];
      draft.reviewNotes = buildReviewNotes(candidate, draft.warnings);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
      created.push({ marketId: market.id, candidateId: validation.id, path, draft });
    }
  }

  if (requestedCandidateId && created.length === 0 && errors.length === 0 && skipped.length === 0) {
    throw new Error(`Candidate "${requestedCandidateId}" was not found${marketId ? ` in market "${marketId}"` : ''}.`);
  }

  return { workspaceRoot: workspace.root, created, skipped, errors };
}

async function collectDraftFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDraftFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path);
    }
  }
  return files.sort();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = compact(keyFn(item), 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function buildDraftReport({ workspaceDir = DEFAULT_WORKSPACE } = {}) {
  const root = resolve(workspaceDir);
  const files = await collectDraftFiles(join(root, 'drafts'));
  const drafts = [];
  const readErrors = [];
  for (const file of files) {
    try {
      drafts.push({ path: file, draft: await readJson(file) });
    } catch (error) {
      readErrors.push({ path: file, error: error.message });
    }
  }

  const byMarket = countBy(drafts, (row) => row.draft.marketId);
  const byStatus = countBy(drafts, (row) => DRAFT_STATUSES.has(row.draft.status) ? row.draft.status : 'unknown');
  const missingRequired = drafts.filter((row) => asArray(row.draft.missingFields).length > 0);
  const duplicateWarnings = drafts.filter((row) => asArray(row.draft.warnings).some((warning) => /duplicate/i.test(warning)));
  const unknownCategory = drafts.filter((row) => !row.draft.activityDraft?.category || asArray(row.draft.warnings).some((warning) => /category/i.test(warning)));
  const missingOrganizer = drafts.filter((row) => !row.draft.activityDraft?.organizer);
  const missingAgeRange = drafts.filter((row) => !row.draft.activityDraft?.ageRange || row.draft.activityDraft?.ageMin === null || row.draft.activityDraft?.ageMax === null);
  const missingSchedule = drafts.filter((row) => !row.draft.activityDraft?.timing);
  const readyForManualApply = drafts.filter((row) => row.draft.status === 'ready_for_manual_apply');

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: root,
    totals: {
      drafts: drafts.length,
      readErrors: readErrors.length,
      missingRequired: missingRequired.length,
      duplicateWarnings: duplicateWarnings.length,
      unknownCategory: unknownCategory.length,
      missingOrganizer: missingOrganizer.length,
      missingAgeRange: missingAgeRange.length,
      missingSchedule: missingSchedule.length,
      readyForManualApply: readyForManualApply.length,
    },
    byMarket,
    byStatus,
    drafts: drafts.map((row) => ({
      path: row.path,
      draftId: row.draft.draftId,
      marketId: row.draft.marketId,
      sourceCandidateId: row.draft.sourceCandidateId,
      status: row.draft.status,
      name: row.draft.activityDraft?.name ?? '',
      missingFields: asArray(row.draft.missingFields),
      warnings: asArray(row.draft.warnings),
    })),
    readErrors,
  };
}

function checklistItemsFor(market) {
  return asArray(market?.sourceChecklist || market?.source_checklist || market?.checklist);
}

function validateMarketWorkspace(market) {
  const errors = [];
  const warnings = [];
  const places = asArray(market.places);
  const placeIds = new Set();
  const placeSlugs = new Set();

  if (!compact(market.id)) errors.push('market id is required.');
  if (!compact(market.name)) errors.push(`market "${market.id || '<unknown>'}" name is required.`);
  if (market.status && !MARKET_STATUSES.has(compact(market.status))) {
    warnings.push(`market "${market.id}" has non-standard status "${market.status}".`);
  }
  if (places.length === 0) warnings.push(`market "${market.id}" has no places.`);

  for (const place of places) {
    const id = normalizeId(place.id || place.placeId || place.slug || place.name);
    const slug = normalizeId(place.slug || place.id || place.name);
    if (!id) errors.push(`market "${market.id}" has a place without id.`);
    if (id && placeIds.has(id)) errors.push(`market "${market.id}" has duplicate place id "${id}".`);
    if (id) placeIds.add(id);
    if (!slug) errors.push(`market "${market.id}" has a place without slug.`);
    if (slug && placeSlugs.has(slug)) errors.push(`market "${market.id}" has duplicate place slug "${slug}".`);
    if (slug) placeSlugs.add(slug);
    if (!asArray(place.aliases).length && !Array.isArray(place.aliases)) {
      errors.push(`place "${id || slug}" aliases must be an array.`);
    }
    if (place.type && !PLACE_TYPES.has(compact(place.type))) {
      warnings.push(`place "${id || slug}" has non-standard type "${place.type}".`);
    }
    const parentPlaceId = compact(place.parentPlaceId);
    if (parentPlaceId && !placeIds.has(normalizeId(parentPlaceId)) && !places.some((candidate) => normalizeId(candidate.id || candidate.slug) === normalizeId(parentPlaceId))) {
      errors.push(`place "${id || slug}" references missing parentPlaceId "${parentPlaceId}".`);
    }
  }

  for (const item of checklistItemsFor(market)) {
    const itemId = compact(item.id || `${item.placeId}:${item.sourceType}`, '<unknown checklist item>');
    const placeId = normalizeId(item.placeId);
    const status = compact(item.status, 'missing');
    const url = compact(item.url);
    if (!item.sourceType) errors.push(`checklist item "${itemId}" is missing sourceType.`);
    else if (!CHECKLIST_SOURCE_TYPES.has(compact(item.sourceType))) {
      warnings.push(`checklist item "${itemId}" has non-standard sourceType "${item.sourceType}".`);
    }
    if (!placeId) errors.push(`checklist item "${itemId}" is missing placeId.`);
    else if (!placeIds.has(placeId)) errors.push(`checklist item "${itemId}" references missing placeId "${item.placeId}".`);
    if (!CHECKLIST_STATUSES.has(status)) errors.push(`checklist item "${itemId}" has invalid status "${status}".`);
    if (!url && status !== 'missing') errors.push(`checklist item "${itemId}" has status "${status}" but no url.`);
    if (url && !validHttpUrl(url)) errors.push(`checklist item "${itemId}" url "${url}" is not a valid http(s) URL.`);
  }

  return { errors, warnings };
}

export async function buildExpansionReport({ workspaceDir = DEFAULT_WORKSPACE } = {}) {
  const workspace = await loadExpansionWorkspace({ workspaceDir });
  const markets = workspace.markets.map((market) => {
    const validation = validateMarketWorkspace(market);
    const checklist = checklistItemsFor(market);
    return {
      id: market.id,
      slug: market.slug,
      name: market.name,
      status: compact(market.status, 'unknown'),
      path: market.path,
      places: asArray(market.places).length,
      activePlaces: asArray(market.places).filter((place) => place.active !== false).length,
      sources: asArray(market.sources).length,
      checklistItems: checklist.length,
      missingChecklistItems: checklist.filter((item) => compact(item.status, 'missing') === 'missing').length,
      candidates: asArray(market.candidates).length,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: workspace.root,
    totals: {
      markets: markets.length,
      places: markets.reduce((sum, market) => sum + market.places, 0),
      sourceChecklistItems: markets.reduce((sum, market) => sum + market.checklistItems, 0),
      missingChecklistItems: markets.reduce((sum, market) => sum + market.missingChecklistItems, 0),
      sources: markets.reduce((sum, market) => sum + market.sources, 0),
      candidates: markets.reduce((sum, market) => sum + market.candidates, 0),
      errors: markets.reduce((sum, market) => sum + market.errors.length, 0),
      warnings: markets.reduce((sum, market) => sum + market.warnings.length, 0),
    },
    markets,
  };
}

export function validateExpansionDraft({
  draft,
  path = '',
  workspace,
  registrySources = [],
  duplicateDraftIds = new Set(),
  live = liveActivities,
  liveOrganizerRows = liveOrganizers,
} = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const activityDraft = draftActivity(draft);
  const sectionIds = new Set(sections.map((section) => section.id));
  const marketId = normalizeId(draft?.marketId);
  const sourceCandidateId = normalizeId(draft?.sourceCandidateId);
  const draftId = compact(draft?.draftId);
  const status = compact(draft?.status, 'draft');
  const market = workspace?.marketById?.get(marketId) ?? null;
  const candidate = market ? findCandidate(market, sourceCandidateId) : null;
  const placeId = compact(draft?.placeId || activityDraft.placeId);
  const place = market ? findPlace(market, placeId) : null;
  const candidateSourceId = compact(candidate?.sourceId || candidate?.sourceRef);
  const source = candidateSourceId && market ? findSource(market, candidateSourceId, registrySources) : null;
  const liveOrganizerSlugs = new Set(asArray(liveOrganizerRows).map((organizer) => organizer.slug).filter(Boolean));

  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return {
      path,
      draftId: '',
      marketId: '',
      sourceCandidateId: '',
      status: 'unknown',
      errors: ['draft file must contain a JSON object.'],
      warnings: [],
      info: [],
      recommendation: 'needs_manual_completion',
      missingFields: [],
      possibleDuplicateActivityIds: [],
      name: '',
    };
  }

  if (!draftId) errors.push('draftId is required.');
  if (draftId && duplicateDraftIds.has(draftId)) errors.push(`duplicate draftId "${draftId}".`);
  if (!DRAFT_STATUSES.has(status)) errors.push(`draft status "${status}" is not supported.`);
  if (!marketId) errors.push('marketId is required.');
  else if (!market) errors.push(`marketId "${draft.marketId}" does not match an expansion market.`);
  if (!sourceCandidateId) errors.push('sourceCandidateId is required.');
  else if (market && !candidate) errors.push(`sourceCandidateId "${draft.sourceCandidateId}" does not match a candidate in market "${market.id}".`);
  if (!placeId) errors.push('placeId is required.');
  else if (market && !place) errors.push(`placeId "${placeId}" does not exist in market "${market.id}".`);
  if (!draft.activityDraft || typeof draft.activityDraft !== 'object' || Array.isArray(draft.activityDraft)) {
    errors.push('activityDraft object is required.');
  }
  if (candidateSourceId && market && !source) {
    errors.push(`candidate sourceId "${candidateSourceId}" does not exist in market "${market.id}" sources or ${DEFAULT_SOURCE_REGISTRY}.`);
  }

  for (const error of validateActivity(activityDraft, sectionIds)) {
    errors.push(`activityDraft: ${error}`);
  }

  const missingFields = uniqueMessages([
    ...asArray(draft.missingFields),
    ...REQUIRED_ACTIVITY_FIELDS.filter((field) => {
      const value = activityDraft[field];
      if (field === 'beginnerFriendly') return typeof value !== 'boolean';
      return value === undefined || value === null || value === '';
    }),
  ]);

  for (const field of missingFields) {
    if (!errors.some((error) => error.includes(`"${field}"`))) {
      errors.push(`activityDraft: missing required field "${field}".`);
    }
  }

  if (!activityDraft.sourceUrl) {
    errors.push('activityDraft.sourceUrl is required for manual apply readiness.');
  } else if (!validHttpUrl(activityDraft.sourceUrl)) {
    errors.push(`activityDraft.sourceUrl "${activityDraft.sourceUrl}" is not a valid http(s) URL.`);
  }
  if (activityDraft.contactUrl && !validHttpUrl(activityDraft.contactUrl)) {
    errors.push(`activityDraft.contactUrl "${activityDraft.contactUrl}" is not a valid http(s) URL.`);
  }
  if (activityDraft.category && !categories.includes(activityDraft.category)) {
    errors.push(`activityDraft.category "${activityDraft.category}" is unknown.`);
  }

  if (place && activityDraft.town && compact(place.town || place.name) !== compact(activityDraft.town)) {
    warnings.push(`activityDraft.town "${activityDraft.town}" differs from place "${placeId}" town "${compact(place.town || place.name)}".`);
  }
  if (activityDraft.town && !live.some((activity) => activity.town === activityDraft.town)) {
    warnings.push(`Town "${activityDraft.town}" is not present in current live activity data; confirm city/place setup before applying.`);
  }
  if (!activityDraft.organizer?.name) {
    warnings.push('Organizer name is missing.');
  } else if (activityDraft.organizer?.slug && !liveOrganizerSlugs.has(activityDraft.organizer.slug)) {
    warnings.push(`Organizer "${activityDraft.organizer.name}" does not currently exist in derived live organizer data; confirm before applying.`);
  }
  if (!activityDraft.contactUrl) warnings.push('Contact URL is missing.');
  if (!activityDraft.dayOfWeek) warnings.push('dayOfWeek is missing; calendar export quality may be lower.');
  if (!activityDraft.startTime) warnings.push('startTime is missing; calendar export quality may be lower.');
  if (!activityDraft.address && !activityDraft.location && !activityDraft.geo) warnings.push('Location/address detail is missing.');
  if (activityDraft.sourceUrl && genericHomepageUrl(activityDraft.sourceUrl)) {
    warnings.push(`Source URL "${activityDraft.sourceUrl}" looks like a generic homepage; prefer a specific activity page when available.`);
  }
  if (source?.url && activityDraft.sourceUrl && urlKey(source.url) === urlKey(activityDraft.sourceUrl)) {
    warnings.push('Source URL matches the registry/source homepage; confirm this is specific enough for manual apply.');
  }
  if (live.some((activity) => activity.slug === activityDraft.slug)) {
    warnings.push(`Possible live duplicate: activity slug "${activityDraft.slug}" already exists.`);
  }
  if (live.some((activity) => compact(activity.name).toLowerCase() === compact(activityDraft.name).toLowerCase())) {
    warnings.push(`Possible live duplicate: activity name "${activityDraft.name}" already exists.`);
  }
  if (compact(activityDraft.name).split(/\s+/).length < 2 || /^(kids?|children|course|activity|angebot)$/i.test(compact(activityDraft.name))) {
    warnings.push('Activity title is weak or generic; make it specific before applying.');
  }
  for (const warning of asArray(draft.warnings)) warnings.push(warning);

  const possibleDuplicateActivityIds = uniqueMessages([
    ...asArray(draft.possibleDuplicateActivityIds),
    ...asArray(activityDraft.possibleDuplicateActivityIds),
  ]);
  if (possibleDuplicateActivityIds.length) {
    warnings.push(`Possible duplicate activity id(s): ${possibleDuplicateActivityIds.join(', ')}.`);
  }

  const placeholders = placeholderEntries({ ...draft, activityDraft });
  for (const placeholder of placeholders) {
    warnings.push(`Placeholder detected at ${placeholder.path}: ${placeholder.reason}.`);
  }
  if (status === 'ready_for_manual_apply' && warnings.length) {
    warnings.push('Draft is marked ready_for_manual_apply but still has warnings to review.');
  }

  for (const [key, label] of CHECKLIST_ITEMS) {
    info.push(`${label}: ${checklistValue(draft, key) ? 'done' : 'not recorded'}`);
  }

  const uniqueErrors = uniqueMessages(errors);
  const uniqueWarnings = uniqueMessages(warnings);
  return {
    path,
    draftId,
    marketId: draft?.marketId ?? '',
    sourceCandidateId: draft?.sourceCandidateId ?? '',
    status,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
    info,
    recommendation: uniqueErrors.length === 0 ? 'ready_for_manual_apply' : 'needs_manual_completion',
    missingFields,
    possibleDuplicateActivityIds,
    name: activityDraft.name ?? '',
  };
}

export async function buildDraftReadinessReport({
  workspaceDir = DEFAULT_WORKSPACE,
  sourceRegistryPath = DEFAULT_SOURCE_REGISTRY,
  live = liveActivities,
  liveOrganizerRows = liveOrganizers,
} = {}) {
  const workspace = await loadExpansionWorkspace({ workspaceDir });
  const registrySources = await readSourceRegistry(sourceRegistryPath);
  const files = await collectDraftFiles(join(workspace.root, 'drafts'));
  const rows = [];
  const readErrors = [];

  for (const file of files) {
    try {
      rows.push({ path: file, draft: await readJson(file) });
    } catch (error) {
      readErrors.push({ path: file, error: error.message });
    }
  }

  const draftIdCounts = countBy(rows, (row) => row.draft?.draftId);
  const duplicateDraftIds = new Set(Object.entries(draftIdCounts)
    .filter(([id, count]) => id !== 'unknown' && count > 1)
    .map(([id]) => id));
  const validations = rows.map((row) => validateExpansionDraft({
    ...row,
    workspace,
    registrySources,
    duplicateDraftIds,
    live,
    liveOrganizerRows,
  }));

  const byStatus = countBy(validations, (validation) => DRAFT_STATUSES.has(validation.status) ? validation.status : 'unknown');
  const byRecommendation = countBy(validations, (validation) => validation.recommendation);
  const hasWarning = (pattern) => validations.filter((validation) => validation.warnings.some((warning) => pattern.test(warning))).length;
  const hasError = (pattern) => validations.filter((validation) => validation.errors.some((error) => pattern.test(error))).length;

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: workspace.root,
    totals: {
      drafts: validations.length,
      readErrors: readErrors.length,
      withErrors: validations.filter((validation) => validation.errors.length).length,
      withWarnings: validations.filter((validation) => validation.warnings.length).length,
      recommendedReady: validations.filter((validation) => validation.recommendation === 'ready_for_manual_apply').length,
      blockedMissingRequired: validations.filter((validation) => validation.missingFields.length || validation.errors.some((error) => /missing required field|required/.test(error))).length,
      possibleDuplicateActivityIds: validations.filter((validation) => validation.possibleDuplicateActivityIds.length || validation.warnings.some((warning) => /duplicate/i.test(warning))).length,
      missingOrganizer: hasWarning(/Organizer name is missing/i),
      missingSourceUrl: hasError(/sourceUrl.*required|sourceUrl.*valid/i),
      unknownCategory: hasError(/category.*unknown|unknown category/i),
      unknownPlace: hasError(/placeId .*does not exist|marketId .*does not match/i),
    },
    byStatus,
    byRecommendation,
    drafts: validations,
    readErrors,
  };
}

function contextForDraft({ draft, workspace, registrySources }) {
  const market = workspace.marketById.get(normalizeId(draft?.marketId)) ?? null;
  const candidate = market ? findCandidate(market, draft?.sourceCandidateId) : null;
  const place = market ? findPlace(market, draft?.placeId || draft?.activityDraft?.placeId) : null;
  const sourceId = compact(candidate?.sourceId || candidate?.sourceRef || draft?.sourceId || draft?.activityDraft?.sourceId);
  const source = sourceId && market ? findSource(market, sourceId, registrySources) : null;
  return { market, candidate, place, source, sourceId };
}

function renderSourceContext(source, sourceId) {
  if (!source && !sourceId) return '- none recorded';
  return [
    fieldLine('Source ID', sourceId || source?.id || source?.sourceId),
    fieldLine('Source name', source?.organizerName || source?.name),
    fieldLine('Source type', source?.sourceType || source?.type),
    fieldLine('Source URL', source?.url || source?.sourceUrl),
    fieldLine('Trust level', source?.trustLevel),
    fieldLine('Last checked', source?.lastChecked || source?.checkedAt),
    fieldLine('Source notes', source?.notes),
  ].join('\n');
}

function renderCandidateContext(candidate) {
  if (!candidate) return '- none recorded';
  return [
    fieldLine('Candidate ID', candidate.id || candidate.candidateId),
    fieldLine('Original title', candidate.title || candidate.name),
    fieldLine('Candidate organizer', candidate.organizerName),
    fieldLine('Possible category', candidate.possibleCategory || candidate.category),
    fieldLine('Possible age range', candidate.possibleAgeRange || candidate.ageRange),
    fieldLine('Possible schedule', candidate.possibleSchedule || candidate.timing),
    fieldLine('Possible location', candidate.possibleLocation || candidate.location || candidate.address),
    fieldLine('Confidence', candidate.confidence),
    fieldLine('Review notes', candidate.reviewNotes || candidate.notes),
    fieldLine('Source URL', candidate.sourceUrl),
  ].join('\n');
}

export function renderApplyPacketMarkdown({ draft, validation, context, generatedAt = new Date() } = {}) {
  const activity = draftActivity(draft);
  const duplicateWarnings = asArray(validation?.warnings).filter((warning) => /duplicate/i.test(warning));
  const possibleDuplicateActivityIds = uniqueMessages([
    ...asArray(draft?.possibleDuplicateActivityIds),
    ...asArray(activity.possibleDuplicateActivityIds),
    ...asArray(validation?.possibleDuplicateActivityIds),
  ]);
  const title = compact(activity.name || draft?.sourceCandidateId || draft?.draftId, 'Untitled activity draft');
  const market = context?.market;
  const place = context?.place;

  return [
    `# Manual Apply Packet: ${title}`,
    '',
    'This packet is a local review aid only. It is not a live activity, does not write Supabase, and does not publish anything.',
    '',
    '## Status',
    fieldLine('Draft ID', draft?.draftId),
    fieldLine('Source candidate ID', draft?.sourceCandidateId),
    fieldLine('Market', market ? `${market.name} (${market.id})` : draft?.marketId),
    fieldLine('Place', place ? `${place.name || place.id} (${place.id || place.slug || draft?.placeId})` : draft?.placeId),
    fieldLine('Current draft status', draft?.status),
    fieldLine('Packet generated at', generatedAt.toISOString()),
    fieldLine('Draft generated at', draft?.generatedAt),
    fieldLine('Readiness recommendation', validation?.recommendation),
    '',
    '## Activity Draft',
    activityFieldLines(activity),
    '',
    '### Activity Draft JSON',
    jsonBlock(activity),
    '',
    '## Source Context',
    renderSourceContext(context?.source, context?.sourceId),
    '',
    '## Candidate Context',
    renderCandidateContext(context?.candidate),
    '',
    '## Duplicate Check',
    possibleDuplicateActivityIds.length
      ? mdList(possibleDuplicateActivityIds)
      : '- No explicit possibleDuplicateActivityIds recorded.',
    duplicateWarnings.length
      ? ['', 'Duplicate warnings:', mdList(duplicateWarnings)].join('\n')
      : '',
    '',
    'Manually inspect possible duplicates before applying this draft.',
    '',
    '## Missing Fields',
    mdList(uniqueMessages([
      ...asArray(draft?.missingFields),
      ...asArray(validation?.missingFields),
    ])),
    '',
    '## Warnings',
    mdList(uniqueMessages([
      ...asArray(draft?.warnings),
      ...asArray(validation?.warnings),
    ])),
    '',
    '## Readiness Errors',
    mdList(validation?.errors),
    '',
    '## Manual Review Checklist',
    '- [ ] Source URL opens and is still current',
    '- [ ] Activity is still active',
    '- [ ] Organizer name verified',
    '- [ ] Location/address verified',
    '- [ ] Place/town assignment verified',
    '- [ ] Category verified',
    '- [ ] Age range verified',
    '- [ ] Schedule verified',
    '- [ ] Price/cost verified',
    '- [ ] Duplicate check completed',
    '- [ ] German copy checked',
    '- [ ] English copy checked if applicable',
    '- [ ] Ready to manually add through trusted workflow',
    '',
    '## Manual Apply Notes',
    '',
    '',
  ].join('\n');
}

export async function createApplyPackets({
  workspaceDir = DEFAULT_WORKSPACE,
  sourceRegistryPath = DEFAULT_SOURCE_REGISTRY,
  marketId = '',
  draftId = '',
  includeNotReady = false,
  overwrite = false,
  now = new Date(),
  live = liveActivities,
  liveOrganizerRows = liveOrganizers,
} = {}) {
  const workspace = await loadExpansionWorkspace({ workspaceDir });
  const registrySources = await readSourceRegistry(sourceRegistryPath);
  const files = await collectDraftFiles(join(workspace.root, 'drafts'));
  const rows = [];
  const readErrors = [];
  for (const file of files) {
    try {
      rows.push({ path: file, draft: await readJson(file) });
    } catch (error) {
      readErrors.push({ path: file, error: error.message });
    }
  }

  const draftIdCounts = countBy(rows, (row) => row.draft?.draftId);
  const duplicateDraftIds = new Set(Object.entries(draftIdCounts)
    .filter(([id, count]) => id !== 'unknown' && count > 1)
    .map(([id]) => id));
  const requestedMarketId = normalizeId(marketId);
  const requestedDraftId = compact(draftId);
  const generated = [];
  const skipped = [];
  const errors = [...readErrors.map((error) => ({ path: error.path, errors: [error.error] }))];

  for (const row of rows) {
    const draft = row.draft;
    const normalizedMarketId = normalizeId(draft?.marketId);
    const idsForMatch = new Set([
      compact(draft?.draftId),
      normalizeId(draft?.draftId),
      compact(draft?.sourceCandidateId),
      normalizeId(draft?.sourceCandidateId),
    ].filter(Boolean));
    if (requestedMarketId && normalizedMarketId !== requestedMarketId) continue;
    if (requestedDraftId && !idsForMatch.has(requestedDraftId) && !idsForMatch.has(normalizeId(requestedDraftId))) continue;

    const context = contextForDraft({ draft, workspace, registrySources });
    const validation = validateExpansionDraft({
      draft,
      path: row.path,
      workspace,
      registrySources,
      duplicateDraftIds,
      live,
      liveOrganizerRows,
    });
    if (draft?.status !== 'ready_for_manual_apply' && !includeNotReady) {
      skipped.push({ draftId: draft?.draftId || row.path, reason: 'not ready_for_manual_apply', path: row.path });
      continue;
    }

    const marketSlug = context.market?.slug || normalizeId(draft?.marketId || 'unknown-market');
    const outPath = packetPath(workspace.root, marketSlug, draft?.draftId || draft?.sourceCandidateId || fileURLToPathName(row.path));
    if (existsSync(outPath) && !overwrite) {
      skipped.push({ draftId: draft?.draftId || row.path, reason: 'packet already exists', path: outPath });
      continue;
    }

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, renderApplyPacketMarkdown({ draft, validation, context, generatedAt: now }), 'utf8');
    generated.push({ draftId: draft?.draftId || row.path, marketId: draft?.marketId || '', path: outPath, validation });
  }

  if (requestedDraftId && generated.length === 0 && skipped.length === 0 && errors.length === 0) {
    throw new Error(`Draft "${draftId}" was not found${marketId ? ` in market "${marketId}"` : ''}.`);
  }

  return {
    workspaceRoot: workspace.root,
    outputRoot: join(workspace.root, 'apply-packets'),
    generated,
    skipped,
    errors,
    summary: {
      generated: generated.length,
      skippedNotReady: skipped.filter((item) => item.reason === 'not ready_for_manual_apply').length,
      skippedExisting: skipped.filter((item) => item.reason === 'packet already exists').length,
      missingFields: generated.filter((item) => item.validation.missingFields.length).length,
      duplicateWarnings: generated.filter((item) => item.validation.warnings.some((warning) => /duplicate/i.test(warning))).length,
    },
  };
}

function renderCounts(counts) {
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, value]) => `- ${key}: ${value}`) : ['- none'];
}

export function renderDraftReport(report) {
  const lines = [
    'KinderRadar Expansion Draft Report',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.workspaceRoot}`,
    '',
    `Summary: ${report.totals.drafts} draft(s), ${report.totals.readyForManualApply} ready for manual apply.`,
    '',
    'Drafts by market:',
    ...renderCounts(report.byMarket),
    '',
    'Drafts by status:',
    ...renderCounts(report.byStatus),
    '',
    'Issues:',
    `- Missing required fields: ${report.totals.missingRequired}`,
    `- Duplicate warnings: ${report.totals.duplicateWarnings}`,
    `- Unknown/missing category: ${report.totals.unknownCategory}`,
    `- Missing organizer: ${report.totals.missingOrganizer}`,
    `- Missing age range: ${report.totals.missingAgeRange}`,
    `- Missing schedule: ${report.totals.missingSchedule}`,
    '',
    'Drafts:',
  ];

  if (report.drafts.length === 0) {
    lines.push('- none');
  } else {
    for (const draft of report.drafts) {
      const missing = draft.missingFields.length ? ` | missing: ${draft.missingFields.join(', ')}` : '';
      const warnings = draft.warnings.length ? ` | warnings: ${draft.warnings.length}` : '';
      lines.push(`- [${draft.status}] ${draft.name || draft.sourceCandidateId} (${draft.marketId}/${draft.sourceCandidateId})${missing}${warnings}`);
    }
  }

  if (report.readErrors.length) {
    lines.push('', 'Read errors:', ...report.readErrors.map((error) => `- ${error.path}: ${error.error}`));
  }

  lines.push('', 'Report only. This command does not modify drafts, live activity data, Supabase, or generated public pages.');
  return `${lines.join('\n')}\n`;
}

export function renderExpansionReport(report) {
  const lines = [
    'KinderRadar Expansion Workspace Report',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.workspaceRoot}`,
    '',
    `Summary: ${report.totals.markets} market(s), ${report.totals.places} place(s), ${report.totals.sourceChecklistItems} checklist item(s).`,
    `Missing checklist items: ${report.totals.missingChecklistItems}`,
    `Sources: ${report.totals.sources}`,
    `Candidates: ${report.totals.candidates}`,
    `Errors: ${report.totals.errors}`,
    `Warnings: ${report.totals.warnings}`,
    '',
    'Markets:',
  ];

  if (report.markets.length === 0) {
    lines.push('- none');
  } else {
    for (const market of report.markets) {
      lines.push(`- [${market.status}] ${market.name} (${market.id}): ${market.places} place(s), ${market.checklistItems} checklist item(s), ${market.candidates} candidate(s)`);
      for (const error of market.errors) lines.push(`  error: ${error}`);
      for (const warning of market.warnings) lines.push(`  warning: ${warning}`);
    }
  }

  lines.push('', 'Report only. This command does not modify live activity data, Supabase, drafts, packets, or generated public pages.');
  return `${lines.join('\n')}\n`;
}

export function renderDraftReadinessReport(report) {
  const lines = [
    'KinderRadar Expansion Draft Readiness Report',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.workspaceRoot}`,
    '',
    `Summary: ${report.totals.drafts} draft(s), ${report.totals.recommendedReady} recommended ready, ${report.totals.withErrors} with errors, ${report.totals.withWarnings} with warnings.`,
    '',
    'Drafts by status:',
    ...renderCounts(report.byStatus),
    '',
    'Drafts by recommendation:',
    ...renderCounts(report.byRecommendation),
    '',
    'Readiness issues:',
    `- Blocked by missing/required fields: ${report.totals.blockedMissingRequired}`,
    `- Possible duplicates: ${report.totals.possibleDuplicateActivityIds}`,
    `- Missing organizer: ${report.totals.missingOrganizer}`,
    `- Missing/invalid source URL: ${report.totals.missingSourceUrl}`,
    `- Unknown category: ${report.totals.unknownCategory}`,
    `- Unknown place/market: ${report.totals.unknownPlace}`,
    '',
    'Drafts:',
  ];

  if (report.drafts.length === 0) {
    lines.push('- none');
  } else {
    for (const draft of report.drafts) {
      lines.push(`- [${draft.recommendation}] ${draft.name || draft.sourceCandidateId || draft.draftId || 'unnamed draft'} (${draft.marketId || 'unknown market'}/${draft.sourceCandidateId || 'unknown candidate'})`);
      if (draft.errors.length) {
        lines.push(...draft.errors.map((error) => `  error: ${error}`));
      }
      if (draft.warnings.length) {
        lines.push(...draft.warnings.map((warning) => `  warning: ${warning}`));
      }
      if (!draft.errors.length && !draft.warnings.length) {
        lines.push('  ok: no readiness errors or warnings.');
      }
    }
  }

  if (report.readErrors.length) {
    lines.push('', 'Read errors:', ...report.readErrors.map((error) => `- ${error.path}: ${error.error}`));
  }

  lines.push('', 'Read-only validation. This command does not modify drafts, live activity data, Supabase, or generated public pages.');
  return `${lines.join('\n')}\n`;
}

function renderCreateResult(result) {
  const lines = [
    'KinderRadar Expansion Draft Create',
    `Workspace: ${result.workspaceRoot}`,
    '',
    `Created: ${result.created.length}`,
    ...result.created.map((item) => `- ${item.marketId}/${item.candidateId}: ${item.path}`),
    '',
    `Skipped: ${result.skipped.length}`,
    ...(result.skipped.length ? result.skipped.map((item) => `- ${item.marketId}/${item.candidateId}: ${item.reason}`) : ['- none']),
    '',
    `Errors: ${result.errors.length}`,
    ...(result.errors.length ? result.errors.map((item) => `- ${item.marketId}/${item.candidateId}: ${item.errors.join('; ')}`) : ['- none']),
    '',
    'Drafts only. This command does not modify live activity data, write Supabase, publish, deploy, scrape, or use AI extraction.',
  ];
  return `${lines.join('\n')}\n`;
}

function renderApplyPacketResult(result) {
  const lines = [
    'KinderRadar Expansion Manual Apply Packets',
    `Workspace: ${result.workspaceRoot}`,
    `Output: ${result.outputRoot}`,
    '',
    `Generated: ${result.generated.length}`,
    ...(result.generated.length ? result.generated.map((item) => `- ${item.marketId}/${item.draftId}: ${item.path}`) : ['- none']),
    '',
    `Skipped: ${result.skipped.length}`,
    ...(result.skipped.length ? result.skipped.map((item) => `- ${item.draftId}: ${item.reason}`) : ['- none']),
    '',
    `Errors: ${result.errors.length}`,
    ...(result.errors.length ? result.errors.map((item) => `- ${item.path ?? item.draftId ?? 'draft'}: ${item.errors.join('; ')}`) : ['- none']),
    '',
    'Summary:',
    `- Packets generated: ${result.summary.generated}`,
    `- Skipped not ready: ${result.summary.skippedNotReady}`,
    `- Skipped existing: ${result.summary.skippedExisting}`,
    `- Generated packets with missing fields: ${result.summary.missingFields}`,
    `- Generated packets with duplicate warnings: ${result.summary.duplicateWarnings}`,
    '',
    'Packets only. This command does not modify live activity data, write Supabase, publish, deploy, scrape, or auto-apply anything.',
  ];
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/expansion-drafts.mjs workspace-report [--workspace=expansion] [--json]',
    '  node scripts/expansion-drafts.mjs create --candidate=<id> [--market=<id>] [--workspace=expansion] [--source-registry=data/source-registry.json] [--overwrite]',
    '  node scripts/expansion-drafts.mjs create --all [--market=<id>] [--workspace=expansion] [--source-registry=data/source-registry.json] [--overwrite]',
    '  node scripts/expansion-drafts.mjs report [--workspace=expansion] [--json]',
    '  node scripts/expansion-drafts.mjs validate [--workspace=expansion] [--source-registry=data/source-registry.json] [--json]',
    '  node scripts/expansion-drafts.mjs apply-packet [--market=<id>] [--draft=<draft-id>] [--workspace=expansion] [--source-registry=data/source-registry.json] [--include-not-ready] [--overwrite]',
    '',
    'Reads expansion market/candidate/draft JSON files and writes local drafts or Markdown packets only.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    return;
  }
  const command = args[0] || 'report';
  const workspaceDir = arg(args, 'workspace', DEFAULT_WORKSPACE);

  if (command === 'workspace-report') {
    const report = await buildExpansionReport({ workspaceDir });
    if (hasFlag(args, '--json') || arg(args, 'format') === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderExpansionReport(report));
    }
    return;
  }

  if (command === 'create') {
    const result = await createExpansionDrafts({
      workspaceDir,
      sourceRegistryPath: arg(args, 'source-registry', DEFAULT_SOURCE_REGISTRY),
      marketId: arg(args, 'market'),
      candidateId: arg(args, 'candidate'),
      all: hasFlag(args, '--all'),
      overwrite: hasFlag(args, '--overwrite'),
    });
    process.stdout.write(renderCreateResult(result));
    if (result.errors.length > 0) process.exitCode = 1;
    return;
  }

  if (command === 'report') {
    const report = await buildDraftReport({ workspaceDir });
    if (hasFlag(args, '--json') || arg(args, 'format') === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderDraftReport(report));
    }
    return;
  }

  if (command === 'validate') {
    const report = await buildDraftReadinessReport({
      workspaceDir,
      sourceRegistryPath: arg(args, 'source-registry', DEFAULT_SOURCE_REGISTRY),
    });
    if (hasFlag(args, '--json') || arg(args, 'format') === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderDraftReadinessReport(report));
    }
    return;
  }

  if (command === 'apply-packet') {
    const result = await createApplyPackets({
      workspaceDir,
      sourceRegistryPath: arg(args, 'source-registry', DEFAULT_SOURCE_REGISTRY),
      marketId: arg(args, 'market'),
      draftId: arg(args, 'draft'),
      includeNotReady: hasFlag(args, '--include-not-ready'),
      overwrite: hasFlag(args, '--overwrite'),
    });
    process.stdout.write(renderApplyPacketResult(result));
    if (result.errors.length > 0) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown expansion draft command "${command}".`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
