// Static site generator.
// Reads activities-data.mjs and writes:
//   cities/<slug>/index.html
//   activities/<slug>/index.html
// Pages are progressively enhanced: the rendered HTML is fully usable
// without JS, and the client-side filter script then takes over.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const layoutHtml = ({ title, description, lang = 'en', body }) =>
  `<!doctype html>
<html lang="${escapeHtml(lang)}" data-repo-slug="${escapeHtml(REPO_SLUG)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
${body}
  </body>
</html>
`;

function cityPage(city) {
  const cityActivities = activities.filter((a) => city.nearbyTowns.includes(a.town));
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

  const body = `    <main class="page stack">
      <header class="page-header">
        <a class="back-link" href="/">← Back to homepage</a>
        <p class="eyebrow">KinderAktiv ${escapeHtml(city.name)}</p>
        <h1>Find local activities your child can join, try, or do nearby.</h1>
        <p>Manually curated options for parents comparing weekly, weekend, holiday, and beginner-friendly activities near ${escapeHtml(city.name)}.</p>
        <div class="button-row">
          <a class="button secondary" href="${escapeHtml(submitUrl)}" rel="noopener noreferrer">Submit or update an activity</a>
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
        </form>
        <div id="filter-chips" class="chip-bar" aria-label="Quick filters">${chipsHtml}</div>
      </section>

      <p id="empty-state" class="empty-state" hidden>
        No activities match the selected filters yet. Try widening your criteria.
      </p>

      <div id="listings-root">
${sectionsHtml}
      </div>
    </main>

    <script type="module" src="/assets/filters.js"></script>`;

  // Tell the client script which towns belong to this city without
  // re-importing the whole data table on the client.
  return layoutHtml({
    title: `KinderAktiv ${city.name} | Local kids activities near ${city.name}`,
    description: `Discover weekly activities, weekend family ideas, holiday activities, and beginner-friendly trials near ${city.name}.`,
    body: body,
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
    ['Last verified', listing.lastVerified],
  ]
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`)
    .join('\n');

  const contactLink = listing.contactUrl
    ? `<p><strong>Contact or website:</strong> <a class="text-link" href="${escapeHtml(listing.contactUrl)}" rel="noopener noreferrer">Organizer website</a></p>`
    : '';

  const sourceLink = listing.sourceUrl && listing.sourceUrl !== listing.contactUrl
    ? `<p><strong>Source:</strong> <a class="text-link" href="${escapeHtml(listing.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(listing.sourceUrl)}</a></p>`
    : '';

  const updateParams = new URLSearchParams({
    template: 'suggest-update.yml',
    title: `[Update] ${listing.name}`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
  });
  const updateUrl = `https://github.com/${REPO_SLUG}/issues/new?${updateParams.toString()}`;

  const backCity = cityForTown(listing.town);

  const closedParams = new URLSearchParams({
    template: 'suggest-update.yml',
    title: `[Closed?] ${listing.name}`,
    slug: listing.slug,
    activity: listing.name,
    town: listing.town,
    'change-type': 'Reported closed',
  });
  const closedUrl = `https://github.com/${REPO_SLUG}/issues/new?${closedParams.toString()}`;

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
${sourceLink}
      </section>

      <section class="panel cta-panel">
        <h2>Help keep this accurate</h2>
        <p>Found a change? Confirmed details? Let parents in your area benefit.</p>
        <div class="button-row">
          <a class="button" href="${escapeHtml(updateUrl)}" rel="noopener noreferrer">Suggest an update</a>
          <a class="button secondary" href="${escapeHtml(closedUrl)}" rel="noopener noreferrer">Report as closed</a>
        </div>
      </section>
    </main>`;

  return layoutHtml({
    title: `${listing.name} | KinderRadar`,
    description: `${listing.name} — ${listing.category} for ages ${listing.ageRange} in ${listing.town}. ${listing.timing}.`,
    body,
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

  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = await generate();
  console.log(`Generated ${count} page(s).`);
}
