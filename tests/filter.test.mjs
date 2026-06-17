import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesFilters,
  optionalText,
  matchesChips,
  matchesSearch,
  sortByFreshness,
  CHIP_DEFINITIONS,
  chipById,
  parseDayList,
  matchesDayFilter,
} from '../assets/filtering.mjs';
import { activities } from '../assets/activities-data.mjs';

const sampleListing = {
  ageMin: 6,
  ageMax: 12,
  town: 'Haltern am See',
  category: 'Sports',
  beginnerFriendly: true,
};

test('matches listing with no filters', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '', town: '', category: '', beginnerFriendly: '',
  }), true);
});

test('returns false for non-overlapping age range', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '0-3', town: '', category: '', beginnerFriendly: '',
  }), false);
});

test('returns false when town does not match', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '', town: 'Sythen', category: '', beginnerFriendly: '',
  }), false);
});

test('optional text falls back when empty or missing', () => {
  assert.equal(optionalText(''), 'Not specified');
  assert.equal(optionalText('  '), 'Not specified');
  assert.equal(optionalText(undefined), 'Not specified');
  assert.equal(optionalText('First class free'), 'First class free');
});

test('supports category and beginner-friendly filtering', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '', town: 'Haltern am See', category: 'Sports', beginnerFriendly: 'true',
  }), true);

  assert.equal(matchesFilters(sampleListing, {
    age: '', town: 'Haltern am See', category: 'Music', beginnerFriendly: 'true',
  }), false);
});

test('supports day and category filtering together', () => {
  assert.equal(matchesFilters({ ...sampleListing, dayOfWeek: 'Saturday' }, {
    age: '', town: '', category: 'Sports', day: 'weekend', beginnerFriendly: '',
  }), true);

  assert.equal(matchesFilters({ ...sampleListing, dayOfWeek: 'Saturday' }, {
    age: '', town: '', category: 'Music', day: 'weekend', beginnerFriendly: '',
  }), false);

  assert.equal(matchesFilters({ ...sampleListing, dayOfWeek: 'Tuesday' }, {
    age: '', town: '', category: 'Sports', day: 'weekend', beginnerFriendly: '',
  }), false);
});

test('validates seed data has required fields and permits optional fields', () => {
  assert.ok(activities.length >= 8);

  const activitiesWithMissingOptionalFields = activities.filter(
    (activity) => !activity.contactUrl || !activity.trialAvailability,
  );
  assert.ok(activitiesWithMissingOptionalFields.length >= 1);

  for (const activity of activities) {
    assert.ok(activity.name);
    assert.ok(activity.category);
    assert.ok(activity.ageRange);
    assert.ok(activity.town);
    assert.ok(activity.timing);
    assert.ok(activity.cost);
    assert.equal(typeof activity.beginnerFriendly, 'boolean');
    assert.ok(activity.lastVerified);
    assert.ok(activity.slug, 'every activity has a slug');
  }
});

// ---- Phase 3: chip presets ------------------------------------------------

test('every chip definition has id, label, and predicate', () => {
  for (const chip of CHIP_DEFINITIONS) {
    assert.ok(chip.id);
    assert.ok(chip.label);
    assert.equal(typeof chip.predicate, 'function');
  }
});

test('"this weekend" chip matches Saturday/Sunday only', () => {
  const sat = { dayOfWeek: 'Saturday' };
  const tue = { dayOfWeek: 'Tuesday' };
  const weekdayRange = { dayOfWeek: 'Monday-Friday' };
  const weekendRange = { dayOfWeek: 'Saturday-Sunday' };
  assert.equal(matchesChips(sat, ['this-weekend']), true);
  assert.equal(matchesChips(tue, ['this-weekend']), false);
  assert.equal(matchesChips(weekdayRange, ['this-weekend']), false);
  assert.equal(matchesChips(weekendRange, ['this-weekend']), true);
});

test('day parser expands day ranges in data-friendly formats', () => {
  assert.deepEqual(parseDayList('Monday-Friday'), ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  assert.deepEqual(parseDayList('Monday-Wednesday'), ['monday', 'tuesday', 'wednesday']);
  assert.deepEqual(parseDayList('Saturday & Sunday, season'), ['saturday', 'sunday']);
});

test('day filter supports weekday, weekend, and individual days', () => {
  assert.equal(matchesDayFilter({ dayOfWeek: 'Monday-Friday' }, 'weekday'), true);
  assert.equal(matchesDayFilter({ dayOfWeek: 'Monday-Friday' }, 'weekend'), false);
  assert.equal(matchesDayFilter({ dayOfWeek: 'Saturday-Sunday' }, 'weekend'), true);
  assert.equal(matchesDayFilter({ dayOfWeek: 'Monday-Wednesday' }, 'wednesday'), true);
  assert.equal(matchesDayFilter({ dayOfWeek: 'Monday-Wednesday' }, 'thursday'), false);
});

test('"after kindergarten" chip requires a weekday and start time >= 14:00', () => {
  assert.equal(matchesChips({ dayOfWeek: 'Tuesday', startTime: '16:00' }, ['after-kindergarten']), true);
  assert.equal(matchesChips({ dayOfWeek: 'Tuesday', startTime: '10:00' }, ['after-kindergarten']), false);
  assert.equal(matchesChips({ dayOfWeek: 'Saturday', startTime: '16:00' }, ['after-kindergarten']), false);
});

test('"free" chip matches price.free === true', () => {
  assert.equal(matchesChips({ price: { free: true } }, ['free']), true);
  assert.equal(matchesChips({ price: { free: false } }, ['free']), false);
  assert.equal(matchesChips({}, ['free']), false);
});

test('"no-membership" excludes membership pricing', () => {
  assert.equal(matchesChips({ price: { unit: 'membership' } }, ['no-membership']), false);
  assert.equal(matchesChips({ price: { unit: 'per-session' } }, ['no-membership']), true);
  assert.equal(matchesChips({}, ['no-membership']), true);
});

test('"rainy day" matches indoor or mixed setting', () => {
  assert.equal(matchesChips({ setting: 'indoor' }, ['rainy-day']), true);
  assert.equal(matchesChips({ setting: 'mixed' }, ['rainy-day']), true);
  assert.equal(matchesChips({ setting: 'outdoor' }, ['rainy-day']), false);
});

test('multiple chips compose with AND', () => {
  const free = { price: { free: true }, dayOfWeek: 'Saturday', setting: 'outdoor' };
  assert.equal(matchesChips(free, ['free', 'this-weekend']), true);
  assert.equal(matchesChips(free, ['free', 'rainy-day']), false);
});

test('chipById returns the right chip or null', () => {
  assert.equal(chipById('free').id, 'free');
  assert.equal(chipById('does-not-exist'), null);
});

// ---- Phase 3: search ------------------------------------------------------

test('search matches case-insensitively across name/category/town', () => {
  const l = { name: 'Rookie Swim Start', category: 'Swimming', town: 'Haltern am See' };
  assert.equal(matchesSearch(l, 'rookie'), true);
  assert.equal(matchesSearch(l, 'SWIM'), true);
  assert.equal(matchesSearch(l, 'haltern'), true);
  assert.equal(matchesSearch(l, 'pottery'), false);
  assert.equal(matchesSearch(l, ''), true);
  assert.equal(matchesSearch(l, '   '), true);
});

// ---- Phase 4: sort --------------------------------------------------------

test('sortByFreshness puts newer lastVerified first', () => {
  const list = [
    { name: 'A', lastVerified: '2026-01-01' },
    { name: 'B', lastVerified: '2026-06-01' },
    { name: 'C', lastVerified: '2026-03-01' },
  ];
  const sorted = sortByFreshness(list).map((x) => x.name);
  assert.deepEqual(sorted, ['B', 'C', 'A']);
});

test('sortByFreshness sinks reported-closed entries', () => {
  const list = [
    { name: 'Closed', lastVerified: '2026-06-01', status: 'reported-closed' },
    { name: 'Old', lastVerified: '2026-01-01' },
    { name: 'New', lastVerified: '2026-06-01' },
  ];
  const sorted = sortByFreshness(list).map((x) => x.name);
  assert.equal(sorted[sorted.length - 1], 'Closed');
});
