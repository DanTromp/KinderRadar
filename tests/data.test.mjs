import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/build-check.mjs';
import { activities, sections, cities } from '../assets/activities-data.mjs';
import { organizers, organizerForActivity } from '../assets/organizers.mjs';

test('seed data passes validation', () => {
  const errors = validateData();
  assert.deepEqual(errors, [], `unexpected validation errors:\n${errors.join('\n')}`);
});

test('every activity belongs to a known section', () => {
  const ids = new Set(sections.map((s) => s.id));
  for (const a of activities) {
    assert.ok(ids.has(a.section), `unknown section ${a.section} for ${a.slug}`);
  }
});

test('every activity town is covered by some city', () => {
  const towns = new Set(cities.flatMap((c) => c.nearbyTowns));
  for (const a of activities) {
    assert.ok(towns.has(a.town), `town ${a.town} not in any city`);
  }
});

test('city metadata supports scalable place pages', () => {
  const knownShortcuts = new Set(['weekend', 'free', 'rainy-day', 'trial', 'preschool', 'primary']);
  for (const city of cities) {
    assert.match(city.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad city slug: ${city.slug}`);
    assert.ok(['region', 'town'].includes(city.kind), `city ${city.slug} needs kind region/town`);
    assert.equal(typeof city.heroImage, 'string', `city ${city.slug} needs heroImage`);
    assert.ok(city.shortIntro?.trim(), `city ${city.slug} needs shortIntro`);
    assert.ok(city.guide?.trim(), `city ${city.slug} needs guide`);
    assert.equal(typeof city.mapPosition?.x, 'number', `city ${city.slug} needs mapPosition.x`);
    assert.equal(typeof city.mapPosition?.y, 'number', `city ${city.slug} needs mapPosition.y`);
    assert.ok(city.mapPosition.x >= 0 && city.mapPosition.x <= 100, `city ${city.slug} mapPosition.x out of range`);
    assert.ok(city.mapPosition.y >= 0 && city.mapPosition.y <= 100, `city ${city.slug} mapPosition.y out of range`);
    assert.ok(Array.isArray(city.bestFor) && city.bestFor.length > 0, `city ${city.slug} needs bestFor`);
    assert.ok(Array.isArray(city.featuredShortcuts) && city.featuredShortcuts.length > 0, `city ${city.slug} needs featuredShortcuts`);
    for (const shortcut of city.featuredShortcuts) {
      assert.ok(knownShortcuts.has(shortcut), `city ${city.slug} has unknown shortcut ${shortcut}`);
    }
  }
});

test('slugs are unique', () => {
  const seen = new Set();
  for (const a of activities) {
    assert.ok(!seen.has(a.slug), `duplicate slug: ${a.slug}`);
    seen.add(a.slug);
  }
});

test('organizer profiles are derived for every activity', () => {
  assert.ok(organizers.length > 10, 'expected organizer profiles from seeded data');
  const organizerSlugs = new Set();
  for (const organizer of organizers) {
    assert.match(organizer.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad organizer slug: ${organizer.slug}`);
    assert.ok(!organizerSlugs.has(organizer.slug), `duplicate organizer slug: ${organizer.slug}`);
    organizerSlugs.add(organizer.slug);
    assert.ok(organizer.name.trim(), `organizer ${organizer.slug} needs a name`);
    assert.ok(organizer.activitySlugs.length > 0, `organizer ${organizer.slug} needs activities`);
  }

  for (const activity of activities) {
    assert.ok(organizerForActivity(activity), `missing organizer for ${activity.slug}`);
  }
});
