import { activities } from './activities-data.mjs';
import { slugify } from './render.mjs';

const HOST_LABELS = {
  'biologische-station-re.de': 'Biologische Station Kreis Recklinghausen',
  'djk-duelmen.de': 'DJK Dülmen',
  'djk-lembeck.de': 'DJK Lembeck',
  'dorsten.de': 'Stadt Dorsten',
  'duelmen.de': 'Stadt Dülmen',
  'fc-dorsten.de': 'FC Dorsten',
  'haltern-am-see.de': 'Stadt Haltern am See',
  'haltern.dlrg.de': 'DLRG Haltern',
  'jmw.de': 'Jüdisches Museum Westfalen',
  'kletterwald-haard.de': 'Kletterwald Haltern',
  'kolping-haltern.de': 'Kolping Haltern',
  'kreismusikschule-coesfeld.de': 'Kreismusikschule Coesfeld',
  'lwl.org': 'LWL-Römermuseum',
  'musikschule-haltern.de': 'Musikschule Haltern',
  'rc-haltern.de': 'RC Haltern',
  'rfv-haltern.de': 'Reit- und Fahrverein Haltern',
  'rvr.ruhr': 'Regionalverband Ruhr',
  'sc-merfeld.de': 'SC Merfeld',
  'sc-wacker-dorsten.de': 'SC Wacker Dorsten',
  'st-sixtus.de': 'Pfarrei St. Sixtus',
  'sus-haltern.de': 'SuS Haltern',
  'sv-duelmen.de': 'SV Dülmen',
  'sv-lippramsdorf.de': 'SV Lippramsdorf',
  'sv-rorup.de': 'SV Rorup',
  'tc-sythen.de': 'TC Sythen',
  'tus-buldern.de': 'TuS Buldern',
  'tus-hullern.de': 'TuS Hullern',
  'tus-sythen.de': 'TuS Sythen',
  'tus-wulfen.de': 'TuS Wulfen',
  'tushaltern.de': 'TuS Haltern',
  'vhs-dorsten.de': 'VHS Dorsten',
  'vhs-duelmen.de': 'VHS Dülmen-Haltern-Dorsten',
  'wildpferde-duelmen.de': 'Wildpferdebahn Dülmen',
};

export function hostForActivity(activity) {
  const rawUrl = activity?.contactUrl || activity?.sourceUrl || '';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function labelFromHost(host) {
  if (HOST_LABELS[host]) return HOST_LABELS[host];
  const stem = host.split('.').slice(0, -1).join('.') || host;
  return stem
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

export function organizerNameForActivity(activity) {
  if (activity?.organizer?.name) return activity.organizer.name;
  const host = hostForActivity(activity);
  if (host) return labelFromHost(host);
  return String(activity?.name ?? 'Unknown organizer').split(/[-–:]/)[0].trim();
}

export function organizerSlugForActivity(activity) {
  return activity?.organizer?.slug ?? slugify(organizerNameForActivity(activity));
}

export function buildOrganizers(items = activities) {
  const bySlug = new Map();

  for (const activity of items) {
    const slug = organizerSlugForActivity(activity);
    const host = hostForActivity(activity);
    const name = organizerNameForActivity(activity);
    const source = activity?.organizer ?? {};
    const existing = bySlug.get(slug) ?? {
      slug,
      name,
      host,
      websiteUrl: source.websiteUrl || source.website || activity.contactUrl || activity.sourceUrl || '',
      contactEmail: source.contactEmail || source.email || '',
      phone: source.phone || '',
      address: source.address || '',
      location: source.location ?? null,
      logoUrl: source.logoUrl || '',
      description: source.description || '',
      verificationStatus: source.verificationStatus || '',
      contactMethod: activity.contactMethod ?? '',
      activitySlugs: [],
      towns: [],
      categories: [],
      claimed: source.claimed === true,
      sponsorship: source.sponsorship ?? null,
    };

    existing.activitySlugs.push(activity.slug);
    existing.towns = [...new Set([...existing.towns, activity.town].filter(Boolean))].sort();
    existing.categories = [...new Set([...existing.categories, activity.category].filter(Boolean))].sort();
    if (!existing.websiteUrl) existing.websiteUrl = activity.contactUrl || activity.sourceUrl || '';
    if (!existing.contactMethod) existing.contactMethod = activity.contactMethod ?? '';
    if (!existing.contactEmail) existing.contactEmail = source.contactEmail || source.email || '';
    if (!existing.phone) existing.phone = source.phone || '';
    if (!existing.address) existing.address = source.address || '';
    if (!existing.location) existing.location = source.location ?? null;
    if (!existing.logoUrl) existing.logoUrl = source.logoUrl || '';
    if (!existing.description) existing.description = source.description || '';
    if (!existing.verificationStatus) existing.verificationStatus = source.verificationStatus || '';
    if (source.claimed === true) existing.claimed = true;
    if (!existing.sponsorship && source.sponsorship) existing.sponsorship = source.sponsorship;
    bySlug.set(slug, existing);
  }

  return [...bySlug.values()]
    .map((organizer) => ({
      ...organizer,
      activityCount: organizer.activitySlugs.length,
      monetizationTier: organizer.sponsorship?.tier ?? 'free',
    }))
    .sort((a, b) => b.activityCount - a.activityCount || a.name.localeCompare(b.name));
}

export const organizers = buildOrganizers(activities);

const ORGANIZER_BY_SLUG = new Map(organizers.map((organizer) => [organizer.slug, organizer]));

export function organizerForActivity(activity) {
  return ORGANIZER_BY_SLUG.get(organizerSlugForActivity(activity)) ?? null;
}
