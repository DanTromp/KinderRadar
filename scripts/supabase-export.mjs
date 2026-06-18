import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import {
  sections as existingSections,
  categories as existingCategories,
  cities as existingCities,
} from '../assets/activities-data.mjs';

function parseEnv(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function loadEnv() {
  const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || key === 'replace_with_service_role_key_locally') {
    throw new Error('Set SUPABASE_URL and a Supabase key in .env before exporting.');
  }

  return { url: url.replace(/\/$/, ''), key };
}

async function getRows(config, table, query = 'select=*') {
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to read ${table}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => (
      v !== undefined
      && v !== null
      && !(typeof v === 'string' && v.trim() === '')
      && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
    )),
  );
}

function activityFromRow(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return compactObject({
    ...raw,
    slug: row.slug,
    name: row.name,
    section: row.section,
    category: row.category,
    ageRange: row.age_range,
    ageMin: row.age_min,
    ageMax: row.age_max,
    town: row.town,
    timing: row.timing,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    recurring: row.recurring,
    cost: row.cost,
    price: row.price,
    beginnerFriendly: row.beginner_friendly,
    trial: row.trial,
    trialAvailability: row.trial_availability,
    bookingRequired: row.booking_required,
    setting: row.setting,
    parentParticipation: row.parent_participation,
    language: row.language,
    accessibility: row.accessibility,
    contactUrl: row.contact_url,
    contactMethod: row.contact_method,
    sourceUrl: row.source_url,
    lastVerified: row.last_verified,
    verifiedBy: row.verified_by,
    status: row.status,
  });
}

function mergeCategories(activities) {
  const known = new Set(existingCategories);
  const added = [...new Set(activities.map((activity) => activity.category))]
    .filter((category) => category && !known.has(category))
    .sort();
  return [...existingCategories, ...added];
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultHeroImage(slug, fallback = 'meinkinderradar-hero.png') {
  const candidate = `meinkinderradar-hero-${slug}.png`;
  return existsSync(new URL(`../assets/${candidate}`, import.meta.url)) ? candidate : fallback;
}

function cityRowsToData(cityRows, townRows) {
  const existingBySlug = new Map(existingCities.map((city) => [city.slug, city]));
  const citySlugs = new Set(cityRows.map((city) => city.slug));
  const localFields = [
    'kind',
    'regionSlug',
    'state',
    'country',
    'heroImage',
    'mapPosition',
    'coverageLabel',
    'shortIntro',
    'guide',
    'bestFor',
    'featuredShortcuts',
    'sponsorship',
  ];
  const regions = cityRows.map((city) => {
    const towns = townRows
      .filter((town) => town.city_slug === city.slug)
      .map((town) => town.name);
    const existingOrder = existingBySlug.get(city.slug)?.nearbyTowns ?? [];
    const ordered = [
      ...existingOrder.filter((town) => towns.includes(town)),
      ...towns.filter((town) => !existingOrder.includes(town)).sort(),
    ];

    const existing = existingBySlug.get(city.slug);
    const nearbyTowns = ordered.length ? ordered : [city.name];
    const isRegion = nearbyTowns.length > 1;
    return {
      slug: city.slug,
      name: city.name,
      kind: existing?.kind ?? (isRegion ? 'region' : 'town'),
      regionSlug: existing?.regionSlug ?? city.slug,
      state: existing?.state ?? 'North Rhine-Westphalia',
      country: existing?.country ?? 'DE',
      heroImage: existing?.heroImage ?? 'meinkinderradar-hero.png',
      mapPosition: existing?.mapPosition ?? { x: 50, y: 50 },
      coverageLabel: existing?.coverageLabel ?? nearbyTowns.join(', '),
      shortIntro: existing?.shortIntro ?? `A local My Kids Radar page for families around ${city.name}.`,
      guide: existing?.guide ?? `Use this page to browse activities around ${city.name}, then narrow by age, day, category, price, and beginner confidence.`,
      bestFor: existing?.bestFor ?? ['local browsing', 'weekend ideas', 'trial-friendly options'],
      featuredShortcuts: existing?.featuredShortcuts ?? ['weekend', 'free', 'rainy-day', 'trial'],
      ...Object.fromEntries(
        localFields
          .filter((field) => existing?.[field] !== undefined)
          .map((field) => [field, existing[field]]),
      ),
      nearbyTowns,
    };
  });

  const regionBySlug = new Map(regions.map((city) => [city.slug, city]));
  const townPages = townRows
    .map((town, index) => {
      const slug = slugify(town.name);
      if (!slug || citySlugs.has(slug)) return null;

      const region = regionBySlug.get(town.city_slug);
      const existing = existingBySlug.get(slug);
      const fallbackHero = defaultHeroImage(slug, region?.heroImage ?? 'meinkinderradar-hero.png');

      return {
        slug,
        name: town.name,
        kind: existing?.kind ?? 'town',
        regionSlug: existing?.regionSlug ?? town.city_slug,
        state: existing?.state ?? region?.state ?? 'North Rhine-Westphalia',
        country: existing?.country ?? region?.country ?? 'DE',
        heroImage: existing?.heroImage ?? fallbackHero,
        mapPosition: existing?.mapPosition ?? {
          x: 24 + ((index % 4) * 18),
          y: 32 + (Math.floor(index / 4) * 22),
        },
        coverageLabel: existing?.coverageLabel ?? town.name,
        shortIntro: existing?.shortIntro ?? `A focused My Kids Radar page for families around ${town.name}.`,
        guide: existing?.guide ?? `Use this page to stay close to ${town.name} first, then widen to the wider ${region?.name ?? 'local'} area when needed.`,
        bestFor: existing?.bestFor ?? ['close-to-home checks', 'local activities', 'weekend ideas'],
        featuredShortcuts: existing?.featuredShortcuts ?? ['weekend', 'free', 'rainy-day', 'trial'],
        ...Object.fromEntries(
          localFields
            .filter((field) => existing?.[field] !== undefined)
            .map((field) => [field, existing[field]]),
        ),
        nearbyTowns: [town.name],
      };
    })
    .filter(Boolean);

  return [...regions, ...townPages];
}

function sortActivities(activities) {
  const sectionOrder = new Map(existingSections.map((section, index) => [section.id, index]));
  return [...activities].sort((a, b) => {
    const sectionDiff = (sectionOrder.get(a.section) ?? 999) - (sectionOrder.get(b.section) ?? 999);
    if (sectionDiff !== 0) return sectionDiff;
    return String(a.name).localeCompare(String(b.name));
  });
}

function jsExport(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)};\n`;
}

async function main() {
  const config = await loadEnv();
  const [cityRows, townRows, activityRows] = await Promise.all([
    getRows(config, 'cities', 'select=slug,name&order=slug.asc'),
    getRows(config, 'towns', 'select=city_slug,name&order=name.asc'),
    getRows(config, 'activities', 'select=*&order=section.asc,name.asc'),
  ]);

  const activities = sortActivities(activityRows.map(activityFromRow));
  const cities = cityRowsToData(cityRows, townRows);
  const categories = mergeCategories(activities);

  const output = [
    '// Generated from Supabase by `npm run supabase:export`.',
    '// Edit Supabase rows, then export again. Do not edit this file by hand.',
    '',
    jsExport('sections', existingSections).trimEnd(),
    '',
    jsExport('categories', categories).trimEnd(),
    '',
    jsExport('cities', cities).trimEnd(),
    '',
    jsExport('activities', activities).trimEnd(),
    '',
  ].join('\n');

  await writeFile(new URL('../assets/activities-data.mjs', import.meta.url), output, 'utf8');
  console.log(`Exported ${cities.length} city/cities and ${activities.length} activities from Supabase.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
