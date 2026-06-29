import { readFile } from 'node:fs/promises';
import { activities, cities } from '../assets/activities-data.mjs';
import { organizers } from '../assets/organizers.mjs';

function parseEnv(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

async function loadEnv() {
  const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const url = env.SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole || serviceRole === 'replace_with_service_role_key_locally') {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before importing.');
  }

  return { url: url.replace(/\/$/, ''), serviceRole };
}

function headers(serviceRole) {
  return {
    apikey: serviceRole,
    authorization: `Bearer ${serviceRole}`,
    'content-type': 'application/json',
    prefer: 'resolution=merge-duplicates,return=minimal',
  };
}

async function upsert({ url, serviceRole }, table, rows, conflict) {
  if (rows.length === 0) return;
  const endpoint = `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers(serviceRole),
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to upsert ${table}: ${response.status} ${body}`);
  }
}

function activityRow(activity) {
  const accessibilityText = typeof activity.accessibility === 'string'
    ? activity.accessibility
    : (typeof activity.accessibility?.notes === 'string' ? activity.accessibility.notes : null);
  return {
    slug: activity.slug,
    name: activity.name,
    section: activity.section,
    category: activity.category,
    age_range: activity.ageRange,
    age_min: activity.ageMin,
    age_max: activity.ageMax,
    town: activity.town,
    timing: activity.timing,
    day_of_week: activity.dayOfWeek ?? null,
    start_time: activity.startTime ?? null,
    end_time: activity.endTime ?? null,
    recurring: activity.recurring ?? null,
    cost: activity.cost,
    price: activity.price ?? {},
    beginner_friendly: activity.beginnerFriendly,
    trial: activity.trial ?? {},
    trial_availability: activity.trialAvailability ?? null,
    booking_required: activity.bookingRequired ?? null,
    setting: activity.setting ?? null,
    parent_participation: activity.parentParticipation ?? null,
    language: activity.language ?? null,
    accessibility: accessibilityText,
    contact_url: activity.contactUrl ?? null,
    contact_method: activity.contactMethod ?? null,
    source_url: activity.sourceUrl ?? null,
    last_verified: activity.lastVerified,
    verified_by: activity.verifiedBy ?? 'editor',
    status: activity.status ?? 'active',
    raw_data: activity,
  };
}

function sourceRows() {
  return activities
    .filter((activity) => activity.sourceUrl)
    .map((activity) => ({
      activity_slug: activity.slug,
      url: activity.sourceUrl,
      source_type: 'website',
      status: 'active',
    }));
}

function verificationRows() {
  return activities.map((activity) => ({
    activity_slug: activity.slug,
    verified_by: activity.verifiedBy ?? 'editor',
    verified_at: activity.lastVerified,
    source_url: activity.sourceUrl ?? null,
    notes: 'Initial import from curated static dataset.',
  }));
}

function feedRows() {
  return activities
    .filter((activity) => activity.status !== 'reported-closed')
    .flatMap((activity) => {
      const city = cities.find((candidate) => candidate.nearbyTowns.includes(activity.town));
      if (!city) return [];
      return [{
        activity_slug: activity.slug,
        city_slug: city.slug,
        kind: 'recently_verified',
        title: activity.name,
        reason: `${activity.category} in ${activity.town}`,
        status: 'published',
        metadata: {
          ageRange: activity.ageRange,
          beginnerFriendly: activity.beginnerFriendly,
          lastVerified: activity.lastVerified,
        },
      }];
    });
}

async function main() {
  const config = await loadEnv();

  await upsert(config, 'cities', cities.map((city) => ({
    slug: city.slug,
    name: city.name,
  })), 'slug');

  await upsert(config, 'organizers', organizers.map((organizer) => ({
    slug: organizer.slug,
    name: organizer.name,
    website_url: organizer.websiteUrl || null,
    contact_method: organizer.contactMethod || null,
  })), 'slug');

  await upsert(config, 'towns', cities.flatMap((city) => (
    city.nearbyTowns.map((town) => ({
      city_slug: city.slug,
      name: town,
    }))
  )), 'city_slug,name');

  await upsert(config, 'activities', activities.map(activityRow), 'slug');
  await upsert(config, 'activity_sources', sourceRows(), 'activity_slug,url');
  await upsert(config, 'feed_items', feedRows(), 'activity_slug,city_slug,kind');

  // Verification events are append-only by design, so avoid duplicate imports
  // by inserting them only when explicitly requested.
  if (process.argv.includes('--with-verification-events')) {
    const endpoint = `${config.url}/rest/v1/verification_events`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: config.serviceRole,
        authorization: `Bearer ${config.serviceRole}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(verificationRows()),
    });
    if (!response.ok) {
      throw new Error(`Failed to insert verification_events: ${response.status} ${await response.text()}`);
    }
  }

  console.log(`Imported ${cities.length} city/cities, ${organizers.length} organizers, and ${activities.length} activities into Supabase.`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PGRST205') || message.includes("Could not find the table")) {
    console.error('Supabase tables are not created yet. Run supabase/schema.sql in the Supabase SQL Editor, then run npm run supabase:import again.');
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
