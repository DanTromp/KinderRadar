// Pure rendering helpers for KinderRadar.
// Produces both HTML strings (used by the static generator) and DOM nodes
// (used by the in-browser script). Browser-only code paths are guarded so
// this module can be imported under Node for tests and build-time use.

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
// Returns { label, tone } where tone ∈ {fresh, neutral, stale, closed}.
export function freshnessBadge(listing, now = new Date()) {
  if (listing?.status === 'reported-closed') {
    return { label: 'Reported closed', tone: 'closed' };
  }
  const days = daysSince(listing?.lastVerified, now);
  if (days === null) {
    return { label: 'Verification unknown', tone: 'stale' };
  }
  if (days < 30) return { label: `Verified ${days} day${days === 1 ? '' : 's'} ago`, tone: 'fresh' };
  if (days <= 90) return { label: `Verified ${days} days ago`, tone: 'neutral' };
  return { label: 'Needs update', tone: 'stale' };
}

export function verifierLabel(verifiedBy) {
  switch (verifiedBy) {
    case 'organizer': return 'Organizer submitted';
    case 'parent': return 'Parent confirmed';
    case 'editor': return 'Editor curated';
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

function tagLabelForSection(section, sections) {
  const found = sections.find((s) => s.id === section);
  return found ? found.tag : 'Activity';
}

function contactLineHtml(listing) {
  if (listing.contactUrl) {
    return `<a class="text-link" href="${escapeHtml(listing.contactUrl)}" rel="noopener noreferrer">Organizer website</a>`;
  }
  return '<span class="muted">Not listed yet</span>';
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
  const tag = tagLabelForSection(listing.section, sections);
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
    ? '<p class="status-banner" role="status">This activity was reported closed. Please verify before going.</p>'
    : '';

  const verifierLine = verifier
    ? `<p class="verifier muted">${escapeHtml(verifier)}</p>`
    : '';

  const settingLine = listing.setting
    ? `<p><strong>Setting:</strong> ${escapeHtml(listing.setting)}</p>`
    : '';

  const languageLine = listing.language
    ? `<p><strong>Language:</strong> ${escapeHtml(listing.language)}</p>`
    : '';

  return `<article class="listing" ${dataAttrs}>
      <div class="listing-header">
        <span class="listing-tag">${escapeHtml(tag)}</span>
        <span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}">${escapeHtml(badge.label)}</span>
      </div>
      ${closedBanner}
      <h3><a class="text-link" href="/activities/${escapeHtml(listing.slug)}/">${escapeHtml(listing.name)}</a></h3>
      <p><strong>Category:</strong> ${escapeHtml(listing.category)}</p>
      <p><strong>Age range:</strong> ${escapeHtml(listing.ageRange)}</p>
      <p><strong>Town:</strong> ${escapeHtml(listing.town)}</p>
      <p><strong>When:</strong> ${escapeHtml(listing.timing)}</p>
      <p><strong>Cost:</strong> ${escapeHtml(listing.cost)}</p>
      <p><strong>Beginner-friendly:</strong> ${listing.beginnerFriendly ? 'Yes' : 'No'}</p>
      <p><strong>Trial availability:</strong> ${escapeHtml(optionalText(listing.trial?.notes ?? listing.trialAvailability))}</p>
      ${settingLine}
      ${languageLine}
      <p><strong>Contact or website:</strong> ${contactLineHtml(listing)}</p>
      <p><strong>Last verified:</strong> ${escapeHtml(listing.lastVerified)}</p>
      ${verifierLine}
      <p class="listing-actions"><a class="text-link" href="${escapeHtml(suggestUpdateUrl(listing, repoSlug))}" rel="noopener noreferrer" data-analytics="suggest_update_click">Suggest an update</a></p>
    </article>`;
}

// Build a full section panel (heading + grid of listings) as HTML.
export function renderSectionHtml(section, listings, { sections = [], repoSlug = '' } = {}) {
  const cards = listings.map((l) => renderListingHtml(l, { sections, repoSlug })).join('\n');
  return `<section class="panel" data-section-id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-heading">
      <h2 id="${escapeHtml(section.id)}-heading">${escapeHtml(section.label)}</h2>
      <p class="section-intro">${escapeHtml(section.intro)}</p>
      <div class="listing-grid">
${cards}
      </div>
    </section>`;
}
