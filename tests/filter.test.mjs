import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilters, optionalText } from '../assets/filtering.mjs';
import { activities } from '../assets/activities-data.mjs';

const sampleListing = {
  ageMin: 6,
  ageMax: 12,
  town: 'Haltern am See',
  category: 'Sports',
  beginnerFriendly: 'true',
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
    age: '',
    town: 'Haltern am See',
    category: 'Sports',
    beginnerFriendly: 'true',
  }), true);

  assert.equal(matchesFilters(sampleListing, {
    age: '',
    town: 'Haltern am See',
    category: 'Music',
    beginnerFriendly: 'true',
  }), false);
});

test('validates seed data has required fields and permits optional fields', () => {
  assert.ok(activities.length >= 8);

  const activitiesWithMissingOptionalFields = activities.filter((activity) => !activity.contactUrl || !activity.trialAvailability);
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
  }
});
