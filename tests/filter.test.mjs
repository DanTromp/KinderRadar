import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilters, optionalText } from '../assets/filtering.mjs';

const sampleListing = {
  ageMin: 6,
  ageMax: 12,
  type: 'sports clubs',
  weekdays: ['Monday', 'Wednesday'],
  setting: 'outdoor',
  cost: 'paid',
  beginnerFriendly: 'yes',
};

test('matches listing with no filters', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '', type: '', weekday: '', setting: '', cost: '', beginnerFriendly: '',
  }), true);
});

test('returns false for non-overlapping age range', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '0-3', type: '', weekday: '', setting: '', cost: '', beginnerFriendly: '',
  }), false);
});

test('returns false when weekday does not match', () => {
  assert.equal(matchesFilters(sampleListing, {
    age: '', type: '', weekday: 'Sunday', setting: '', cost: '', beginnerFriendly: '',
  }), false);
});

test('optional text falls back when empty or missing', () => {
  assert.equal(optionalText(''), 'Not specified');
  assert.equal(optionalText('  '), 'Not specified');
  assert.equal(optionalText(undefined), 'Not specified');
  assert.equal(optionalText('First class free'), 'First class free');
});
