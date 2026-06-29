import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_TIMEZONE,
  calendarEventForActivity,
  createIcsCalendar,
  escapeIcsText,
} from '../assets/calendar.mjs';

const now = new Date('2026-06-29T10:00:00Z');

const completeActivity = {
  slug: 'mueller-kids-fun',
  name: 'Müller, Kids; Fun \\ Club',
  town: 'Dülmen',
  dayOfWeek: 'Tuesday',
  startTime: '16:15',
  endTime: '17:30',
  timing: 'Tuesday, 16:15-17:30',
  cost: 'Free',
  address: 'Markt 1, Dülmen',
  contactUrl: 'https://example.org/activity',
};

test('calendarEventForActivity builds a Berlin-time event for complete schedule data', () => {
  const result = calendarEventForActivity(completeActivity, { now });

  assert.equal(result.ok, true);
  assert.ok(result.event.includes(`DTSTART;TZID=${CALENDAR_TIMEZONE}:20260630T161500`));
  assert.ok(result.event.includes(`DTEND;TZID=${CALENDAR_TIMEZONE}:20260630T173000`));
  assert.ok(result.event.some((line) => /LOCATION:Markt 1\\, Dülmen/.test(line)));
});

test('calendarEventForActivity rejects incomplete schedule data safely', () => {
  assert.equal(calendarEventForActivity({ ...completeActivity, name: '' }, { now }).reason, 'missing-name');
  assert.equal(calendarEventForActivity({ ...completeActivity, startTime: '' }, { now }).reason, 'missing-startTime');
  assert.equal(calendarEventForActivity({ ...completeActivity, dayOfWeek: '' }, { now }).reason, 'missing-dayOfWeek');
  assert.equal(calendarEventForActivity({ ...completeActivity, startTime: 'soon' }, { now }).reason, 'missing-startTime');
});

test('createIcsCalendar includes only complete active activities', () => {
  const result = createIcsCalendar([
    completeActivity,
    { ...completeActivity, slug: 'missing-time', startTime: '' },
    { ...completeActivity, slug: 'closed', status: 'reported-closed' },
  ], { now, calendarName: 'Test shortlist' });

  assert.equal(result.included.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.ics, /BEGIN:VCALENDAR/);
  assert.match(result.ics, /X-WR-CALNAME:Test shortlist/);
  assert.match(result.ics, /SUMMARY:Müller\\, Kids\\; Fun \\\\ Club/);
  assert.doesNotMatch(result.ics, /missing-time/);
  assert.doesNotMatch(result.ics, /closed/);
});

test('escapeIcsText escapes special characters without dropping umlauts', () => {
  assert.equal(escapeIcsText('Dülmen, kids; line\\break'), 'Dülmen\\, kids\\; line\\\\break');
});
