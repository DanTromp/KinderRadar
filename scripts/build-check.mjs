// Build-time validation. Run before generation so bad data fails the build.
// Exits non-zero with a human-readable list of problems if anything is off.

import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activities, sections, categories, cities } from '../assets/activities-data.mjs';

const requiredFiles = [
  'assets/styles.css',
  'assets/filters.js',
  'assets/update-form.js',
  'assets/analytics.js',
  'assets/theme.js',
  'assets/filtering.mjs',
  'assets/render.mjs',
  'assets/activities-data.mjs',
  'assets/kinderradar-hero.png',
  'assets/kinderradar-hero-sythen.png',
  'assets/kinderradar-hero-hullern.png',
  'assets/kinderradar-hero-lavesum.png',
];

const RECURRING_VALUES = new Set(['weekly', 'monthly', 'one-off']);
const SETTING_VALUES = new Set(['indoor', 'outdoor', 'mixed']);
const PARENT_VALUES = new Set(['required', 'optional', 'none']);
const VERIFIED_BY = new Set(['organizer', 'parent', 'editor']);
const STATUS_VALUES = new Set(['active', 'needs-update', 'reported-closed']);
const CONTACT_METHODS = new Set(['email', 'phone', 'form', 'whatsapp']);
const PRICE_UNITS = new Set([
  'free', 'per-session', 'per-week', 'per-day', 'per-block', 'membership', 'donation',
]);
const CITY_KINDS = new Set(['region', 'town']);
const FEATURED_SHORTCUTS = new Set(['weekend', 'free', 'rainy-day', 'trial', 'preschool', 'primary']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateActivity(a, sectionIds) {
  const errors = [];
  const required = ['slug', 'name', 'section', 'category', 'ageRange',
    'ageMin', 'ageMax', 'town', 'timing', 'cost', 'lastVerified'];
  for (const key of required) {
    if (a[key] === undefined || a[key] === null || a[key] === '') {
      errors.push(`missing required field "${key}"`);
    }
  }
  if (typeof a.beginnerFriendly !== 'boolean') {
    errors.push('"beginnerFriendly" must be a boolean');
  }
  if (a.slug !== undefined && !SLUG_RE.test(a.slug)) {
    errors.push(`slug "${a.slug}" must be kebab-case ([a-z0-9-])`);
  }
  if (a.section && !sectionIds.has(a.section)) {
    errors.push(`unknown section "${a.section}"`);
  }
  if (a.category && !categories.includes(a.category)) {
    errors.push(`unknown category "${a.category}"`);
  }
  if (typeof a.ageMin === 'number' && typeof a.ageMax === 'number' && a.ageMin > a.ageMax) {
    errors.push(`ageMin (${a.ageMin}) > ageMax (${a.ageMax})`);
  }
  if (a.lastVerified) {
    if (!ISO_DATE.test(a.lastVerified)) {
      errors.push(`lastVerified "${a.lastVerified}" must be YYYY-MM-DD`);
    } else {
      const [y, mo, d] = a.lastVerified.split('-').map(Number);
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) {
        errors.push(`lastVerified "${a.lastVerified}" is not a valid calendar date`);
      }
    }
  }
  if (a.contactUrl !== undefined && !validUrl(a.contactUrl)) {
    errors.push(`contactUrl "${a.contactUrl}" is not a valid http(s) URL`);
  }
  if (a.sourceUrl !== undefined && !validUrl(a.sourceUrl)) {
    errors.push(`sourceUrl "${a.sourceUrl}" is not a valid http(s) URL`);
  }
  for (const key of ['contactUrl', 'sourceUrl']) {
    const v = a[key];
    if (typeof v === 'string' && /example\.(org|com|net)/i.test(v)) {
      errors.push(`${key} "${v}" still points at example.org — replace with a real organizer URL`);
    }
  }
  if (a.recurring !== undefined && !RECURRING_VALUES.has(a.recurring)) {
    errors.push(`recurring "${a.recurring}" must be one of ${[...RECURRING_VALUES].join(', ')}`);
  }
  if (a.setting !== undefined && !SETTING_VALUES.has(a.setting)) {
    errors.push(`setting "${a.setting}" must be one of ${[...SETTING_VALUES].join(', ')}`);
  }
  if (a.parentParticipation !== undefined && !PARENT_VALUES.has(a.parentParticipation)) {
    errors.push(`parentParticipation "${a.parentParticipation}" must be one of ${[...PARENT_VALUES].join(', ')}`);
  }
  if (a.verifiedBy !== undefined && !VERIFIED_BY.has(a.verifiedBy)) {
    errors.push(`verifiedBy "${a.verifiedBy}" must be one of ${[...VERIFIED_BY].join(', ')}`);
  }
  if (a.status !== undefined && !STATUS_VALUES.has(a.status)) {
    errors.push(`status "${a.status}" must be one of ${[...STATUS_VALUES].join(', ')}`);
  }
  if (a.contactMethod !== undefined && !CONTACT_METHODS.has(a.contactMethod)) {
    errors.push(`contactMethod "${a.contactMethod}" must be one of ${[...CONTACT_METHODS].join(', ')}`);
  }
  if (a.price !== undefined) {
    if (typeof a.price !== 'object' || a.price === null) {
      errors.push('price must be an object');
    } else {
      if (typeof a.price.free !== 'boolean') errors.push('price.free must be a boolean');
      if (a.price.unit !== undefined && !PRICE_UNITS.has(a.price.unit)) {
        errors.push(`price.unit "${a.price.unit}" must be one of ${[...PRICE_UNITS].join(', ')}`);
      }
      if (a.price.amount !== undefined && typeof a.price.amount !== 'number') {
        errors.push('price.amount must be a number');
      }
    }
  }
  if (a.trial !== undefined) {
    if (typeof a.trial !== 'object' || a.trial === null) {
      errors.push('trial must be an object');
    } else if (typeof a.trial.available !== 'boolean') {
      errors.push('trial.available must be a boolean');
    }
  }
  if (a.geo !== undefined) {
    if (typeof a.geo !== 'object' || a.geo === null
        || typeof a.geo.lat !== 'number' || typeof a.geo.lng !== 'number') {
      errors.push('geo must be { lat: number, lng: number }');
    }
  }
  return errors;
}

function validateCity(city) {
  const errors = [];
  for (const key of ['slug', 'name', 'heroImage', 'nearbyTowns']) {
    if (city[key] === undefined || city[key] === null || city[key] === '') {
      errors.push(`missing required field "${key}"`);
    }
  }
  if (city.slug !== undefined && !SLUG_RE.test(city.slug)) {
    errors.push(`slug "${city.slug}" must be kebab-case ([a-z0-9-])`);
  }
  if (city.kind !== undefined && !CITY_KINDS.has(city.kind)) {
    errors.push(`kind "${city.kind}" must be one of ${[...CITY_KINDS].join(', ')}`);
  }
  if (!Array.isArray(city.nearbyTowns) || city.nearbyTowns.length === 0) {
    errors.push('nearbyTowns must contain at least one town');
  }
  for (const field of ['shortIntro', 'guide', 'coverageLabel']) {
    if (city[field] !== undefined && (typeof city[field] !== 'string' || city[field].trim() === '')) {
      errors.push(`${field} must be a non-empty string when provided`);
    }
  }
  if (city.bestFor !== undefined && (!Array.isArray(city.bestFor) || city.bestFor.some((value) => typeof value !== 'string' || !value.trim()))) {
    errors.push('bestFor must be an array of non-empty strings when provided');
  }
  if (city.mapPosition !== undefined) {
    const { x, y } = city.mapPosition ?? {};
    if (typeof city.mapPosition !== 'object' || city.mapPosition === null
        || typeof x !== 'number' || typeof y !== 'number'
        || x < 0 || x > 100 || y < 0 || y > 100) {
      errors.push('mapPosition must be { x: 0-100, y: 0-100 } when provided');
    }
  }
  if (city.featuredShortcuts !== undefined) {
    if (!Array.isArray(city.featuredShortcuts)) {
      errors.push('featuredShortcuts must be an array when provided');
    } else {
      for (const shortcut of city.featuredShortcuts) {
        if (!FEATURED_SHORTCUTS.has(shortcut)) {
          errors.push(`featuredShortcuts contains unknown shortcut "${shortcut}"`);
        }
      }
    }
  }
  if (city.sponsorship !== undefined) {
    const slot = city.sponsorship?.weeklyPlanner;
    if (typeof city.sponsorship !== 'object' || city.sponsorship === null) {
      errors.push('sponsorship must be an object when provided');
    } else if (slot !== undefined) {
      if (typeof slot !== 'object' || slot === null) {
        errors.push('sponsorship.weeklyPlanner must be an object when provided');
      } else {
        if (typeof slot.name !== 'string' || !slot.name.trim()) {
          errors.push('sponsorship.weeklyPlanner.name must be a non-empty string');
        }
        if (slot.url !== undefined && !validUrl(slot.url)) {
          errors.push(`sponsorship.weeklyPlanner.url "${slot.url}" is not a valid http(s) URL`);
        }
      }
    }
  }
  return errors;
}

export function validateData() {
  const errors = [];
  const sectionIds = new Set(sections.map((s) => s.id));
  const seenSlugs = new Set();

  for (const city of cities) {
    const id = city.slug ?? city.name ?? '<unknown>';
    for (const e of validateCity(city)) {
      errors.push(`city "${id}": ${e}`);
    }
  }

  for (const a of activities) {
    const id = a.slug ?? a.name ?? '<unknown>';
    for (const e of validateActivity(a, sectionIds)) {
      errors.push(`activity "${id}": ${e}`);
    }
    if (a.slug) {
      if (seenSlugs.has(a.slug)) errors.push(`duplicate slug "${a.slug}"`);
      seenSlugs.add(a.slug);
    }
  }

  const cityTowns = new Set(cities.flatMap((c) => c.nearbyTowns));
  for (const a of activities) {
    if (a.town && !cityTowns.has(a.town)) {
      errors.push(`activity "${a.slug}": town "${a.town}" is not covered by any city in cities[]`);
    }
  }

  return errors;
}

const STALE_DAYS = 90;

export function collectWarnings(now = new Date()) {
  const warnings = [];

  // Warn on entries that haven't been verified in over STALE_DAYS days.
  for (const a of activities) {
    if (!a.lastVerified || !ISO_DATE.test(a.lastVerified)) continue;
    const t = Date.parse(a.lastVerified);
    if (Number.isNaN(t)) continue;
    const days = Math.floor((now.getTime() - t) / 86_400_000);
    if (days > STALE_DAYS) {
      warnings.push(`activity "${a.slug}": lastVerified is ${days} days old (>${STALE_DAYS}); needs re-check`);
    }
  }

  // Warn if any filter facet returns 0 active listings — these are dead-ends
  // for users that we should either fill or hide.
  const active = activities.filter((a) => a.status !== 'reported-closed');
  for (const section of sections) {
    if (!active.some((a) => a.section === section.id)) {
      warnings.push(`section "${section.id}" has 0 active listings`);
    }
  }
  for (const city of cities) {
    for (const town of city.nearbyTowns) {
      if (!active.some((a) => a.town === town)) {
        warnings.push(`town "${town}" (${city.slug}) has 0 active listings`);
      }
    }
  }
  const usedCategories = new Set(active.map((a) => a.category));
  for (const cat of categories) {
    if (!usedCategories.has(cat)) {
      warnings.push(`category "${cat}" has 0 active listings`);
    }
  }

  return warnings;
}

async function main() {
  for (const file of requiredFiles) {
    await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
  }

  const errors = validateData();
  if (errors.length > 0) {
    console.error(`Build check failed with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const warnings = collectWarnings();
  if (warnings.length > 0) {
    console.warn(`Build check warnings (${warnings.length}):`);
    for (const w of warnings) console.warn(`  • ${w}`);
  }

  console.log(`Build check passed: ${activities.length} activities, ${cities.length} city/cities.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
