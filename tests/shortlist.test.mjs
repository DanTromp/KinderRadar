import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupSavedActivitiesByDay,
  normalizeSavedSlugs,
  removeSavedSlug,
  renderMissingSavedHtml,
  renderShortlistPlannerHtml,
  savedActivitiesFromSlugs,
} from '../assets/shortlist.mjs';

const activities = [
  {
    slug: 'swim',
    name: 'Lake Swim',
    town: 'Haltern am See',
    dayOfWeek: 'Tuesday',
    startTime: '16:00',
    lastVerified: '2026-06-20',
  },
  {
    slug: 'music',
    name: 'Music Start',
    town: 'Dülmen',
    dayOfWeek: 'Saturday-Sunday',
    startTime: '10:00',
    lastVerified: '2026-06-25',
  },
  {
    slug: 'unknown-time',
    name: 'Ask Organizer',
    town: 'Sythen',
    dayOfWeek: '',
    lastVerified: '2026-06-18',
  },
];

test('normalizeSavedSlugs keeps valid unique slugs and reports removed ids', () => {
  assert.deepEqual(normalizeSavedSlugs(['swim', 'missing', 'swim', 'old'], activities), {
    valid: ['swim'],
    missing: ['missing', 'old'],
  });
});

test('savedActivitiesFromSlugs renders saved activities from current data', () => {
  const saved = savedActivitiesFromSlugs('swim,music,missing', activities);

  assert.deepEqual(saved.map((activity) => activity.slug), ['music', 'swim']);
});

test('removeSavedSlug removes a saved item without disturbing the rest', () => {
  assert.deepEqual(removeSavedSlug(['swim', 'music', 'swim'], 'swim'), ['music']);
});

test('groupSavedActivitiesByDay groups by schedule and keeps unscheduled items visible', () => {
  const groups = groupSavedActivitiesByDay(activities);

  assert.ok(groups.find((group) => group.id === 'tuesday')?.activities.some((activity) => activity.slug === 'swim'));
  assert.ok(groups.find((group) => group.id === 'saturday')?.activities.some((activity) => activity.slug === 'music'));
  assert.ok(groups.find((group) => group.id === 'sunday')?.activities.some((activity) => activity.slug === 'music'));
  assert.ok(groups.find((group) => group.id === 'unscheduled')?.activities.some((activity) => activity.slug === 'unknown-time'));
});

test('renderShortlistPlannerHtml shows saved activities and empty state stays empty', () => {
  const html = renderShortlistPlannerHtml(activities);

  assert.match(html, /shortlist-planner/);
  assert.match(html, /Lake Swim/);
  assert.match(html, /Dülmen/);
  assert.equal(renderShortlistPlannerHtml([]), '');
});

test('renderMissingSavedHtml reports stale saved activity ids', () => {
  const html = renderMissingSavedHtml(['old-slug']);

  assert.match(html, /Some saved items/);
  assert.match(html, /old-slug/);
  assert.equal(renderMissingSavedHtml([]), '');
});
