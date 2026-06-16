// Static site generator.
// Reads activities-data.mjs and writes:
//   cities/<slug>/index.html
//   activities/<slug>/index.html
// Pages are progressively enhanced: the rendered HTML is fully usable
// without JS, and the client-side filter script then takes over.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { activities, sections, cities } from '../assets/activities-data.mjs';
import {
  renderSectionHtml,
  freshnessBadge,
  verifierLabel,
  escapeHtml,
} from '../assets/render.mjs';
import { sortByFreshness, optionalText, CHIP_DEFINITIONS } from '../assets/filtering.mjs';

function cityForTown(town) {
  return cities.find((c) => c.nearbyTowns.includes(town)) ?? cities[0];
}

const REPO_SLUG = process.env.KINDERRADAR_REPO ?? 'DanTromp/KinderRadar';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SITE_BASE_URL = process.env.KINDERRADAR_BASE_URL ?? 'https://dantromp.github.io/KinderRadar';

const layoutHtml = ({ title, description, lang = 'en', body, ogTitle, ogDescription, ogUrl }) => {
  const oTitle = ogTitle ?? title;
  const oDesc = ogDescription ?? description;
  const absUrl = ogUrl ? `${SITE_BASE_URL}${ogUrl}` : SITE_BASE_URL;
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" data-repo-slug="${escapeHtml(REPO_SLUG)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(oTitle)}" />
    <meta property="og:description" content="${escapeHtml(oDesc)}" />
    <meta property="og:url" content="${escapeHtml(absUrl)}" />
    <meta property="og:site_name" content="KinderRadar Haltern am See" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(oTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(oDesc)}" />
    <link rel="canonical" href="${escapeHtml(absUrl)}" />
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
${body}
  </body>
</html>
`;
};

function cityPage(city) {
  const cityActivities = activities
    .filter((a) => city.nearbyTowns.includes(a.town))
    .filter((a) => a.status !== 'reported-closed');
  const sectionsHtml = sections
    .map((section) => {
      const inSection = sortByFreshness(cityActivities.filter((a) => a.section === section.id));
      if (inSection.length === 0) return '';
      return renderSectionHtml(section, inSection, { sections, repoSlug: REPO_SLUG });
    })
    .filter(Boolean)
    .join('\n');

  const townOptions = city.nearbyTowns
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

  const categories = Array.from(new Set(cityActivities.map((a) => a.category))).sort();
  const categoryOptions = categories
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const chipsHtml = CHIP_DEFINITIONS
    .map((c) => `<button type="button" class="chip" data-chip-id="${c.id}" aria-pressed="false">${escapeHtml(c.label)}</button>`)
    .join('');

  const submitParams = new URLSearchParams({
    template: 'submit-activity.yml',
    title: `[Submit] New activity in ${city.name}`,
    city: city.name,
  });
  const submitUrl = `https://github.com/${REPO_SLUG}/issues/new?${submitParams.toString()}`;

  const description = `Find kids' activities in ${city.name} that fit your child, schedule, budget, and confidence level — with listings that are actually kept fresh.`;

  const body = `    <main class="page stack">
      <header class="page-header">
        <p class="eyebrow">KinderRadar ${escapeHtml(city.name)}</p>
        <h1>Find kids' activities that fit your child, schedule, budget, and confidence level.</h1>
        <p>${escapeHtml(description)} Curated for parents around ${escapeHtml(city.name)} (${escapeHtml(city.nearbyTowns.join(', '))}).</p>
        <div class="button-row">
          <a class="button secondary" href="${escapeHtml(submitUrl)}" rel="noopener noreferrer" data-analytics="submit_activity_click">Submit or update an activity</a>
        </div>
      </header>

      <section class="panel" aria-labelledby="filter-heading">
        <h2 id="filter-heading">Filter activities</h2>
        <form id="activity-filters" class="filters" novalidate>
          <label>
            Search
            <input id="activity-search" name="q" type="search" placeholder="Search activities, towns, categories…" autocomplete="off" />
          </label>
          <label>
            Town
            <select name="town">
              <option value="">All nearby towns</option>
              ${townOptions}
            </select>
          </label>
          <label>
            Child age
            <select name="age">
              <option value="">All ages</option>
              <option value="0-3">0-3</option>
              <option value="3-6">3-6</option>
              <option value="6-10">6-10</option>
              <option value="10-14">10-14</option>
            </select>
          </label>
          <label>
            Category
            <select name="category">
              <option value="">All categories</option>
              ${categoryOptions}
            </select>
          </label>
          <label>
            Beginner-friendly
            <select name="beginnerFriendly">
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>
            Sort by
            <select name="sort" id="activity-sort">
              <option value="freshness">Last checked (freshest first)</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </label>
        </form>
        <div id="filter-chips" class="chip-bar" aria-label="Quick filters">${chipsHtml}</div>
      </section>

      <p id="empty-state" class="empty-state" hidden>
        No activities match the selected filters yet. Try widening your criteria —
        or <a id="missing-listing-link" class="text-link" href="${escapeHtml(submitUrl)}" rel="noopener noreferrer" data-analytics="missing_listing_click">tell us what's missing</a>.
      </p>

      <div id="listings-root">
${sectionsHtml}
      </div>

      <section class="panel trust-explainer" aria-labelledby="trust-explainer-heading">
        <h2 id="trust-explainer-heading">How we keep this fresh</h2>
        <ul>
          <li><strong>Editor curated.</strong> Every listing starts from a public organizer page; the source link is on each detail page.</li>
          <li><strong>Freshness chip.</strong> Green ≤30 days, neutral ≤90 days, amber over 90 days ("Needs update").</li>
          <li><strong>Parent reports &amp; organizer claims.</strong> Anyone can suggest an update, confirm a listing is still running, or report it closed — straight from the detail page.</li>
          <li><strong>Closed listings disappear.</strong> Once a closure is confirmed, the listing is removed from this page on the next data update.</li>
        </ul>
      </section>
    </main>

    <script type="module" src="/assets/filters.js"></script>
    <script type="module" src="/assets/analytics.js"></script>`;

  return layoutHtml({
    title: `KinderRadar ${city.name} | Kids' activities kept fresh`,
    description,
    body,
    ogTitle: `KinderRadar ${city.name}`,
    ogDescription: description,
    ogUrl: `/cities/${city.slug}/`,
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
    ? '<p class="status-banner" role="status">This activity was reported closed. Please verify before going.</p>'
    : '';
  const verifierLine = verifier ? `<p class="verifier muted">${escapeHtml(verifier)}</p>` : '';

  const fields = [
    ['Category', listing.category],
    ['Age range', listing.ageRange],
    ['Town', listing.town],
    ['When', listing.timing],
    ['Day of week', listing.dayOfWeek],
    ['Start time', listing.startTime],
    ['End time', listing.endTime],
    ['Recurring', listing.recurring],
    ['Cost', listing.cost],
    ['Beginner-friendly', listing.beginnerFriendly ? 'Yes' : 'No'],
    ['Trial availability', optionalText(listing.trial?.notes ?? listing.trialAvailability)],
    ['Booking required', listing.bookingRequired === undefined ? null : (listing.bookingRequired ? 'Yes' : 'No')],
    ['Setting', listing.setting],
    ['Parent participation', listing.parentParticipation],
    ['Language', listing.language],
    ['Accessibility', listing.accessibility],
    ['Contact method', listing.contactMethod],
  ]
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`)
    .join('\n');

  const contactLink = listing.contactUrl
    ? `<p><strong>Contact or website:</strong> <a class="text-link" href="${escapeHtml(listing.contactUrl)}" rel="noopener noreferrer" data-analytics="contact_click">Organizer website</a></p>`
    : '';

  const backCity = cityForTown(listing.town);

  const updateParams = new URLSearchParams({
    template: 'suggest-update.yml',
    title: `[Update] ${listing.name}`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
  });
  const updateUrl = `https://github.com/${REPO_SLUG}/issues/new?${updateParams.toString()}`;

  const closedParams = new URLSearchParams({
    template: 'report-closed.yml',
    title: `[Closed?] ${listing.name}`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
  });
  const closedUrl = `https://github.com/${REPO_SLUG}/issues/new?${closedParams.toString()}`;

  const confirmParams = new URLSearchParams({
    template: 'confirm-still-running.yml',
    title: `[Confirm] ${listing.name} still running`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
  });
  const confirmUrl = `https://github.com/${REPO_SLUG}/issues/new?${confirmParams.toString()}`;

  const claimParams = new URLSearchParams({
    template: 'organizer-claim.yml',
    title: `[Claim] Organizer for ${listing.name}`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
  });
  const claimUrl = `https://github.com/${REPO_SLUG}/issues/new?${claimParams.toString()}`;

  // Trust panel: source, verifier, last checked, status — all surfaced so a
  // parent (or an organizer) can decide whether to trust the listing.
  const verifierText = verifier ?? 'Unverified';
  const statusText = listing.status === 'reported-closed'
    ? 'Reported closed'
    : (listing.status === 'needs-update' ? 'Needs update' : 'Active');
  const sourceTrustLine = listing.sourceUrl
    ? `<dt>Source</dt><dd><a class="text-link" href="${escapeHtml(listing.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(listing.sourceUrl)}</a></dd>`
    : '<dt>Source</dt><dd class="muted">No source URL on file</dd>';
  const trustPanel = `      <section class="panel trust-panel" aria-labelledby="trust-heading">
        <h2 id="trust-heading">Why you can trust this listing</h2>
        <dl class="trust-grid">
          ${sourceTrustLine}
          <dt>Verified by</dt><dd>${escapeHtml(verifierText)}</dd>
          <dt>Last checked</dt><dd><span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}">${escapeHtml(badge.label)}</span> <span class="muted">(${escapeHtml(listing.lastVerified ?? 'unknown')})</span></dd>
          <dt>Status</dt><dd>${escapeHtml(statusText)}</dd>
        </dl>
        <p class="muted small">Spotted a change? Use the buttons below — every report goes to a public issue tracker so other parents see the update too.</p>
      </section>`;

  const ogTitle = `${listing.name} | KinderRadar Haltern am See`;
  const ogDesc = `${listing.name} — ${listing.category} for ages ${listing.ageRange} in ${listing.town}. ${listing.timing}.`;

  const body = `    <main class="page stack">
      <header class="page-header">
        <a class="back-link" href="/cities/${escapeHtml(backCity.slug)}/">← Back to activities</a>
        <p class="eyebrow">${escapeHtml(listing.town)}</p>
        <div class="listing-header">
          <h1>${escapeHtml(listing.name)}</h1>
          <span class="freshness freshness-${badge.tone}" title="${escapeHtml(listing.lastVerified ?? '')}">${escapeHtml(badge.label)}</span>
        </div>
        ${closedBanner}
        ${verifierLine}
      </header>

      <section class="panel">
${fields}
${contactLink}
      </section>

${trustPanel}

      <section class="panel cta-panel">
        <h2>Help keep this accurate</h2>
        <p>Found a change? Confirmed details? Let parents in your area benefit.</p>
        <div class="button-row">
          <a class="button" href="${escapeHtml(updateUrl)}" rel="noopener noreferrer" data-analytics="suggest_update_click">Suggest an update</a>
          <a class="button secondary" href="${escapeHtml(confirmUrl)}" rel="noopener noreferrer" data-analytics="confirm_still_running_click">Confirm still running</a>
          <a class="button secondary" href="${escapeHtml(closedUrl)}" rel="noopener noreferrer" data-analytics="report_closed_click">Report as closed</a>
          <a class="button secondary" href="${escapeHtml(claimUrl)}" rel="noopener noreferrer" data-analytics="organizer_claim_click">I'm the organizer</a>
        </div>
      </section>
    </main>

    <script type="module" src="/assets/analytics.js"></script>`;

  return layoutHtml({
    title: `${listing.name} | KinderRadar`,
    description: ogDesc,
    body,
    ogTitle,
    ogDescription: ogDesc,
    ogUrl: `/activities/${listing.slug}/`,
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
