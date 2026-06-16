// Build-time validation. Run before generation so bad data fails the build.
// Exits non-zero with a human-readable list of problems if anything is off.

import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

import { activities, sections, categories, cities } from '../assets/activities-data.mjs';

const requiredFiles = [
  'index.html',
  'assets/styles.css',
  'assets/filters.js',
  'assets/filtering.mjs',
  'assets/render.mjs',
  'assets/activities-data.mjs',
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

export function validateData() {
  const errors = [];
  const sectionIds = new Set(sections.map((s) => s.id));
  const seenSlugs = new Set();

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

  console.log(`Build check passed: ${activities.length} activities, ${cities.length} city/cities.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
