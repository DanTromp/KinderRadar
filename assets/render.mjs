// Pure rendering helpers for My Kids Radar.
// Produces both HTML strings (used by the static generator) and DOM nodes
// (used by the in-browser script). Browser-only code paths are guarded so
// this module can be imported under Node for tests and build-time use.
//
// Translation strategy: every user-visible string is emitted with the
// English text inline AND a `data-i18n` attribute (or `data-i18n-attr` for
// attribute translations). The runtime in /assets/i18n.js swaps the text
// when the user toggles the language. This keeps SSR output usable without
// JS while letting us add German translations entirely via JSON files.

const MS_PER_DAY = 86_400_000;

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function daysSince(isoDate, now = new Date()) {
  if (typeof isoDate !== 'string') return null;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

// Trust/freshness classification driven by lastVerified + status.
// Returns { tone, label, i18nKey, i18nParams } so consumers can emit a
// `data-i18n` attribute alongside the English label.
export function freshnessBadge(listing, now = new Date()) {
  if (listing?.status === 'reported-closed') {
    return { tone: 'closed', label: 'Reported closed', i18nKey: 'freshness.closed', i18nParams: null };
  }
  const days = daysSince(listing?.lastVerified, now);
  if (days === null) {
    return { tone: 'stale', label: 'Verification unknown', i18nKey: 'freshness.unknown', i18nParams: null };
  }
  if (days < 30) {
    const i18nKey = days === 1 ? 'freshness.fresh.one' : 'freshness.fresh.other';
    const label = `Verified ${days} day${days === 1 ? '' : 's'} ago`;
    return { tone: 'fresh', label, i18nKey, i18nParams: { days } };
  }
  if (days <= 90) {
    return { tone: 'neutral', label: `Verified ${days} days ago`, i18nKey: 'freshness.neutral', i18nParams: { days } };
  }
  return { tone: 'stale', label: 'Needs update', i18nKey: 'freshness.stale', i18nParams: null };
}

export function freshnessCoverage(listings, now = new Date()) {
  const items = Array.isArray(listings) ? listings : [];
  let total = 0;
  let fresh30 = 0;
  let checked90 = 0;
  let stale = 0;

  for (const listing of items) {
    if (!listing || listing.status === 'reported-closed') continue;
    total += 1;
    const days = daysSince(listing.lastVerified, now);
    if (days !== null && days < 30) fresh30 += 1;
    if (days !== null && days <= 90) checked90 += 1;
    else stale += 1;
  }

  const percent = (value) => (total ? Math.round((value / total) * 100) : 0);
  return {
    total,
    fresh30,
    checked90,
    stale,
    fresh30Pct: percent(fresh30),
    checked90Pct: percent(checked90),
  };
}

// verifierLabel returns { label, i18nKey } for known values, null otherwise.
export function verifierLabel(verifiedBy) {
  switch (verifiedBy) {
    case 'organizer': return { label: 'Organizer submitted', i18nKey: 'enum.verifier.organizer' };
    case 'parent': return { label: 'Parent confirmed', i18nKey: 'enum.verifier.parent' };
    case 'editor': return { label: 'Editor curated', i18nKey: 'enum.verifier.editor' };
    default: return null;
  }
}

export function sourceSignal(listing) {
  const url = String(listing?.sourceUrl ?? '').trim();
  if (/^https?:\/\//i.test(url)) {
    return { tone: 'linked', label: 'Public source linked', i18nKey: 'trust.source.linked' };
  }
  return { tone: 'missing', label: 'Source still needed', i18nKey: 'trust.source.missing' };
}

export function confidenceSignal(listing, now = new Date()) {
  if (listing?.status === 'reported-closed') {
    return { tone: 'watch', label: 'Reported closed', i18nKey: 'trust.confidence.closed' };
  }

  const days = daysSince(listing?.lastVerified, now);
  const source = sourceSignal(listing);
  if (source.tone === 'missing' || days === null) {
    return { tone: 'caution', label: 'Needs more proof', i18nKey: 'trust.confidence.low' };
  }
  if (days <= 30 && listing?.verifiedBy === 'organizer') {
    return { tone: 'strong', label: 'High confidence', i18nKey: 'trust.confidence.high' };
  }
  if (days <= 90) {
    return { tone: 'good', label: 'Solid confidence', i18nKey: 'trust.confidence.medium' };
  }
  return { tone: 'caution', label: 'Needs re-check', i18nKey: 'trust.confidence.watch' };
}

// Escape for safe interpolation into HTML text and attribute contexts.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizedAccessibility(listing) {
  const raw = listing?.accessibility;
  if (!raw) return null;

  if (typeof raw === 'string') {
    const notes = raw.trim();
    return notes ? { fields: [], notes } : null;
  }

  if (!isPlainObject(raw)) return null;

  const fields = [
    ['wheelchairAccessible', 'Wheelchair accessible', 'accessibility.wheelchairAccessible'],
    ['strollerFriendly', 'Stroller friendly', 'accessibility.strollerFriendly'],
    ['parkingNearby', 'Parking nearby', 'accessibility.parkingNearby'],
    ['publicTransportNearby', 'Public transport nearby', 'accessibility.publicTransportNearby'],
    ['indoorAccess', 'Indoor access', 'accessibility.indoorAccess'],
  ]
    .filter(([key]) => raw[key] === true)
    .map(([, label, i18nKey]) => ({ label, i18nKey }));

  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
  if (fields.length === 0 && !notes) return null;
  return { fields, notes };
}

export function normalizedLocation(listing) {
  const location = isPlainObject(listing?.location) ? listing.location : {};
  const geo = isPlainObject(listing?.geo) ? listing.geo : {};
  const address = String(listing?.address ?? location.address ?? '').trim();
  const lat = listing?.latitude ?? location.latitude ?? geo.lat;
  const lng = listing?.longitude ?? location.longitude ?? geo.lng;
  const hasCoordinates = typeof lat === 'number' && typeof lng === 'number';
  const accuracy = String(listing?.locationAccuracy ?? location.accuracy ?? geo.accuracy ?? '').trim();

  if (!address && !hasCoordinates && !accuracy) return null;
  return {
    address,
    latitude: hasCoordinates ? lat : null,
    longitude: hasCoordinates ? lng : null,
    locationAccuracy: accuracy,
  };
}

function tagInfoForSection(section, sections) {
  const found = sections.find((s) => s.id === section);
  if (!found) return { label: 'Activity', i18nKey: null };
  return { label: found.tag, i18nKey: `section.${found.id}.tag` };
}

// Helpers for emitting the data-i18n + data-i18n-params attribute pair.
function i18nAttrs(key, params) {
  if (!key) return '';
  let out = ` data-i18n="${escapeHtml(key)}"`;
  if (params) out += ` data-i18n-params="${escapeHtml(JSON.stringify(params))}"`;
  return out;
}

// Render a free-text value that may be either a plain string or
// { en, de }. Returns the English HTML-escaped text and the data-i18n-text-*
// attributes needed to translate it at runtime.
function freeText(value) {
  if (value == null) return { en: '', attrs: '' };
  if (typeof value === 'object' && (value.en !== undefined || value.de !== undefined)) {
    const en = value.en ?? value.de ?? '';
    let attrs = ` data-i18n-text-en="${escapeHtml(en)}"`;
    if (value.de) attrs += ` data-i18n-text-de="${escapeHtml(value.de)}"`;
    return { en: escapeHtml(en), attrs };
  }
  return { en: escapeHtml(value), attrs: '' };
}

// Render an enum-coded value as a <span> carrying both the English text and
// the i18n key. `prefix` is the JSON key prefix (e.g. "enum.recurring").
// When the value isn't a known enum member (e.g. compound days like
// "Monday-Friday"), we emit plain escaped text so we don't reference a
// missing translation key.
const KNOWN_ENUMS = {
  'enum.recurring': new Set(['weekly', 'monthly', 'one-off']),
  'enum.setting': new Set(['indoor', 'outdoor', 'mixed']),
  'enum.parentParticipation': new Set(['required', 'optional', 'none']),
  'enum.contactMethod': new Set(['email', 'phone', 'form', 'whatsapp']),
  'enum.language': new Set(['de', 'en']),
  'enum.dayOfWeek': new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  'enum.category': new Set(['Sports', 'Arts & crafts', 'Family outing', 'Nature', 'Holiday camp', 'STEM', 'Swimming', 'Music']),
  'enum.status': new Set(['active', 'needs-update', 'reported-closed']),
};

function enumSpan(prefix, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';
  const known = KNOWN_ENUMS[prefix];
  if (known && !known.has(rawValue)) {
    return escapeHtml(rawValue);
  }
  const key = `${prefix}.${rawValue}`;
  return `<span${i18nAttrs(key)}>${escapeHtml(rawValue)}</span>`;
}

function suggestUpdateUrl(listing, repoSlug) {
  // GitHub Issue template prefill. repoSlug like "owner/name".
  const base = repoSlug
    ? `https://github.com/${repoSlug}/issues/new`
    : '#';
  const params = new URLSearchParams({
    template: 'suggest-update.yml',
    title: `[Update] ${listing.name}`,
    slug: listing.slug ?? '',
    activity: listing.name ?? '',
    town: listing.town ?? '',
  });
  return `${base}?${params.toString()}`;
}

// Build a single listing card as an HTML string. Used both at build time
// (static generation) and at runtime (innerHTML hydration).
export function renderListingHtml(listing, {
  sections = [],
  repoSlug = '',
  activityHrefPrefix = '/activities',
} = {}) {
  const tagInfo = tagInfoForSection(listing.section, sections);
  const badge = freshnessBadge(listing);
  const verifier = verifierLabel(listing.verifiedBy);
  const source = sourceSignal(listing);
  const confidence = confidenceSignal(listing);
  const closed = badge.tone === 'closed';

  const dataAttrs = [
    ['data-slug', listing.slug ?? ''],
    ['data-section', listing.section ?? ''],
    ['data-age-min', String(listing.ageMin ?? 0)],
    ['data-age-max', String(listing.ageMax ?? 99)],
    ['data-town', listing.town ?? ''],
    ['data-category', listing.category ?? ''],
    ['data-beginner-friendly', String(Boolean(listing.beginnerFriendly))],
    ['data-day-of-week', listing.dayOfWeek ?? ''],
    ['data-start-time', listing.startTime ?? ''],
    ['data-end-time', listing.endTime ?? ''],
    ['data-recurring', listing.recurring ?? ''],
    ['data-price-free', String(Boolean(listing.price?.free))],
    ['data-price-unit', listing.price?.unit ?? ''],
    ['data-trial-available', String(Boolean(listing.trial?.available ?? listing.trialAvailability))],
    ['data-booking-required', String(Boolean(listing.bookingRequired))],
    ['data-setting', listing.setting ?? ''],
    ['data-parent-participation', listing.parentParticipation ?? ''],
    ['data-language', listing.language ?? ''],
    ['data-status', listing.status ?? 'active'],
    ['data-last-verified', listing.lastVerified ?? ''],
  ].map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');

  const closedBanner = closed
    ? `<p class="status-banner" role="status"${i18nAttrs('activity.closedBanner')}>This activity was reported closed. Please verify before going.</p>`
    : '';

  const trustCues = [
    `<span class="trust-pill trust-pill-${escapeHtml(confidence.tone)}"${i18nAttrs(confidence.i18nKey)}>${escapeHtml(confidence.label)}</span>`,
    `<span class="trust-pill trust-pill-${escapeHtml(source.tone)}"${i18nAttrs(source.i18nKey)}>${escapeHtml(source.label)}</span>`,
    verifier ? `<span class="trust-pill trust-pill-verifier"${i18nAttrs(verifier.i18nKey)}>${escapeHtml(verifier.label)}</span>` : '',
  ].filter(Boolean).join('');

  const nameText = freeText(listing.name);
  const timingText = freeText(listing.timing);
  const costText = freeText(listing.cost);
  const townText = freeText(listing.town);

  return `<article class="listing" ${dataAttrs}>
      <div class="listing-header">
        <span class="listing-tag"${i18nAttrs(tagInfo.i18nKey)}>${escapeHtml(tagInfo.label)}</span>
        <span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}"${i18nAttrs(badge.i18nKey, badge.i18nParams)}>${escapeHtml(badge.label)}</span>
      </div>
      ${closedBanner}
      <h3><a class="text-link" href="${escapeHtml(activityHrefPrefix)}/${escapeHtml(listing.slug)}/"${nameText.attrs}>${nameText.en}</a></h3>
      <div class="listing-facts">
        <span>${enumSpan('enum.category', listing.category)}</span>
        <span>${escapeHtml(listing.ageRange)}</span>
        <span${townText.attrs}>${townText.en}</span>
      </div>
      <div class="trust-cues">${trustCues}</div>
      <p><strong${i18nAttrs('field.when')}>When:</strong> <span${timingText.attrs}>${timingText.en}</span></p>
      <p><strong${i18nAttrs('field.cost')}>Cost:</strong> <span${costText.attrs}>${costText.en}</span></p>
      <p class="listing-actions">
        <a class="text-link" href="${escapeHtml(activityHrefPrefix)}/${escapeHtml(listing.slug)}/" data-i18n="listing.viewDetails">View details</a>
        <button type="button" class="text-link muted-link save-button" data-save-activity="${escapeHtml(listing.slug)}" aria-pressed="false"><span data-save-label data-i18n="shortlist.save">Save</span></button>
        <button type="button" class="text-link muted-link calendar-button" data-export-calendar="${escapeHtml(listing.slug)}" data-i18n="activity.calendar.export">Add to calendar</button>
        <a class="text-link muted-link" href="${escapeHtml(suggestUpdateUrl(listing, repoSlug))}" rel="noopener noreferrer" data-analytics="suggest_update_click"${i18nAttrs('listing.suggestUpdate')}>Suggest an update</a>
      </p>
    </article>`;
}

// Build a full section panel (heading + grid of listings) as HTML.
export function renderSectionHtml(section, listings, {
  sections = [],
  repoSlug = '',
  activityHrefPrefix = '/activities',
} = {}) {
  const cards = listings.map((l) => renderListingHtml(l, {
    sections,
    repoSlug,
    activityHrefPrefix,
  })).join('\n');
  const labelKey = `section.${section.id}.label`;
  const introKey = `section.${section.id}.intro`;
  return `<section class="activity-section" data-section-id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-heading">
      <div class="section-heading">
        <h2 id="${escapeHtml(section.id)}-heading"${i18nAttrs(labelKey)}>${escapeHtml(section.label)}</h2>
        <p class="section-intro"${i18nAttrs(introKey)}>${escapeHtml(section.intro)}</p>
      </div>
      <div class="listing-grid">
${cards}
      </div>
    </section>`;
}
