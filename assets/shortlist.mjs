import { parseDayList, sortByFreshness } from './filtering.mjs';
import { escapeHtml } from './render.mjs';

const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function normalizeSlugList(slugs) {
  const raw = Array.isArray(slugs) ? slugs : String(slugs ?? '').split(',');
  return raw.map((slug) => String(slug ?? '').trim()).filter(Boolean);
}

export function normalizeSavedSlugs(slugs, activities) {
  const known = new Set((Array.isArray(activities) ? activities : []).map((activity) => activity.slug));
  const valid = [];
  const missing = [];

  for (const slug of normalizeSlugList(slugs)) {
    if (!known.has(slug)) {
      if (!missing.includes(slug)) missing.push(slug);
      continue;
    }
    if (!valid.includes(slug)) valid.push(slug);
  }

  return { valid, missing };
}

export function savedActivitiesFromSlugs(slugs, activities) {
  const { valid } = normalizeSavedSlugs(slugs, activities);
  const validSet = new Set(valid);
  return sortByFreshness((Array.isArray(activities) ? activities : [])
    .filter((activity) => validSet.has(activity.slug)));
}

export function removeSavedSlug(slugs, slugToRemove) {
  return normalizeSlugList(slugs).filter((slug) => slug !== slugToRemove);
}

export function groupSavedActivitiesByDay(items) {
  const groups = new Map(DAY_ORDER.map((day) => [day, []]));
  groups.set('unscheduled', []);

  for (const activity of Array.isArray(items) ? items : []) {
    const days = parseDayList(activity.dayOfWeek);
    if (days.length === 0) {
      groups.get('unscheduled').push(activity);
      continue;
    }
    for (const day of days) {
      groups.get(day)?.push(activity);
    }
  }

  return [...groups.entries()]
    .map(([id, activities]) => ({
      id,
      label: DAY_LABELS[id] ?? 'Schedule to confirm',
      activities: sortByFreshness(activities),
    }))
    .filter((group) => group.activities.length > 0);
}

export function renderShortlistPlannerHtml(items) {
  const groups = groupSavedActivitiesByDay(items);
  if (groups.length === 0) return '';

  const groupHtml = groups.map((group) => {
    const rows = group.activities.map((activity) => {
      const time = activity.startTime ? ` at ${activity.startTime}` : '';
      return `          <li><a class="text-link" href="../activities/${escapeHtml(activity.slug)}/">${escapeHtml(activity.name)}</a><span>${escapeHtml(activity.town ?? '')}${escapeHtml(time)}</span></li>`;
    }).join('\n');
    return `        <section class="shortlist-day-group">
          <h3>${escapeHtml(group.label)}</h3>
          <ul>
${rows}
          </ul>
        </section>`;
  }).join('\n');

  return `      <section class="panel shortlist-planner" aria-labelledby="shortlist-planner-heading">
        <div class="section-heading">
          <h2 id="shortlist-planner-heading" data-i18n="shortlist.planner.heading">Plan by day</h2>
          <p class="section-intro" data-i18n="shortlist.planner.intro">Saved activities grouped by the schedule details currently available.</p>
        </div>
        <div class="shortlist-day-grid">
${groupHtml}
        </div>
      </section>`;
}

export function renderMissingSavedHtml(missingSlugs) {
  const missing = normalizeSlugList(missingSlugs);
  if (missing.length === 0) return '';

  return `      <section class="panel shortlist-missing" data-shortlist-missing>
        <h2 data-i18n="shortlist.missing.heading">Some saved items are no longer available</h2>
        <p class="section-intro" data-i18n="shortlist.missing.text">They may have been removed or renamed in the latest activity data export.</p>
        <p class="muted">${escapeHtml(missing.join(', '))}</p>
      </section>`;
}
