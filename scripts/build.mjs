// Static site generator.
// Reads activities-data.mjs and writes:
//   cities/<slug>/index.html
//   activities/<slug>/index.html
// Pages are progressively enhanced: the rendered HTML is fully usable
// without JS, and the client-side filter script then takes over.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { activities, sections, cities } from '../assets/activities-data.mjs';
import {
  renderSectionHtml,
  freshnessBadge,
  verifierLabel,
  escapeHtml,
} from '../assets/render.mjs';
import { sortByFreshness, CHIP_DEFINITIONS } from '../assets/filtering.mjs';

function cityForTown(town) {
  return cities.find((c) => c.nearbyTowns.includes(town)) ?? cities[0];
}

function parseLocalEnv() {
  const envPath = new URL('../.env', import.meta.url);
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const localEnv = parseLocalEnv();
const envValue = (name, fallback = '') => process.env[name] ?? localEnv[name] ?? fallback;

const REPO_SLUG = envValue('KINDERRADAR_REPO', 'DanTromp/KinderRadar');
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SITE_BASE_URL = envValue('KINDERRADAR_BASE_URL', 'https://dantromp.github.io/KinderRadar');
const PLAUSIBLE_DOMAIN = envValue('KINDERRADAR_PLAUSIBLE_DOMAIN');
const PUBLIC_SUPABASE_URL = envValue('SUPABASE_URL');
const PUBLIC_SUPABASE_KEY = envValue('SUPABASE_PUBLISHABLE_KEY');

// Known enum vocabulary used on the activity detail page. Values outside
// these sets (e.g. compound days like "Monday-Friday") are rendered as
// plain text so we never emit a data-i18n key that has no translation.
const KNOWN_DETAIL_ENUMS = {
  'enum.recurring': new Set(['weekly', 'monthly', 'one-off']),
  'enum.setting': new Set(['indoor', 'outdoor', 'mixed']),
  'enum.parentParticipation': new Set(['required', 'optional', 'none']),
  'enum.contactMethod': new Set(['email', 'phone', 'form', 'whatsapp']),
  'enum.language': new Set(['de', 'en']),
  'enum.dayOfWeek': new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  'enum.category': new Set(['Sports', 'Arts & crafts', 'Family outing', 'Nature', 'Holiday camp', 'STEM', 'Swimming', 'Music']),
};

const layoutHtml = ({
  title,
  description,
  lang = 'en',
  body,
  ogTitle,
  ogDescription,
  ogUrl,
  titleI18nKey,
  titleI18nParams,
  descriptionI18nKey,
  descriptionI18nParams,
  assetPrefix = '',
}) => {
  const oTitle = ogTitle ?? title;
  const oDesc = ogDescription ?? description;
  const absUrl = ogUrl ? `${SITE_BASE_URL}${ogUrl}` : SITE_BASE_URL;
  const titleAttrs = titleI18nKey
    ? ` data-i18n="${escapeHtml(titleI18nKey)}"${titleI18nParams ? ` data-i18n-params="${escapeHtml(JSON.stringify(titleI18nParams))}"` : ''}`
    : '';
  const descAttrs = descriptionI18nKey
    ? ` data-i18n-attr="content:${escapeHtml(descriptionI18nKey)}"${descriptionI18nParams ? ` data-i18n-params="${escapeHtml(JSON.stringify(descriptionI18nParams))}"` : ''}`
    : '';
  const analyticsConfig = PLAUSIBLE_DOMAIN
    ? `    <script>window.KINDERRADAR_PLAUSIBLE_DOMAIN=${JSON.stringify(PLAUSIBLE_DOMAIN)};</script>\n`
    : '';
  const supabaseConfig = PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_KEY
    ? `    <script>window.KINDERRADAR_SUPABASE=${JSON.stringify({ url: PUBLIC_SUPABASE_URL, publishableKey: PUBLIC_SUPABASE_KEY })};</script>\n`
    : '';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" data-repo-slug="${escapeHtml(REPO_SLUG)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title${titleAttrs}>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}"${descAttrs} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(oTitle)}" />
    <meta property="og:description" content="${escapeHtml(oDesc)}" />
    <meta property="og:url" content="${escapeHtml(absUrl)}" />
    <meta property="og:site_name" content="KinderRadar Haltern am See" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(oTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(oDesc)}" />
    <link rel="canonical" href="${escapeHtml(absUrl)}" />
    <link rel="stylesheet" href="${escapeHtml(assetPrefix)}assets/styles.css" />
${analyticsConfig}${supabaseConfig}  </head>
  <body>
${appChromeHtml()}
${body}
    <script type="module" src="${escapeHtml(assetPrefix)}assets/i18n.js"></script>
    <script type="module" src="${escapeHtml(assetPrefix)}assets/theme.js"></script>
  </body>
</html>
`;
};

function appChromeHtml() {
  return `    <nav class="app-controls" aria-label="Display controls">
      <div class="theme-toggle" data-theme-toggle aria-label="Theme" data-i18n-attr="aria-label:theme.toggle.label">
        <button type="button" data-theme-value="light" aria-pressed="true" data-i18n="theme.light">Light</button>
        <button type="button" data-theme-value="night" aria-pressed="false" data-i18n="theme.night">Night</button>
        <button type="button" data-theme-value="forest" aria-pressed="false" data-i18n="theme.forest">Forest</button>
      </div>
      <div class="lang-toggle" data-lang-toggle aria-label="Language" data-i18n-attr="aria-label:lang.toggle.label">
        <button type="button" data-lang="en" aria-pressed="true" data-i18n="lang.en">EN</button>
        <button type="button" data-lang="de" aria-pressed="false" data-i18n="lang.de">DE</button>
      </div>
    </nav>`;
}

function contributionStatusHtml() {
  return '<p class="form-status" data-form-status aria-live="polite"></p>';
}

function citySubmissionForm(city, townOptions) {
  return `      <section id="submit-activity" class="panel contribution-panel" aria-labelledby="submit-activity-heading">
        <h2 id="submit-activity-heading">Submit a missing activity</h2>
        <form class="contribution-form" data-kinderradar-update data-update-type="submission" data-city="${escapeHtml(city.name)}" novalidate>
          <label>
            Activity name
            <input name="activityName" autocomplete="off" required />
          </label>
          <label>
            Town
            <select name="town" required>
              <option value="">Choose a town</option>
              ${townOptions}
            </select>
          </label>
          <label>
            Source or organizer URL
            <input name="sourceUrl" type="url" inputmode="url" placeholder="https://..." required />
          </label>
          <label>
            Notes
            <textarea name="notes" rows="4" placeholder="Age range, timing, price, organizer details"></textarea>
          </label>
          <label>
            Email (optional)
            <input name="reporterEmail" type="email" autocomplete="email" />
          </label>
          <label class="hp-field">
            Leave this empty
            <input name="website" tabindex="-1" autocomplete="off" />
          </label>
          <button class="button" type="submit">Send for review</button>
          ${contributionStatusHtml()}
        </form>
      </section>`;
}

function activityUpdateForm(listing) {
  return `      <section class="panel contribution-panel" aria-labelledby="activity-update-heading">
        <h2 id="activity-update-heading">Help keep this accurate</h2>
        <form class="contribution-form" data-kinderradar-update data-activity-slug="${escapeHtml(listing.slug)}" data-activity-name="${escapeHtml(listing.name)}" data-town="${escapeHtml(listing.town)}" novalidate>
          <label>
            What are you reporting?
            <select name="updateType" required>
              <option value="update">Suggest an update</option>
              <option value="confirm">Confirm still running</option>
              <option value="closed">Report as closed</option>
              <option value="claim">I'm the organizer</option>
            </select>
          </label>
          <label>
            Evidence or source URL
            <input name="evidenceUrl" type="url" inputmode="url" placeholder="https://..." />
          </label>
          <label>
            Notes
            <textarea name="notes" rows="4" placeholder="What changed, what did you confirm, or how can we verify it?"></textarea>
          </label>
          <label>
            Email (optional)
            <input name="reporterEmail" type="email" autocomplete="email" />
          </label>
          <label class="hp-field">
            Leave this empty
            <input name="website" tabindex="-1" autocomplete="off" />
          </label>
          <button class="button" type="submit">Send for review</button>
          ${contributionStatusHtml()}
        </form>
      </section>`;
}

function cityPage(city) {
  const cityActivities = activities
    .filter((a) => city.nearbyTowns.includes(a.town))
    .filter((a) => a.status !== 'reported-closed');
  const activeCategories = new Set(cityActivities.map((a) => a.category).filter(Boolean));
  const weekendCount = cityActivities.filter((a) => /sat|sun/i.test(a.dayOfWeek ?? '')).length;
  const sectionsHtml = sections
    .map((section) => {
      const inSection = sortByFreshness(cityActivities.filter((a) => a.section === section.id));
      if (inSection.length === 0) return '';
      return renderSectionHtml(section, inSection, {
        sections,
        repoSlug: REPO_SLUG,
        activityHrefPrefix: '../../activities',
      });
    })
    .filter(Boolean)
    .join('\n');

  const townOptions = city.nearbyTowns
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

  const categories = Array.from(new Set(cityActivities.map((a) => a.category))).sort();
  const categoryOptions = categories
    .map((c) => `<option value="${escapeHtml(c)}" data-i18n="enum.category.${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const chipsHtml = CHIP_DEFINITIONS
    .map((c) => `<button type="button" class="chip" data-chip-id="${c.id}" data-i18n="${escapeHtml(c.labelKey)}" aria-pressed="false">${escapeHtml(c.label)}</button>`)
    .join('');

  const description = `Find kids' activities in ${city.name} that fit your child, schedule, budget, and confidence level — with listings that are actually kept fresh.`;

  const cityParams = { city: city.name, towns: city.nearbyTowns.join(', ') };

  const body = `    <main class="page stack">
      <header class="page-header hero-shell">
        <div class="hero-copy">
          <p class="eyebrow" data-i18n="city.eyebrow" data-i18n-params="${escapeHtml(JSON.stringify({ city: city.name }))}">KinderRadar ${escapeHtml(city.name)}</p>
          <h1 data-i18n="city.heading">Find kids' activities that fit your child, schedule, budget, and confidence level.</h1>
          <p data-i18n="city.intro" data-i18n-params="${escapeHtml(JSON.stringify(cityParams))}">${escapeHtml(description)} Curated for parents around ${escapeHtml(city.name)} (${escapeHtml(city.nearbyTowns.join(', '))}).</p>
          <div class="button-row">
            <a class="button secondary" href="#submit-activity" data-analytics="submit_activity_click" data-i18n="city.submit">Submit or update an activity</a>
          </div>
        </div>
        <dl class="hero-stats" aria-label="Activity overview">
          <div><dt>${cityActivities.length}</dt><dd data-i18n="city.stats.activities">active listings</dd></div>
          <div><dt>${activeCategories.size}</dt><dd data-i18n="city.stats.categories">categories</dd></div>
          <div><dt>${weekendCount}</dt><dd data-i18n="city.stats.weekend">weekend ideas</dd></div>
        </dl>
        <div class="radar-loader hero-loader" aria-hidden="true">
          <span></span>
        </div>
      </header>

      <section class="filter-panel" aria-labelledby="filter-heading">
        <div class="filter-panel-heading">
          <h2 id="filter-heading" data-i18n="city.filters.heading">Filter activities</h2>
          <div id="filter-loader" class="filter-loader" hidden aria-live="polite">
            <span class="radar-loader" aria-hidden="true"><span></span></span>
            <span data-i18n="city.filters.loading">Tuning radar...</span>
          </div>
        </div>
        <form id="activity-filters" class="filters" novalidate>
          <label>
            <span data-i18n="city.filters.search.label">Search</span>
            <input id="activity-search" name="q" type="search" placeholder="Search activities, towns, categories…" autocomplete="off" data-i18n-attr="placeholder:city.filters.search.placeholder" />
          </label>
          <label>
            <span data-i18n="city.filters.town.label">Town</span>
            <select name="town">
              <option value="" data-i18n="city.filters.town.all">All nearby towns</option>
              ${townOptions}
            </select>
          </label>
          <label>
            <span data-i18n="city.filters.age.label">Child age</span>
            <select name="age">
              <option value="" data-i18n="city.filters.age.all">All ages</option>
              <option value="0-3">0-3</option>
              <option value="3-6">3-6</option>
              <option value="6-10">6-10</option>
              <option value="10-14">10-14</option>
            </select>
          </label>
          <label>
            <span data-i18n="city.filters.category.label">Category</span>
            <select name="category">
              <option value="" data-i18n="city.filters.category.all">All categories</option>
              ${categoryOptions}
            </select>
          </label>
          <label>
            <span data-i18n="city.filters.day.label">Day</span>
            <select name="day">
              <option value="" data-i18n="city.filters.day.any">Any day</option>
              <option value="weekend" data-i18n="city.filters.day.weekend">Weekend</option>
              <option value="weekday" data-i18n="city.filters.day.weekday">Weekdays</option>
              <option value="monday" data-i18n="enum.dayOfWeek.Monday">Monday</option>
              <option value="tuesday" data-i18n="enum.dayOfWeek.Tuesday">Tuesday</option>
              <option value="wednesday" data-i18n="enum.dayOfWeek.Wednesday">Wednesday</option>
              <option value="thursday" data-i18n="enum.dayOfWeek.Thursday">Thursday</option>
              <option value="friday" data-i18n="enum.dayOfWeek.Friday">Friday</option>
              <option value="saturday" data-i18n="enum.dayOfWeek.Saturday">Saturday</option>
              <option value="sunday" data-i18n="enum.dayOfWeek.Sunday">Sunday</option>
            </select>
          </label>
          <label>
            <span data-i18n="city.filters.beginner.label">Beginner-friendly</span>
            <select name="beginnerFriendly">
              <option value="" data-i18n="city.filters.beginner.any">Any</option>
              <option value="true" data-i18n="city.filters.beginner.yes">Yes</option>
              <option value="false" data-i18n="city.filters.beginner.no">No</option>
            </select>
          </label>
          <label>
            <span data-i18n="city.filters.sort.label">Sort by</span>
            <select name="sort" id="activity-sort">
              <option value="freshness" data-i18n="city.filters.sort.freshness">Last checked (freshest first)</option>
              <option value="name" data-i18n="city.filters.sort.name">Name (A–Z)</option>
            </select>
          </label>
        </form>
        <div id="filter-chips" class="chip-bar" aria-label="Quick filters" data-i18n-attr="aria-label:city.chips.aria">${chipsHtml}</div>
      </section>

      <p id="empty-state" class="empty-state" hidden>
        <span data-i18n="city.empty.text">No activities match the selected filters yet. Try widening your criteria —</span>
        <span data-i18n="city.empty.or">or</span> <a id="missing-listing-link" class="text-link" href="#submit-activity" data-analytics="missing_listing_click" data-i18n="city.empty.link">tell us what's missing</a>.
      </p>

      <div id="listings-root">
${sectionsHtml}
      </div>

      <section class="trust-explainer" aria-labelledby="trust-explainer-heading">
        <h2 id="trust-explainer-heading" data-i18n="city.trust.heading">How we keep this fresh</h2>
        <ul>
          <li><strong data-i18n="city.trust.curated.title">Editor curated.</strong> <span data-i18n="city.trust.curated.text">Every listing starts from a public organizer page; the source link is on each detail page.</span></li>
          <li><strong data-i18n="city.trust.freshness.title">Freshness chip.</strong> <span data-i18n="city.trust.freshness.text">Green ≤30 days, neutral ≤90 days, amber over 90 days ("Needs update").</span></li>
          <li><strong data-i18n="city.trust.reports.title">Parent reports &amp; organizer claims.</strong> <span data-i18n="city.trust.reports.text">Anyone can suggest an update, confirm a listing is still running, or report it closed — straight from the detail page.</span></li>
          <li><strong data-i18n="city.trust.closed.title">Closed listings disappear.</strong> <span data-i18n="city.trust.closed.text">Once a closure is confirmed, the listing is removed from this page on the next data update.</span></li>
        </ul>
      </section>

${citySubmissionForm(city, townOptions)}
    </main>

    <script type="module" src="../../assets/filters.js"></script>
    <script type="module" src="../../assets/analytics.js"></script>
    <script type="module" src="../../assets/update-form.js"></script>`;

  return layoutHtml({
    title: `KinderRadar ${city.name} | Kids' activities kept fresh`,
    description,
    body,
    ogTitle: `KinderRadar ${city.name}`,
    ogDescription: description,
    ogUrl: `/cities/${city.slug}/`,
    titleI18nKey: 'city.title',
    titleI18nParams: { city: city.name },
    descriptionI18nKey: 'city.description',
    descriptionI18nParams: { city: city.name },
    assetPrefix: '../../',
  }).replace(
    '<html ',
    `<html data-city-slug="${escapeHtml(city.slug)}" data-city-towns="${escapeHtml(city.nearbyTowns.join('|'))}" `,
  );
}

function activityDetailPage(listing) {
  const badge = freshnessBadge(listing);
  const verifier = verifierLabel(listing.verifiedBy);
  const closed = badge.tone === 'closed';
  const closedBanner = closed
    ? '<p class="status-banner" role="status" data-i18n="activity.closedBanner">This activity was reported closed. Please verify before going.</p>'
    : '';
  const verifierLine = verifier
    ? `<p class="verifier muted" data-i18n="${escapeHtml(verifier.i18nKey)}">${escapeHtml(verifier.label)}</p>`
    : '';

  // i18n helpers local to detail page rendering.
  const i18nAttr = (key, params) => {
    if (!key) return '';
    let out = ` data-i18n="${escapeHtml(key)}"`;
    if (params) out += ` data-i18n-params="${escapeHtml(JSON.stringify(params))}"`;
    return out;
  };
  const enumValue = (prefix, raw) => {
    if (raw === undefined || raw === null || raw === '') return '';
    const known = KNOWN_DETAIL_ENUMS[prefix];
    if (known && !known.has(raw)) return escapeHtml(raw);
    return `<span${i18nAttr(`${prefix}.${raw}`)}>${escapeHtml(raw)}</span>`;
  };
  const freeValue = (raw) => {
    if (raw == null || raw === '') return '';
    if (typeof raw === 'object' && (raw.en !== undefined || raw.de !== undefined)) {
      const en = raw.en ?? raw.de ?? '';
      const deAttr = raw.de ? ` data-i18n-text-de="${escapeHtml(raw.de)}"` : '';
      return `<span data-i18n-text-en="${escapeHtml(en)}"${deAttr}>${escapeHtml(en)}</span>`;
    }
    return escapeHtml(raw);
  };

  const fields = [
    { labelKey: 'field.category', label: 'Category', value: enumValue('enum.category', listing.category), show: !!listing.category },
    { labelKey: 'field.ageRange', label: 'Age range', value: escapeHtml(listing.ageRange ?? ''), show: !!listing.ageRange },
    { labelKey: 'field.town', label: 'Town', value: freeValue(listing.town), show: !!listing.town },
    { labelKey: 'field.when', label: 'When', value: freeValue(listing.timing), show: !!listing.timing },
    { labelKey: 'field.dayOfWeek', label: 'Day of week', value: enumValue('enum.dayOfWeek', listing.dayOfWeek), show: !!listing.dayOfWeek },
    { labelKey: 'field.startTime', label: 'Start time', value: escapeHtml(listing.startTime ?? ''), show: !!listing.startTime },
    { labelKey: 'field.endTime', label: 'End time', value: escapeHtml(listing.endTime ?? ''), show: !!listing.endTime },
    { labelKey: 'field.recurring', label: 'Recurring', value: enumValue('enum.recurring', listing.recurring), show: !!listing.recurring },
    { labelKey: 'field.cost', label: 'Cost', value: freeValue(listing.cost), show: !!listing.cost },
    {
      labelKey: 'field.beginnerFriendly',
      label: 'Beginner-friendly',
      value: `<span${i18nAttr(listing.beginnerFriendly ? 'enum.bool.yes' : 'enum.bool.no')}>${listing.beginnerFriendly ? 'Yes' : 'No'}</span>`,
      show: true,
    },
    (() => {
      const raw = listing.trial?.notes ?? listing.trialAvailability;
      if (raw === undefined || raw === null || raw === '') {
        return {
          labelKey: 'field.trialAvailability',
          label: 'Trial availability',
          value: `<span${i18nAttr('enum.notSpecified')}>Not specified</span>`,
          show: true,
        };
      }
      return {
        labelKey: 'field.trialAvailability',
        label: 'Trial availability',
        value: freeValue(raw),
        show: true,
      };
    })(),
    (() => {
      if (listing.bookingRequired === undefined) return { show: false };
      return {
        labelKey: 'field.bookingRequired',
        label: 'Booking required',
        value: `<span${i18nAttr(listing.bookingRequired ? 'enum.bool.yes' : 'enum.bool.no')}>${listing.bookingRequired ? 'Yes' : 'No'}</span>`,
        show: true,
      };
    })(),
    { labelKey: 'field.setting', label: 'Setting', value: enumValue('enum.setting', listing.setting), show: !!listing.setting },
    { labelKey: 'field.parentParticipation', label: 'Parent participation', value: enumValue('enum.parentParticipation', listing.parentParticipation), show: !!listing.parentParticipation },
    { labelKey: 'field.language', label: 'Language', value: enumValue('enum.language', listing.language), show: !!listing.language },
    { labelKey: 'field.accessibility', label: 'Accessibility', value: freeValue(listing.accessibility), show: !!listing.accessibility },
    { labelKey: 'field.contactMethod', label: 'Contact method', value: enumValue('enum.contactMethod', listing.contactMethod), show: !!listing.contactMethod },
  ]
    .filter((f) => f.show)
    .map((f) => `<p><strong${i18nAttr(f.labelKey)}>${escapeHtml(f.label)}:</strong> ${f.value}</p>`)
    .join('\n');

  const contactLink = listing.contactUrl
    ? `<p><strong${i18nAttr('field.contactOrWebsite')}>Contact or website:</strong> <a class="text-link" href="${escapeHtml(listing.contactUrl)}" rel="noopener noreferrer" data-analytics="contact_click" data-i18n="listing.contact.organizer">Organizer website</a></p>`
    : '';

  const backCity = cityForTown(listing.town);

  // Trust panel: source, verifier, last checked, status — all surfaced so a
  // parent (or an organizer) can decide whether to trust the listing.
  const verifierTrust = verifier
    ? `<dd data-i18n="${escapeHtml(verifier.i18nKey)}">${escapeHtml(verifier.label)}</dd>`
    : `<dd data-i18n="activity.unverified">Unverified</dd>`;
  const statusKey = `enum.status.${listing.status ?? 'active'}`;
  const statusText = listing.status === 'reported-closed'
    ? 'Reported closed'
    : (listing.status === 'needs-update' ? 'Needs update' : 'Active');
  const sourceTrustLine = listing.sourceUrl
    ? `<dt data-i18n="activity.trust.source">Source</dt><dd><a class="text-link" href="${escapeHtml(listing.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(listing.sourceUrl)}</a></dd>`
    : '<dt data-i18n="activity.trust.source">Source</dt><dd class="muted" data-i18n="activity.trust.noSource">No source URL on file</dd>';
  const trustPanel = `      <section class="panel trust-panel" aria-labelledby="trust-heading">
        <h2 id="trust-heading" data-i18n="activity.trust.heading">Why you can trust this listing</h2>
        <dl class="trust-grid">
          ${sourceTrustLine}
          <dt data-i18n="activity.trust.verifiedBy">Verified by</dt>${verifierTrust}
          <dt data-i18n="activity.trust.lastChecked">Last checked</dt><dd><span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}"${i18nAttr(badge.i18nKey, badge.i18nParams)}>${escapeHtml(badge.label)}</span> <span class="muted">(${escapeHtml(listing.lastVerified ?? 'unknown')})</span></dd>
          <dt data-i18n="activity.trust.status">Status</dt><dd data-i18n="${escapeHtml(statusKey)}">${escapeHtml(statusText)}</dd>
        </dl>
        <p class="muted small" data-i18n="activity.trust.note">Spotted a change? Send it for review so the listing can be checked and refreshed.</p>
      </section>`;

  const ogTitle = `${listing.name} | KinderRadar Haltern am See`;
  const ogDesc = `${listing.name} — ${listing.category} for ages ${listing.ageRange} in ${listing.town}. ${listing.timing}.`;

  const nameDisplay = (() => {
    if (listing.name == null) return { en: '', attrs: '' };
    if (typeof listing.name === 'object' && (listing.name.en !== undefined || listing.name.de !== undefined)) {
      const en = listing.name.en ?? listing.name.de ?? '';
      let attrs = ` data-i18n-text-en="${escapeHtml(en)}"`;
      if (listing.name.de) attrs += ` data-i18n-text-de="${escapeHtml(listing.name.de)}"`;
      return { en: escapeHtml(en), attrs };
    }
    return { en: escapeHtml(listing.name), attrs: '' };
  })();
  const townDisplay = (() => {
    if (listing.town == null) return { en: '', attrs: '' };
    if (typeof listing.town === 'object' && (listing.town.en !== undefined || listing.town.de !== undefined)) {
      const en = listing.town.en ?? listing.town.de ?? '';
      let attrs = ` data-i18n-text-en="${escapeHtml(en)}"`;
      if (listing.town.de) attrs += ` data-i18n-text-de="${escapeHtml(listing.town.de)}"`;
      return { en: escapeHtml(en), attrs };
    }
    return { en: escapeHtml(listing.town), attrs: '' };
  })();

  const body = `    <main class="page stack">
      <header class="page-header">
        <a class="back-link" href="../../cities/${escapeHtml(backCity.slug)}/" data-i18n="activity.back">← Back to activities</a>
        <p class="eyebrow"${townDisplay.attrs}>${townDisplay.en}</p>
        <div class="listing-header">
          <h1${nameDisplay.attrs}>${nameDisplay.en}</h1>
          <span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}"${i18nAttr(badge.i18nKey, badge.i18nParams)}>${escapeHtml(badge.label)}</span>
        </div>
        ${closedBanner}
        ${verifierLine}
      </header>

      <section class="panel">
${fields}
${contactLink}
      </section>

${trustPanel}

${activityUpdateForm(listing)}
    </main>

    <script type="module" src="../../assets/analytics.js"></script>
    <script type="module" src="../../assets/update-form.js"></script>`;

  return layoutHtml({
    title: `${listing.name} | KinderRadar`,
    description: ogDesc,
    body,
    ogTitle,
    ogDescription: ogDesc,
    ogUrl: `/activities/${listing.slug}/`,
    assetPrefix: '../../',
  });
}

async function writeFileEnsuringDir(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

export async function generate() {
  let written = 0;

  for (const city of cities) {
    const out = join(ROOT, 'cities', city.slug, 'index.html');
    await writeFileEnsuringDir(out, cityPage(city));
    written += 1;
  }

  // Wipe and regenerate the activities/ tree so deleted entries don't linger.
  await rm(join(ROOT, 'activities'), { recursive: true, force: true });
  for (const listing of activities) {
    const out = join(ROOT, 'activities', listing.slug, 'index.html');
    await writeFileEnsuringDir(out, activityDetailPage(listing));
    written += 1;
  }

  // robots.txt + sitemap.xml so the deployed site is discoverable.
  const urls = [
    { loc: '/', changefreq: 'weekly' },
    ...cities.map((c) => ({ loc: `/cities/${c.slug}/`, changefreq: 'weekly' })),
    ...activities
      .filter((a) => a.status !== 'reported-closed')
      .map((a) => ({ loc: `/activities/${a.slug}/`, changefreq: 'monthly', lastmod: a.lastVerified })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_BASE_URL}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq></url>`).join('\n')}
</urlset>
`;
  await writeFile(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
  await writeFile(
    join(ROOT, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_BASE_URL}/sitemap.xml\n`,
    'utf8',
  );
  written += 2;

  return written;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const count = await generate();
  console.log(`Generated ${count} page(s).`);
}
