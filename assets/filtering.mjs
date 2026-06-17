// Pure filter / search / sort logic. No DOM, no globals — easy to unit test.

export function parseAgeBand(ageBand) {
  if (!ageBand || !ageBand.includes('-')) {
    return null;
  }

  const [minText, maxText] = ageBand.split('-');
  const min = Number.parseInt(minText, 10);
  const max = Number.parseInt(maxText, 10);

  if (Number.isNaN(min) || Number.isNaN(max)) {
    return null;
  }

  return { min, max };
}

export function matchesFilters(listing, selected) {
  const ageBand = parseAgeBand(selected.age);
  if (ageBand && (listing.ageMax < ageBand.min || listing.ageMin > ageBand.max)) {
    return false;
  }

  if (selected.town && listing.town !== selected.town) {
    return false;
  }

  if (selected.category && listing.category !== selected.category) {
    return false;
  }

  if (selected.day && !matchesDayFilter(listing, selected.day)) {
    return false;
  }

  if (selected.beginnerFriendly && listing.beginnerFriendly !== (selected.beginnerFriendly === 'true')) {
    return false;
  }

  return true;
}

export function optionalText(value) {
  if (typeof value !== 'string') {
    return 'Not specified';
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : 'Not specified';
}

// ---------------------------------------------------------------------------
// Phase 3: parent-shaped filter chips.
// Each chip is a pure predicate over a (normalised) listing. Chips are
// composed with AND so multiple chips narrow results.
// ---------------------------------------------------------------------------

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_ALIASES = new Map([
  ['monday', 'monday'],
  ['mon', 'monday'],
  ['tuesday', 'tuesday'],
  ['tue', 'tuesday'],
  ['tues', 'tuesday'],
  ['wednesday', 'wednesday'],
  ['wed', 'wednesday'],
  ['thursday', 'thursday'],
  ['thu', 'thursday'],
  ['thur', 'thursday'],
  ['thurs', 'thursday'],
  ['friday', 'friday'],
  ['fri', 'friday'],
  ['saturday', 'saturday'],
  ['sat', 'saturday'],
  ['sunday', 'sunday'],
  ['sun', 'sunday'],
]);
const WEEKEND_DAYS = new Set(['saturday', 'sunday']);
const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

function expandDayRange(start, end) {
  const startIndex = DAY_ORDER.indexOf(start);
  const endIndex = DAY_ORDER.indexOf(end);
  if (startIndex === -1 || endIndex === -1) return [start, end];

  if (startIndex <= endIndex) {
    return DAY_ORDER.slice(startIndex, endIndex + 1);
  }

  return [...DAY_ORDER.slice(startIndex), ...DAY_ORDER.slice(0, endIndex + 1)];
}

export function parseDayList(dayOfWeek) {
  if (!dayOfWeek) return [];
  const text = String(dayOfWeek).toLowerCase();
  const days = new Set();
  const rangePattern = /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b\s*(?:-|to|through|until)\s*\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/g;
  let rangeMatch;

  while ((rangeMatch = rangePattern.exec(text)) !== null) {
    const start = DAY_ALIASES.get(rangeMatch[1]);
    const end = DAY_ALIASES.get(rangeMatch[2]);
    for (const day of expandDayRange(start, end)) {
      days.add(day);
    }
  }

  for (const match of text.matchAll(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/g)) {
    days.add(DAY_ALIASES.get(match[1]));
  }

  return DAY_ORDER.filter((day) => days.has(day));
}

export function matchesDayFilter(listing, selectedDay) {
  if (!selectedDay) return true;
  const days = parseDayList(listing.dayOfWeek);
  if (!days.length) return false;

  if (selectedDay === 'weekend') {
    return days.some((day) => WEEKEND_DAYS.has(day));
  }

  if (selectedDay === 'weekday') {
    return days.some((day) => WEEKDAYS.has(day));
  }

  return days.includes(selectedDay);
}

function startMinutes(listing) {
  const t = listing.startTime;
  if (typeof t !== 'string' || !t.includes(':')) return null;
  const [h, m] = t.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export const CHIP_DEFINITIONS = [
  {
    id: 'this-weekend',
    label: 'This weekend',
    labelKey: 'chip.this-weekend',
    predicate: (l) => matchesDayFilter(l, 'weekend'),
  },
  {
    id: 'after-kindergarten',
    label: 'After kindergarten',
    labelKey: 'chip.after-kindergarten',
    predicate: (l) => {
      const days = parseDayList(l.dayOfWeek);
      if (!days.length || !days.some((d) => WEEKDAYS.has(d))) return false;
      const m = startMinutes(l);
      return m !== null && m >= 14 * 60;
    },
  },
  {
    id: 'free',
    label: 'Free',
    labelKey: 'chip.free',
    predicate: (l) => l.price?.free === true,
  },
  {
    id: 'beginner-friendly',
    label: 'Beginner-friendly',
    labelKey: 'chip.beginner-friendly',
    predicate: (l) => l.beginnerFriendly === true,
  },
  {
    id: 'rainy-day',
    label: 'For rainy days',
    labelKey: 'chip.rainy-day',
    predicate: (l) => l.setting === 'indoor' || l.setting === 'mixed',
  },
  {
    id: 'no-membership',
    label: 'No membership required',
    labelKey: 'chip.no-membership',
    predicate: (l) => (l.price?.unit ?? '') !== 'membership',
  },
  {
    id: 'trial-available',
    label: 'Trial available',
    labelKey: 'chip.trial-available',
    predicate: (l) => Boolean(l.trial?.available ?? l.trialAvailability),
  },
];

export function chipById(id) {
  return CHIP_DEFINITIONS.find((c) => c.id === id) ?? null;
}

export function matchesChips(listing, activeChipIds) {
  if (!activeChipIds || activeChipIds.length === 0) return true;
  for (const id of activeChipIds) {
    const chip = chipById(id);
    if (chip && !chip.predicate(listing)) return false;
  }
  return true;
}

// Case-insensitive substring search across the most useful free-text fields.
export function matchesSearch(listing, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    listing.name,
    listing.category,
    listing.town,
    listing.description,
    listing.timing,
    listing.cost,
    listing.trialAvailability,
    listing.trial?.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

// Default ordering: closed activities sink, then fresher entries surface first,
// with name as a stable tiebreaker.
export function compareByFreshness(a, b, now = new Date()) {
  const aClosed = a.status === 'reported-closed' ? 1 : 0;
  const bClosed = b.status === 'reported-closed' ? 1 : 0;
  if (aClosed !== bClosed) return aClosed - bClosed;

  const aT = Date.parse(a.lastVerified ?? '');
  const bT = Date.parse(b.lastVerified ?? '');
  const aValid = !Number.isNaN(aT);
  const bValid = !Number.isNaN(bT);
  if (aValid && bValid && aT !== bT) return bT - aT;
  if (aValid !== bValid) return aValid ? -1 : 1;
  return String(a.name ?? '').localeCompare(String(b.name ?? ''));
}

export function sortByFreshness(listings, now = new Date()) {
  return [...listings].sort((a, b) => compareByFreshness(a, b, now));
}
