// Static site generator.
// Reads activities-data.mjs and writes a deployable static site into dist/:
//   dist/index.html
//   dist/cities/<slug>/index.html
//   dist/activities/<slug>/index.html
// Pages are progressively enhanced: the rendered HTML is fully usable
// without JS, and the client-side filter script then takes over.

import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  return cities.find((c) => c.name === town && c.nearbyTowns.length === 1)
    ?? cities.find((c) => c.name === town)
    ?? cities.find((c) => c.nearbyTowns.includes(town))
    ?? cities[0];
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
const DIST = join(ROOT, 'dist');

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

function activeActivitiesForCity(city) {
  return activities
    .filter((a) => city.nearbyTowns.includes(a.town))
    .filter((a) => a.status !== 'reported-closed');
}

function statsForActivities(items) {
  return {
    active: items.length,
    categories: new Set(items.map((a) => a.category).filter(Boolean)).size,
    weekend: items.filter((a) => /sat|sun/i.test(a.dayOfWeek ?? '')).length,
  };
}

const DISCOVERY_SHORTCUTS = {
  weekend: {
    params: { chips: 'this-weekend' },
    title: 'Weekend ready',
    body: 'One-off ideas and regular activities that can work around school days.',
    titleKey: 'city.discovery.weekend.title',
    bodyKey: 'city.discovery.weekend.body',
  },
  free: {
    params: { chips: 'free' },
    title: 'Free options',
    body: 'Start with listings that are marked free before checking paid courses.',
    titleKey: 'city.discovery.free.title',
    bodyKey: 'city.discovery.free.body',
  },
  'rainy-day': {
    params: { chips: 'rainy-day' },
    title: 'Rainy-day picks',
    body: 'Indoor or mixed-setting ideas for wet days and colder afternoons.',
    titleKey: 'city.discovery.rainy.title',
    bodyKey: 'city.discovery.rainy.body',
  },
  trial: {
    params: { chips: 'trial-available' },
    title: 'Try before committing',
    body: 'Find activities where a trial or first session is easier to arrange.',
    titleKey: 'city.discovery.trial.title',
    bodyKey: 'city.discovery.trial.body',
  },
  preschool: {
    params: { age: '3-6' },
    title: 'Ages 3-6',
    body: 'Shortlist options for kindergarten and early primary years.',
    titleKey: 'city.discovery.preschool.title',
    bodyKey: 'city.discovery.preschool.body',
  },
  primary: {
    params: { age: '6-10' },
    title: 'Ages 6-10',
    body: 'Browse activities that fit primary-school children.',
    titleKey: 'city.discovery.primary.title',
    bodyKey: 'city.discovery.primary.body',
  },
};

function cityShortIntro(city) {
  return city.shortIntro ?? `Browse family-friendly activities in ${city.name}.`;
}

function cityGuideText(city) {
  return city.guide ?? `Start with ${city.name}, then use the filters to narrow by age, day, category, price, and confidence level.`;
}

function cityCoverage(city) {
  return city.coverageLabel ?? city.nearbyTowns.join(', ');
}

function regionCitiesFor(city) {
  const regionSlug = city.regionSlug ?? city.slug;
  return cities.filter((candidate) => (candidate.regionSlug ?? candidate.slug) === regionSlug);
}

function firstTownForCity(city) {
  return city.nearbyTowns[0] ?? city.name;
}

function cityLinkFrom(currentCity, targetCity) {
  if (currentCity.slug === targetCity.slug) return '#listings-root';
  return `../../cities/${escapeHtml(targetCity.slug)}/`;
}

function buildQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

function cityDiscoveryHtml(city) {
  const shortcuts = (city.featuredShortcuts?.length ? city.featuredShortcuts : ['weekend', 'free', 'rainy-day', 'trial'])
    .map((id) => DISCOVERY_SHORTCUTS[id])
    .filter(Boolean);

  if (!shortcuts.length) return '';

  const cards = shortcuts.map((shortcut) => `        <a class="discovery-card" href="${escapeHtml(buildQuery(shortcut.params))}">
          <strong data-i18n="${escapeHtml(shortcut.titleKey)}">${escapeHtml(shortcut.title)}</strong>
          <span data-i18n="${escapeHtml(shortcut.bodyKey)}">${escapeHtml(shortcut.body)}</span>
        </a>`).join('\n');

  return `      <section class="discovery-panel" aria-labelledby="city-discovery-heading">
        <div class="section-heading">
          <h2 id="city-discovery-heading" data-i18n="city.discovery.heading">Start with what matters today</h2>
          <p class="section-intro" data-i18n="city.discovery.intro">Shortcut into useful parent filters, then fine-tune the full list below.</p>
        </div>
        <div class="discovery-grid">
${cards}
        </div>
      </section>`;
}

const PLANNER_BUCKETS = [
  {
    id: 'after-kindergarten',
    title: 'After kindergarten',
    titleKey: 'planner.afterKindergarten.title',
    intro: 'Weekday ideas from 14:00 onward.',
    introKey: 'planner.afterKindergarten.intro',
    href: '?chips=after-kindergarten',
    predicate: (listing) => CHIP_DEFINITIONS.find((chip) => chip.id === 'after-kindergarten')?.predicate(listing),
  },
  {
    id: 'weekend',
    title: 'Weekend ideas',
    titleKey: 'planner.weekend.title',
    intro: 'Easy options for Saturday or Sunday.',
    introKey: 'planner.weekend.intro',
    href: '?chips=this-weekend',
    predicate: (listing) => CHIP_DEFINITIONS.find((chip) => chip.id === 'this-weekend')?.predicate(listing),
  },
  {
    id: 'free-low-cost',
    title: 'Free and low-cost',
    titleKey: 'planner.free.title',
    intro: 'Start with the gentler budget options.',
    introKey: 'planner.free.intro',
    href: '?chips=free',
    predicate: (listing) => listing.price?.free === true || (typeof listing.price?.amount === 'number' && listing.price.amount <= 10),
  },
  {
    id: 'rainy-day',
    title: 'Rainy-day backup',
    titleKey: 'planner.rainy.title',
    intro: 'Indoor or mixed-setting ideas.',
    introKey: 'planner.rainy.intro',
    href: '?chips=rainy-day',
    predicate: (listing) => CHIP_DEFINITIONS.find((chip) => chip.id === 'rainy-day')?.predicate(listing),
  },
];

function activityUrl(prefix, listing) {
  return `${prefix}/${escapeHtml(listing.slug)}/`;
}

function weeklyPlannerHtml({ city, items, activityPrefix, cityPrefix = '' }) {
  const cards = PLANNER_BUCKETS.map((bucket) => {
    const matches = sortByFreshness(items.filter((listing) => bucket.predicate(listing))).slice(0, 3);
    const rows = matches.length
      ? matches.map((listing) => `            <li>
              <a href="${activityUrl(activityPrefix, listing)}">${escapeHtml(listing.name)}</a>
              <span>${escapeHtml(listing.town)} · ${escapeHtml(listing.ageRange)} · ${escapeHtml(listing.timing)}</span>
            </li>`).join('\n')
      : `            <li class="planner-empty" data-i18n="planner.empty">No matching activities yet.</li>`;
    const filterHref = cityPrefix
      ? `${cityPrefix}${escapeHtml(city.slug)}/${escapeHtml(bucket.href)}`
      : bucket.href;

    return `        <article class="planner-card">
          <div>
            <h3 data-i18n="${escapeHtml(bucket.titleKey)}">${escapeHtml(bucket.title)}</h3>
            <p data-i18n="${escapeHtml(bucket.introKey)}">${escapeHtml(bucket.intro)}</p>
          </div>
          <ul>
${rows}
          </ul>
          <a class="text-link planner-link" href="${filterHref}" data-i18n="planner.viewFilter">View filtered list</a>
        </article>`;
  }).join('\n');

  const sponsor = city.sponsorship?.weeklyPlanner;
  const sponsorHtml = sponsor?.name
    ? `        <aside class="sponsor-note">
          <span data-i18n="planner.sponsor.label">Sponsored by</span>
          <strong>${escapeHtml(sponsor.name)}</strong>
          ${sponsor.url ? `<a class="text-link" href="${escapeHtml(sponsor.url)}" rel="noopener noreferrer" data-i18n="planner.sponsor.visit">Visit sponsor</a>` : ''}
        </aside>`
    : '';

  return `      <section class="weekly-planner" aria-labelledby="weekly-planner-heading">
        <div class="section-heading">
          <h2 id="weekly-planner-heading" data-i18n="planner.heading">This week planner</h2>
          <p class="section-intro" data-i18n="planner.intro">Fast routes for the moments parents actually plan around.</p>
        </div>
        <div class="planner-grid">
${cards}
        </div>
${sponsorHtml}
      </section>`;
}

function cityGuideHtml(city, stats, categories) {
  const bestFor = Array.isArray(city.bestFor) && city.bestFor.length
    ? city.bestFor
    : categories.slice(0, 3).map((category) => category.toLowerCase());
  const bestForText = bestFor.join(', ');
  const cityType = city.kind === 'town' ? 'Town page' : 'Area page';

  return `      <section class="city-guide" aria-labelledby="city-guide-heading">
        <div>
          <p class="eyebrow">${escapeHtml(cityType)}</p>
          <h2 id="city-guide-heading" data-i18n="city.guide.heading">Local guide</h2>
          <p>${escapeHtml(cityGuideText(city))}</p>
        </div>
        <dl class="guide-facts">
          <div>
            <dt data-i18n="city.guide.coverage">Coverage</dt>
            <dd>${escapeHtml(cityCoverage(city))}</dd>
          </div>
          <div>
            <dt data-i18n="city.guide.bestFor">Best for</dt>
            <dd>${escapeHtml(bestForText)}</dd>
          </div>
          <div>
            <dt data-i18n="city.guide.activeMix">Active mix</dt>
            <dd>${stats.active} listings · ${stats.categories} categories</dd>
          </div>
        </dl>
      </section>`;
}

function areaMapHtml(city) {
  const regionCities = regionCitiesFor(city);
  const pins = regionCities.map((targetCity) => {
    const targetActivities = activeActivitiesForCity(targetCity);
    const targetStats = statsForActivities(targetActivities);
    const x = targetCity.mapPosition?.x ?? 50;
    const y = targetCity.mapPosition?.y ?? 50;
    const current = targetCity.slug === city.slug ? ' aria-current="page"' : '';
    return `          <a class="map-pin" href="${cityLinkFrom(city, targetCity)}" style="--x: ${x}%; --y: ${y}%;"${current}>
            <span class="pin-dot" aria-hidden="true"></span>
            <strong>${escapeHtml(targetCity.name)}</strong>
            <small>${targetStats.active} activities</small>
          </a>`;
  }).join('\n');
  const townLinks = regionCities.map((targetCity) => {
    const current = targetCity.slug === city.slug ? ' aria-current="page"' : '';
    return `          <a href="${cityLinkFrom(city, targetCity)}"${current}>
            <strong>${escapeHtml(targetCity.name)}</strong>
            <span>${escapeHtml(firstTownForCity(targetCity))}</span>
          </a>`;
  }).join('\n');

  return `      <section class="area-map-panel" aria-labelledby="area-map-heading">
        <div class="section-heading">
          <h2 id="area-map-heading" data-i18n="city.map.heading">Browse by area</h2>
          <p class="section-intro" data-i18n="city.map.intro">Use the local map to jump between nearby town pages before narrowing by filters.</p>
        </div>
        <div class="area-map-shell">
          <div class="area-map" role="img" aria-label="Nearby places map" data-i18n-attr="aria-label:city.map.aria">
${pins}
          </div>
          <div class="area-map-list" aria-label="Nearby towns" data-i18n-attr="aria-label:city.map.towns">
${townLinks}
          </div>
        </div>
      </section>`;
}

function homePage() {
  const active = activities.filter((a) => a.status !== 'reported-closed');
  const stats = statsForActivities(active);
  const primaryCity = cities[0];
  const shortcutCity = primaryCity?.slug ?? 'haltern-am-see';
  const placeCards = cities.map((city) => {
    const cityActivities = activeActivitiesForCity(city);
    const cityStats = statsForActivities(cityActivities);
    return `        <a class="place-card" href="cities/${escapeHtml(city.slug)}/" style="--hero-image: url('${escapeHtml(city.heroImage ?? 'kinderradar-hero.png')}')">
          <span class="place-card-image" aria-hidden="true"></span>
          <span class="place-card-body">
            <strong>${escapeHtml(city.name)}</strong>
            <span>${escapeHtml(cityShortIntro(city))}</span>
            <small>${cityStats.active} activities · ${cityStats.categories} categories</small>
          </span>
        </a>`;
  }).join('\n');

  const shortcuts = [
    { href: `cities/${shortcutCity}/?chips=this-weekend`, label: 'Weekend ideas', key: 'home.shortcut.weekend' },
    { href: `cities/${shortcutCity}/?chips=free`, label: 'Free activities', key: 'home.shortcut.free' },
    { href: `cities/${shortcutCity}/?chips=rainy-day`, label: 'Rainy-day picks', key: 'home.shortcut.rainy' },
    { href: `cities/${shortcutCity}/?chips=trial-available`, label: 'Trial available', key: 'home.shortcut.trial' },
  ].map((shortcut) => `        <a class="shortcut-card" href="${escapeHtml(shortcut.href)}" data-i18n="${escapeHtml(shortcut.key)}">${escapeHtml(shortcut.label)}</a>`).join('\n');

  const body = `    <main class="page page-home stack">
      <section class="hero hero-shell" style="--hero-image: url('${escapeHtml(primaryCity?.heroImage ?? 'kinderradar-hero.png')}')">
        <div class="hero-copy">
          <p class="eyebrow" data-i18n="home.eyebrow">KinderRadar</p>
          <h1 data-i18n="home.heading">Find kids' activities around Haltern am See.</h1>
          <p data-i18n="home.intro">Choose a nearby place, or jump straight into parent-friendly shortcuts for weekends, rainy days, free options, and trial sessions.</p>
          <a class="button secondary" href="cities/${escapeHtml(shortcutCity)}/" data-i18n="home.browse">Browse all activities</a>
        </div>
        <dl class="hero-stats" aria-label="Activity overview">
          <div><dt>${stats.active}</dt><dd data-i18n="city.stats.activities">active listings</dd></div>
          <div><dt>${stats.categories}</dt><dd data-i18n="city.stats.categories">categories</dd></div>
          <div><dt>${stats.weekend}</dt><dd data-i18n="city.stats.weekend">weekend ideas</dd></div>
        </dl>
        <div class="radar-loader hero-loader" aria-hidden="true">
          <span></span>
        </div>
      </section>

      <section class="home-section" aria-labelledby="home-places-heading">
        <div class="section-heading">
          <h2 id="home-places-heading" data-i18n="home.places.heading">Choose your area</h2>
          <p class="section-intro" data-i18n="home.places.intro">Start broad with Haltern am See, or browse a smaller nearby town page.</p>
        </div>
        <div class="place-grid">
${placeCards}
        </div>
      </section>

      <section class="home-section" aria-labelledby="home-shortcuts-heading">
        <div class="section-heading">
          <h2 id="home-shortcuts-heading" data-i18n="home.shortcuts.heading">Quick starts</h2>
          <p class="section-intro" data-i18n="home.shortcuts.intro">Useful filters parents tend to reach for first.</p>
        </div>
        <div class="shortcut-grid">
${shortcuts}
        </div>
      </section>

${weeklyPlannerHtml({ city: primaryCity, items: active, activityPrefix: 'activities', cityPrefix: 'cities/' })}
    </main>`;

  return layoutHtml({
    title: 'KinderRadar | Kids activities around Haltern am See',
    description: 'Find kids activities around Haltern am See, Sythen, Hullern, and Lavesum with listings that are kept fresh.',
    body,
    ogTitle: 'KinderRadar',
    ogDescription: 'Find kids activities around Haltern am See, Sythen, Hullern, and Lavesum.',
    ogUrl: '/',
    titleI18nKey: 'home.title',
    descriptionI18nKey: 'home.description',
    assetPrefix: '',
  });
}

function cityPage(city) {
  const cityActivities = activeActivitiesForCity(city);
  const cityStats = statsForActivities(cityActivities);
  const categories = Array.from(new Set(cityActivities.map((a) => a.category))).sort();
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

  const categoryOptions = categories
    .map((c) => `<option value="${escapeHtml(c)}" data-i18n="enum.category.${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const chipsHtml = CHIP_DEFINITIONS
    .map((c) => `<button type="button" class="chip" data-chip-id="${c.id}" data-i18n="${escapeHtml(c.labelKey)}" aria-pressed="false">${escapeHtml(c.label)}</button>`)
    .join('');
  const placeLinks = cities
    .map((c) => {
      const active = c.slug === city.slug ? ' aria-current="page"' : '';
      return `<a href="../../cities/${escapeHtml(c.slug)}/"${active}>${escapeHtml(c.name)}</a>`;
    })
    .join('');

  const description = `Find kids' activities in ${city.name} that fit your child, schedule, budget, and confidence level — with listings that are actually kept fresh.`;

  const cityParams = { city: city.name, towns: city.nearbyTowns.join(', ') };

  const body = `    <main class="page stack">
      <header class="page-header hero-shell" style="--hero-image: url('../../assets/${escapeHtml(city.heroImage ?? 'kinderradar-hero.png')}')">
        <div class="hero-copy">
          <p class="eyebrow" data-i18n="city.eyebrow" data-i18n-params="${escapeHtml(JSON.stringify({ city: city.name }))}">KinderRadar ${escapeHtml(city.name)}</p>
          <h1 data-i18n="city.heading">Find kids' activities that fit your child, schedule, budget, and confidence level.</h1>
          <p data-i18n="city.intro" data-i18n-params="${escapeHtml(JSON.stringify(cityParams))}">${escapeHtml(cityShortIntro(city))} Curated for parents around ${escapeHtml(city.name)} (${escapeHtml(city.nearbyTowns.join(', '))}).</p>
          <div class="button-row">
            <a class="button secondary" href="#submit-activity" data-analytics="submit_activity_click" data-i18n="city.submit">Submit or update an activity</a>
          </div>
        </div>
        <dl class="hero-stats" aria-label="Activity overview">
          <div><dt>${cityStats.active}</dt><dd data-i18n="city.stats.activities">active listings</dd></div>
          <div><dt>${cityStats.categories}</dt><dd data-i18n="city.stats.categories">categories</dd></div>
          <div><dt>${cityStats.weekend}</dt><dd data-i18n="city.stats.weekend">weekend ideas</dd></div>
        </dl>
        <div class="radar-loader hero-loader" aria-hidden="true">
          <span></span>
        </div>
      </header>

      <nav class="place-tabs" aria-label="Nearby places" data-i18n-attr="aria-label:city.places.label">
        ${placeLinks}
      </nav>

${cityGuideHtml(city, cityStats, categories)}

${areaMapHtml(city)}

${cityDiscoveryHtml(city)}

${weeklyPlannerHtml({ city, items: cityActivities, activityPrefix: '../../activities' })}

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

  const bookingValue = listing.bookingRequired === true
    ? `<span${i18nAttr('activity.plan.booking.required')}>Booking required</span>`
    : (listing.bookingRequired === false
      ? `<span${i18nAttr('activity.plan.booking.flexible')}>Drop-in may be possible</span>`
      : `<span${i18nAttr('activity.plan.checkOrganizer')}>Check with organizer</span>`);
  const trialRaw = listing.trial?.notes ?? listing.trialAvailability;
  const trialValue = trialRaw
    ? freeValue(trialRaw)
    : `<span${i18nAttr('activity.plan.checkOrganizer')}>Check with organizer</span>`;
  const planningRows = [
    { labelKey: 'activity.plan.booking', label: 'Booking', value: bookingValue },
    { labelKey: 'activity.plan.trial', label: 'Trial', value: trialValue },
    { labelKey: 'activity.plan.setting', label: 'Setting', value: enumValue('enum.setting', listing.setting) || `<span${i18nAttr('enum.notSpecified')}>Not specified</span>` },
    { labelKey: 'activity.plan.parent', label: 'Parent role', value: enumValue('enum.parentParticipation', listing.parentParticipation) || `<span${i18nAttr('enum.notSpecified')}>Not specified</span>` },
    { labelKey: 'activity.plan.cost', label: 'Cost signal', value: freeValue(listing.cost) || `<span${i18nAttr('enum.notSpecified')}>Not specified</span>` },
  ];
  const planningPanel = `      <section class="panel planning-panel" aria-labelledby="planning-heading">
        <h2 id="planning-heading" data-i18n="activity.plan.heading">Before you go</h2>
        <dl class="planning-grid">
${planningRows.map((row) => `          <div><dt data-i18n="${escapeHtml(row.labelKey)}">${escapeHtml(row.label)}</dt><dd>${row.value}</dd></div>`).join('\n')}
        </dl>
      </section>`;

  const checklist = [
    listing.bookingRequired === true
      ? { key: 'activity.checklist.book', text: 'Book or confirm spaces before you go.' }
      : { key: 'activity.checklist.confirm', text: 'Confirm the latest time and availability before setting off.' },
    listing.setting === 'outdoor'
      ? { key: 'activity.checklist.weather', text: 'Check the weather and bring suitable outdoor clothing.' }
      : (listing.setting === 'indoor'
        ? { key: 'activity.checklist.indoor', text: 'Good backup when the weather is not playing along.' }
        : { key: 'activity.checklist.mixed', text: 'Check whether this session runs indoors, outdoors, or both.' }),
    listing.parentParticipation === 'required'
      ? { key: 'activity.checklist.parentRequired', text: 'Plan for a parent or caregiver to stay and participate.' }
      : { key: 'activity.checklist.parentOptional', text: 'Ask whether parents wait, watch, or can leave during the session.' },
    listing.trial?.available || listing.trialAvailability
      ? { key: 'activity.checklist.trial', text: 'Ask about trial-session rules before committing.' }
      : { key: 'activity.checklist.trialUnknown', text: 'Ask whether a trial or first taster session is possible.' },
  ];
  const checklistPanel = `      <section class="panel checklist-panel" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" data-i18n="activity.checklist.heading">Parent checklist</h2>
        <ul>
${checklist.map((item) => `          <li data-i18n="${escapeHtml(item.key)}">${escapeHtml(item.text)}</li>`).join('\n')}
        </ul>
      </section>`;

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

${planningPanel}

${checklistPanel}

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

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });

  await writeFile(join(DIST, 'index.html'), homePage(), 'utf8');
  written += 1;

  for (const city of cities) {
    const out = join(DIST, 'cities', city.slug, 'index.html');
    await writeFileEnsuringDir(out, cityPage(city));
    written += 1;
  }

  // Wipe and regenerate the activities/ tree so deleted entries don't linger.
  for (const listing of activities) {
    const out = join(DIST, 'activities', listing.slug, 'index.html');
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
  await writeFile(join(DIST, 'sitemap.xml'), sitemap, 'utf8');
  await writeFile(
    join(DIST, 'robots.txt'),
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
