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

  if (selected.type && listing.type !== selected.type) {
    return false;
  }

  if (selected.weekday && !listing.weekdays.includes(selected.weekday)) {
    return false;
  }

  if (selected.setting && listing.setting !== selected.setting) {
    return false;
  }

  if (selected.cost && listing.cost !== selected.cost) {
    return false;
  }

  if (selected.beginnerFriendly && listing.beginnerFriendly !== selected.beginnerFriendly) {
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
