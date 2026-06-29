import { parseDayList } from './filtering.mjs';
import { normalizedLocation, slugify } from './render.mjs';

export const CALENDAR_TIMEZONE = 'Europe/Berlin';

const DAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function text(value) {
  return String(value ?? '').trim();
}

function parseClock(value) {
  const match = text(value).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDateTime(date, clock) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(clock.hours),
    pad(clock.minutes),
    '00',
  ].join('');
}

function formatUtcStamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('');
}

function nextDateForDay(day, now) {
  const target = DAY_TO_INDEX[day];
  if (target === undefined) return null;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const current = base.getUTCDay();
  const offset = (target - current + 7) % 7;
  base.setUTCDate(base.getUTCDate() + offset);
  return base;
}

function addMinutes(clock, minutesToAdd) {
  const total = clock.hours * 60 + clock.minutes + minutesToAdd;
  return {
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

function endClock(start, endTime) {
  const end = parseClock(endTime);
  if (!end) return null;
  const startTotal = start.hours * 60 + start.minutes;
  const endTotal = end.hours * 60 + end.minutes;
  return endTotal > startTotal ? end : null;
}

export function escapeIcsText(value) {
  return text(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  if (line.length <= 74) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

function icsLine(name, value) {
  return foldLine(`${name}:${value}`);
}

export function calendarEventForActivity(activity, {
  now = new Date(),
  uidDomain = 'meinkinderradar.de',
} = {}) {
  const name = text(activity?.name);
  const start = parseClock(activity?.startTime);
  const days = parseDayList(activity?.dayOfWeek);
  const day = days[0];
  const date = nextDateForDay(day, now);

  if (!name || !start || !date) {
    return {
      ok: false,
      activity,
      reason: !name ? 'missing-name' : !start ? 'missing-startTime' : 'missing-dayOfWeek',
    };
  }

  const slug = text(activity?.slug) || slugify(name);
  const location = normalizedLocation(activity);
  const end = endClock(start, activity?.endTime);
  const description = [
    activity?.timing ? `When: ${activity.timing}` : '',
    activity?.cost ? `Cost: ${activity.cost}` : '',
    activity?.contactUrl ? `Contact: ${activity.contactUrl}` : '',
    activity?.sourceUrl ? `Source: ${activity.sourceUrl}` : '',
    'Please confirm the current time with the organizer before going.',
  ].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VEVENT',
    icsLine('UID', escapeIcsText(`${slug}-${formatLocalDateTime(date, start)}@${uidDomain}`)),
    icsLine('DTSTAMP', formatUtcStamp(now)),
    icsLine(`DTSTART;TZID=${CALENDAR_TIMEZONE}`, formatLocalDateTime(date, start)),
  ];

  if (end) {
    lines.push(icsLine(`DTEND;TZID=${CALENDAR_TIMEZONE}`, formatLocalDateTime(date, end)));
  } else {
    lines.push(icsLine('DURATION', 'PT1H'));
  }

  lines.push(
    icsLine('SUMMARY', escapeIcsText(name)),
    icsLine('DESCRIPTION', escapeIcsText(description)),
  );

  if (location?.address) {
    lines.push(icsLine('LOCATION', escapeIcsText(location.address)));
  }

  if (activity?.contactUrl || activity?.sourceUrl) {
    lines.push(icsLine('URL', escapeIcsText(activity.contactUrl || activity.sourceUrl)));
  }

  lines.push('END:VEVENT');

  return {
    ok: true,
    activity,
    event: lines,
  };
}

export function createIcsCalendar(items, {
  now = new Date(),
  calendarName = 'MeinKinderRadar shortlist',
} = {}) {
  const results = (Array.isArray(items) ? items : [])
    .filter((activity) => activity?.status !== 'reported-closed')
    .map((activity) => calendarEventForActivity(activity, { now }));
  const included = results.filter((result) => result.ok);
  const skipped = results.filter((result) => !result.ok);
  const stamp = formatUtcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MeinKinderRadar//Activity Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    icsLine('X-WR-CALNAME', escapeIcsText(calendarName)),
    icsLine('X-WR-TIMEZONE', CALENDAR_TIMEZONE),
    ...included.flatMap((result) => result.event),
    icsLine('X-MEINKINDERRADAR-EXPORTED', stamp),
    'END:VCALENDAR',
  ];

  return {
    ics: `${lines.join('\r\n')}\r\n`,
    included: included.map((result) => result.activity),
    skipped: skipped.map((result) => ({
      activity: result.activity,
      reason: result.reason,
    })),
  };
}
