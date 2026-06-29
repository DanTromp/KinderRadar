import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activities as defaultActivities,
  categories as defaultCategories,
  cities as defaultCities,
  sections as defaultSections,
} from '../assets/activities-data.mjs';
import { chipById } from '../assets/filtering.mjs';
import { buildOrganizers, organizerSlugForActivity } from '../assets/organizers.mjs';
import {
  daysSince,
  freshnessCoverage,
  normalizedAccessibility,
  normalizedLocation,
  slugify,
} from '../assets/render.mjs';

const TOWN_CRITICAL_MAX = 4;
const TOWN_WEAK_MAX = 9;
const STALE_DAYS = 90;

const COLLECTIONS = [
  {
    id: 'weekend-ideas',
    label: 'Weekend ideas',
    predicate: (activity) => chipById('this-weekend')?.predicate(activity) ?? false,
  },
  {
    id: 'free-and-low-cost',
    label: 'Free and low cost',
    predicate: (activity) => activity.price?.free === true
      || (typeof activity.price?.amount === 'number' && activity.price.amount <= 10),
  },
  {
    id: 'rainy-day',
    label: 'Rainy day',
    predicate: (activity) => chipById('rainy-day')?.predicate(activity) ?? false,
  },
  {
    id: 'trial-friendly',
    label: 'Trial friendly',
    predicate: (activity) => chipById('trial-available')?.predicate(activity) ?? false,
  },
  {
    id: 'ages-3-6',
    label: 'Ages 3-6',
    predicate: (activity) => Number(activity.ageMin) <= 6 && Number(activity.ageMax) >= 3,
  },
  {
    id: 'holiday-camps',
    label: 'Holiday camps',
    predicate: (activity) => activity.section === 'school-holiday-activities',
  },
];

function isActiveActivity(activity) {
  return activity?.status !== 'reported-closed' && activity?.status !== 'inactive';
}

export function coverageTier(count) {
  if (count <= TOWN_CRITICAL_MAX) return 'critical';
  if (count <= TOWN_WEAK_MAX) return 'weak';
  return 'acceptable';
}

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function countBy(items, keyFn, seedKeys = []) {
  const counts = emptyCounts(seedKeys);
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortedCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function metadataGaps(items) {
  return {
    missingStartTime: items.filter((activity) => !activity.startTime).length,
    missingDayOfWeek: items.filter((activity) => !activity.dayOfWeek).length,
    missingAccessibility: items.filter((activity) => !normalizedAccessibility(activity)).length,
    missingGeodata: items.filter((activity) => !normalizedLocation(activity)).length,
  };
}

function verificationSummary(items, now) {
  const coverage = freshnessCoverage(items, now);
  const staleOver90 = items.filter((activity) => {
    const days = daysSince(activity.lastVerified, now);
    return days === null || days > STALE_DAYS;
  }).length;
  const oldest = [...items]
    .map((activity) => ({
      slug: activity.slug,
      name: activity.name,
      town: activity.town,
      lastVerified: activity.lastVerified ?? null,
      days: daysSince(activity.lastVerified, now),
    }))
    .sort((a, b) => (b.days ?? Number.POSITIVE_INFINITY) - (a.days ?? Number.POSITIVE_INFINITY))
    .slice(0, 10);

  return {
    ...coverage,
    staleOver90,
    oldest,
  };
}

function townSetFrom(cities, activities) {
  return [...new Set([
    ...cities.flatMap((city) => Array.isArray(city.nearbyTowns) ? city.nearbyTowns : []),
    ...activities.map((activity) => activity.town).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));
}

function topNames(items, limit = 5) {
  return sortedCounts(items)
    .filter(([, count]) => count > 0)
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}`);
}

export function buildCoverageReport({
  activities = defaultActivities,
  categories = defaultCategories,
  cities = defaultCities,
  sections = defaultSections,
  now = new Date(),
} = {}) {
  const allActivities = Array.isArray(activities) ? activities : [];
  const activeActivities = allActivities.filter(isActiveActivity);
  const inactiveActivities = allActivities.filter((activity) => !isActiveActivity(activity));
  const categoryNames = [...categories];
  const sectionIds = sections.map((section) => section.id);
  const towns = townSetFrom(cities, activeActivities);

  const categoryTotals = countBy(activeActivities, (activity) => activity.category, categoryNames);
  const sectionTotals = countBy(activeActivities, (activity) => activity.section, sectionIds);
  const organizerProfiles = buildOrganizers(activeActivities);
  const organizerTotals = organizerProfiles.map((organizer) => ({
    slug: organizer.slug,
    name: organizer.name,
    activeListings: organizer.activityCount,
    towns: organizer.towns,
    categories: organizer.categories,
  }));

  const globalCategoryOrder = sortedCounts(categoryTotals).map(([category]) => category);
  const townCoverage = towns.map((town) => {
    const scoped = activeActivities.filter((activity) => activity.town === town);
    const categoriesForTown = countBy(scoped, (activity) => activity.category, categoryNames);
    const sectionsForTown = countBy(scoped, (activity) => activity.section, sectionIds);
    return {
      town,
      slug: slugify(town),
      activeListings: scoped.length,
      tier: coverageTier(scoped.length),
      categories: categoriesForTown,
      sections: sectionsForTown,
      missingCategories: globalCategoryOrder.filter((category) => (categoriesForTown[category] ?? 0) === 0),
      thinCategories: sortedCounts(categoriesForTown)
        .filter(([, count]) => count === 1)
        .map(([category]) => category),
      metadataGaps: metadataGaps(scoped),
      verification: verificationSummary(scoped, now),
    };
  });

  const cityCoverage = cities.map((city) => {
    const nearbyTowns = Array.isArray(city.nearbyTowns) ? city.nearbyTowns : [];
    const scoped = activeActivities.filter((activity) => nearbyTowns.includes(activity.town));
    return {
      slug: city.slug,
      name: city.name,
      kind: city.kind ?? 'region',
      nearbyTowns,
      activeListings: scoped.length,
      tier: coverageTier(scoped.length),
      categories: countBy(scoped, (activity) => activity.category, categoryNames),
      sections: countBy(scoped, (activity) => activity.section, sectionIds),
      metadataGaps: metadataGaps(scoped),
      verification: verificationSummary(scoped, now),
    };
  });

  const collectionEligibility = COLLECTIONS.map((collection) => {
    const matched = activeActivities.filter(collection.predicate);
    return {
      id: collection.id,
      label: collection.label,
      activeListings: matched.length,
    };
  });

  const organizerSlugCounts = countBy(activeActivities, organizerSlugForActivity);
  const duplicateOrganizerNames = Object.entries(countBy(
    organizerProfiles,
    (organizer) => organizer.name?.trim().toLowerCase(),
  ))
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));

  const knownTownSet = new Set(cities.flatMap((city) => Array.isArray(city.nearbyTowns) ? city.nearbyTowns : []));
  const knownCategorySet = new Set(categoryNames);
  const knownSectionSet = new Set(sectionIds);

  return {
    generatedAt: now.toISOString(),
    totals: {
      activities: allActivities.length,
      activeActivities: activeActivities.length,
      inactiveActivities: inactiveActivities.length,
      towns: towns.length,
      cityPages: cities.length,
      organizers: organizerProfiles.length,
      categories: categoryNames.length,
      sections: sections.length,
    },
    thresholds: {
      criticalTownMax: TOWN_CRITICAL_MAX,
      weakTownMax: TOWN_WEAK_MAX,
      acceptableTownMin: TOWN_WEAK_MAX + 1,
      staleDays: STALE_DAYS,
    },
    townCoverage,
    cityCoverage,
    categoryCoverage: sortedCounts(categoryTotals).map(([category, activeListings]) => ({ category, activeListings })),
    sectionCoverage: sortedCounts(sectionTotals).map(([sectionId, activeListings]) => {
      const section = sections.find((item) => item.id === sectionId);
      return {
        section: sectionId,
        label: section?.label ?? sectionId,
        activeListings,
      };
    }),
    organizerCoverage: organizerTotals,
    collectionEligibility,
    metadataGaps: metadataGaps(activeActivities),
    verification: verificationSummary(activeActivities, now),
    anomalies: {
      missingTown: activeActivities
        .filter((activity) => !activity.town)
        .map((activity) => activity.slug ?? activity.name ?? '<unknown>'),
      unknownTown: activeActivities
        .filter((activity) => activity.town && !knownTownSet.has(activity.town))
        .map((activity) => ({ slug: activity.slug, town: activity.town })),
      unknownCategory: activeActivities
        .filter((activity) => activity.category && !knownCategorySet.has(activity.category))
        .map((activity) => ({ slug: activity.slug, category: activity.category })),
      unknownSection: activeActivities
        .filter((activity) => activity.section && !knownSectionSet.has(activity.section))
        .map((activity) => ({ slug: activity.slug, section: activity.section })),
      missingOrganizer: activeActivities
        .filter((activity) => !organizerSlugCounts[organizerSlugForActivity(activity)])
        .map((activity) => activity.slug ?? activity.name ?? '<unknown>'),
      duplicateOrganizerNames,
    },
  };
}

function formatPercent(value) {
  return `${Number.isFinite(value) ? value : 0}%`;
}

function formatCoverageLine(item, nameKey = 'town') {
  const name = item[nameKey] ?? item.name;
  const categoryText = topNames(item.categories).join(', ') || 'none';
  const gapText = item.missingCategories?.length
    ? ` | missing top categories: ${item.missingCategories.slice(0, 4).join(', ')}`
    : '';
  return `- [${item.tier}] ${name}: ${item.activeListings} active | categories: ${categoryText}${gapText}`;
}

export function renderCoverageReport(report) {
  const criticalTowns = report.townCoverage.filter((town) => town.tier === 'critical');
  const weakTowns = report.townCoverage.filter((town) => town.tier === 'weak');
  const acceptableTowns = report.townCoverage.filter((town) => town.tier === 'acceptable');
  const metadata = report.metadataGaps;
  const active = report.totals.activeActivities || 0;
  const anomalyCount = Object.values(report.anomalies)
    .reduce((sum, values) => sum + values.length, 0);

  return [
    'KinderRadar Coverage Report',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${report.totals.activeActivities}/${report.totals.activities} active listings, ${report.totals.cityPages} place pages, ${report.totals.towns} towns, ${report.totals.organizers} organizers, ${report.totals.categories} categories, ${report.totals.sections} sections.`,
    `Town thresholds: critical <5, weak <10, acceptable >=10 active listings.`,
    '',
    'Place pages:',
    ...report.cityCoverage.map((city) => `- [${city.tier}] ${city.name} (${city.kind}): ${city.activeListings} active | towns: ${city.nearbyTowns.join(', ')}`),
    '',
    'Town coverage:',
    ...report.townCoverage.map((town) => formatCoverageLine(town)),
    '',
    'Expansion gaps:',
    `- Critical towns (<5): ${criticalTowns.length ? criticalTowns.map((town) => `${town.town} (${town.activeListings})`).join(', ') : 'none'}`,
    `- Weak towns (<10): ${weakTowns.length ? weakTowns.map((town) => `${town.town} (${town.activeListings})`).join(', ') : 'none'}`,
    `- Acceptable starter towns (>=10): ${acceptableTowns.length ? acceptableTowns.map((town) => `${town.town} (${town.activeListings})`).join(', ') : 'none'}`,
    '',
    'Category coverage:',
    ...report.categoryCoverage.map((item) => `- ${item.category}: ${item.activeListings} active`),
    '',
    'Section coverage:',
    ...report.sectionCoverage.map((item) => `- ${item.label} (${item.section}): ${item.activeListings} active`),
    '',
    'Collection eligibility:',
    ...report.collectionEligibility.map((item) => `- ${item.label} (${item.id}): ${item.activeListings} active`),
    '',
    'Organizer coverage:',
    ...report.organizerCoverage.slice(0, 12).map((item) => `- ${item.name}: ${item.activeListings} active | towns: ${item.towns.join(', ') || 'unknown'}`),
    report.organizerCoverage.length > 12 ? `- ... ${report.organizerCoverage.length - 12} more organizers` : '',
    '',
    'Metadata and freshness:',
    `- Missing accessibility: ${metadata.missingAccessibility}/${active}`,
    `- Missing address/geodata: ${metadata.missingGeodata}/${active}`,
    `- Missing dayOfWeek: ${metadata.missingDayOfWeek}/${active}`,
    `- Missing startTime: ${metadata.missingStartTime}/${active}`,
    `- Fresh within 30 days: ${report.verification.fresh30}/${active} (${formatPercent(report.verification.fresh30Pct)})`,
    `- Checked within 90 days: ${report.verification.checked90}/${active} (${formatPercent(report.verification.checked90Pct)})`,
    `- Stale or unknown over 90 days: ${report.verification.staleOver90}/${active}`,
    '',
    'Data anomalies:',
    anomalyCount === 0 ? '- none' : `- ${anomalyCount} anomaly entries found; run with --json for exact records.`,
  ].filter((line) => line !== '').join('\n');
}

function wantsJson(args) {
  return args.includes('--json') || args.includes('--format=json');
}

function printHelp() {
  console.log([
    'Usage: node scripts/coverage-report.mjs [--json|--format=json]',
    '',
    'Reads assets/activities-data.mjs only. Does not query Supabase or write files.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const report = buildCoverageReport();
  if (wantsJson(args)) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderCoverageReport(report));
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
