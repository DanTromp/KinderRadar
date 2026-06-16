import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/build-check.mjs';
import { activities, sections, cities } from '../assets/activities-data.mjs';

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

test('slugs are unique', () => {
  const seen = new Set();
  for (const a of activities) {
    assert.ok(!seen.has(a.slug), `duplicate slug: ${a.slug}`);
    seen.add(a.slug);
  }
});
