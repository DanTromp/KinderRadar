// Pure rendering helpers for KinderRadar.
// Produces both HTML strings (used by the static generator) and DOM nodes
// (used by the in-browser script). Browser-only code paths are guarded so
// this module can be imported under Node for tests and build-time use.
//
// Translation strategy: every user-visible string is emitted with the
// English text inline AND a `data-i18n` attribute (or `data-i18n-attr` for
// attribute translations). The runtime in /assets/i18n.js swaps the text
// when the user toggles the language. This keeps SSR output usable without
// JS while letting us add German translations entirely via JSON files.

import { optionalText } from './filtering.mjs';

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

// verifierLabel returns { label, i18nKey } for known values, null otherwise.
export function verifierLabel(verifiedBy) {
  switch (verifiedBy) {
    case 'organizer': return { label: 'Organizer submitted', i18nKey: 'enum.verifier.organizer' };
    case 'parent': return { label: 'Parent confirmed', i18nKey: 'enum.verifier.parent' };
    case 'editor': return { label: 'Editor curated', i18nKey: 'enum.verifier.editor' };
    default: return null;
  }
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

function contactLineHtml(listing) {
  if (listing.contactUrl) {
    return `<a class="text-link" href="${escapeHtml(listing.contactUrl)}" rel="noopener noreferrer"${i18nAttrs('listing.contact.organizer')}>Organizer website</a>`;
  }
  return `<span class="muted"${i18nAttrs('listing.contact.notListed')}>Not listed yet</span>`;
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
export function renderListingHtml(listing, { sections = [], repoSlug = '' } = {}) {
  const tagInfo = tagInfoForSection(listing.section, sections);
  const badge = freshnessBadge(listing);
  const verifier = verifierLabel(listing.verifiedBy);
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

  const verifierLine = verifier
    ? `<p class="verifier muted"${i18nAttrs(verifier.i18nKey)}>${escapeHtml(verifier.label)}</p>`
    : '';

  const settingLine = listing.setting
    ? `<p><strong${i18nAttrs('field.setting')}>Setting:</strong> ${enumSpan('enum.setting', listing.setting)}</p>`
    : '';

  const languageLine = listing.language
    ? `<p><strong${i18nAttrs('field.language')}>Language:</strong> ${enumSpan('enum.language', listing.language)}</p>`
    : '';

  const nameText = freeText(listing.name);
  const timingText = freeText(listing.timing);
  const costText = freeText(listing.cost);
  const townText = freeText(listing.town);
  const trialRaw = listing.trial?.notes ?? listing.trialAvailability;
  const hasTrialText = typeof trialRaw === 'object'
    || (typeof trialRaw === 'string' && trialRaw.trim() !== '');
  const trialEn = optionalText(typeof trialRaw === 'string' ? trialRaw : (trialRaw?.en ?? ''));
  const trialAttrs = (typeof trialRaw === 'object' && trialRaw && (trialRaw.en || trialRaw.de))
    ? freeText(trialRaw).attrs
    : (hasTrialText ? '' : i18nAttrs('enum.notSpecified'));
  const trialDisplay = hasTrialText && typeof trialRaw === 'object'
    ? freeText(trialRaw).en
    : escapeHtml(trialEn);

  const beginnerKey = listing.beginnerFriendly ? 'enum.bool.yes' : 'enum.bool.no';
  const beginnerLabel = listing.beginnerFriendly ? 'Yes' : 'No';

  return `<article class="listing" ${dataAttrs}>
      <div class="listing-header">
        <span class="listing-tag"${i18nAttrs(tagInfo.i18nKey)}>${escapeHtml(tagInfo.label)}</span>
        <span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}"${i18nAttrs(badge.i18nKey, badge.i18nParams)}>${escapeHtml(badge.label)}</span>
      </div>
      ${closedBanner}
      <h3><a class="text-link" href="/activities/${escapeHtml(listing.slug)}/"${nameText.attrs}>${nameText.en}</a></h3>
      <p><strong${i18nAttrs('field.category')}>Category:</strong> ${enumSpan('enum.category', listing.category)}</p>
      <p><strong${i18nAttrs('field.ageRange')}>Age range:</strong> ${escapeHtml(listing.ageRange)}</p>
      <p><strong${i18nAttrs('field.town')}>Town:</strong> <span${townText.attrs}>${townText.en}</span></p>
      <p><strong${i18nAttrs('field.when')}>When:</strong> <span${timingText.attrs}>${timingText.en}</span></p>
      <p><strong${i18nAttrs('field.cost')}>Cost:</strong> <span${costText.attrs}>${costText.en}</span></p>
      <p><strong${i18nAttrs('field.beginnerFriendly')}>Beginner-friendly:</strong> <span${i18nAttrs(beginnerKey)}>${beginnerLabel}</span></p>
      <p><strong${i18nAttrs('field.trialAvailability')}>Trial availability:</strong> <span${trialAttrs}>${trialDisplay}</span></p>
      ${settingLine}
      ${languageLine}
      <p><strong${i18nAttrs('field.contactOrWebsite')}>Contact or website:</strong> ${contactLineHtml(listing)}</p>
      <p><strong${i18nAttrs('field.lastVerified')}>Last verified:</strong> ${escapeHtml(listing.lastVerified)}</p>
      ${verifierLine}
      <p class="listing-actions"><a class="text-link" href="${escapeHtml(suggestUpdateUrl(listing, repoSlug))}" rel="noopener noreferrer" data-analytics="suggest_update_click"${i18nAttrs('listing.suggestUpdate')}>Suggest an update</a></p>
    </article>`;
}

// Build a full section panel (heading + grid of listings) as HTML.
export function renderSectionHtml(section, listings, { sections = [], repoSlug = '' } = {}) {
  const cards = listings.map((l) => renderListingHtml(l, { sections, repoSlug })).join('\n');
  const labelKey = `section.${section.id}.label`;
  const introKey = `section.${section.id}.intro`;
  return `<section class="panel" data-section-id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-heading">
      <h2 id="${escapeHtml(section.id)}-heading"${i18nAttrs(labelKey)}>${escapeHtml(section.label)}</h2>
      <p class="section-intro"${i18nAttrs(introKey)}>${escapeHtml(section.intro)}</p>
      <div class="listing-grid">
${cards}
      </div>
    </section>`;
}
