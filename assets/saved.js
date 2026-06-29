import { activities, sections } from './activities-data.mjs';
import { createIcsCalendar } from './calendar.mjs';
import { renderSectionHtml } from './render.mjs';
import {
  normalizeSavedSlugs,
  renderMissingSavedHtml,
  renderShortlistPlannerHtml,
  savedActivitiesFromSlugs,
} from './shortlist.mjs';
import { track } from './analytics.js';

const STORAGE_KEY = 'kr-saved-activities';

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeSaved(saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
  } catch {
    /* localStorage may be blocked; keep the UI responsive anyway. */
  }
}

function setTranslatedStatus(target, key, fallback, params = null, tone = '') {
  if (!target) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(fallback);
    }
    return;
  }
  target.dataset.i18n = key;
  if (params) target.dataset.i18nParams = JSON.stringify(params);
  else delete target.dataset.i18nParams;
  if (tone) target.dataset.tone = tone;
  else delete target.dataset.tone;
  target.textContent = fallback;
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: target, source: 'saved' } }));
}

function repoSlugFromDocument() {
  return document.documentElement.dataset.repoSlug ?? '';
}

function labelFor(button, saved) {
  const label = button.querySelector('[data-save-label]') ?? button;
  label.dataset.i18n = saved ? 'shortlist.saved' : 'shortlist.save';
  label.textContent = saved ? 'Saved' : 'Save';
}

function updateButtons(saved = readSaved()) {
  document.querySelectorAll('[data-save-activity]').forEach((button) => {
    const slug = button.dataset.saveActivity;
    const isSaved = saved.has(slug);
    button.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
    labelFor(button, isSaved);
  });
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: document, source: 'saved' } }));
}

function updateCounts(saved = readSaved()) {
  const count = saved.size;
  document.querySelectorAll('[data-save-count]').forEach((el) => {
    el.textContent = String(count);
  });
}

function savedActivities(saved = readSaved()) {
  return savedActivitiesFromSlugs([...saved], activities);
}

function importSavedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('saved');
  if (!raw) return readSaved();

  const { valid: imported } = normalizeSavedSlugs(raw, activities);
  const saved = readSaved();
  for (const slug of imported) saved.add(slug);
  writeSaved(saved);
  params.delete('saved');
  const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', cleanUrl);
  if (imported.length) track('shortlist_import', { count: imported.length });
  return saved;
}

function setStatus(key, fallback) {
  const status = document.querySelector('[data-shortlist-status]');
  setTranslatedStatus(status, key, fallback);
}

function renderShortlist(saved = readSaved()) {
  const root = document.getElementById('shortlist-listings');
  if (!root) return;

  const empty = document.querySelector('[data-shortlist-empty]');
  const plannerRoot = document.getElementById('shortlist-planner-root');
  const missingRoot = document.getElementById('shortlist-missing-root');
  const townCount = document.querySelector('[data-shortlist-town-count]');
  const calendarCount = document.querySelector('[data-shortlist-calendar-count]');
  const items = savedActivities(saved);
  const { missing } = normalizeSavedSlugs([...saved], activities);
  const towns = new Set(items.map((activity) => activity.town));
  const calendarReady = createIcsCalendar(items).included.length;
  if (townCount) townCount.textContent = String(towns.size);
  if (calendarCount) calendarCount.textContent = String(calendarReady);

  if (empty) empty.hidden = items.length > 0;
  if (plannerRoot) plannerRoot.innerHTML = renderShortlistPlannerHtml(items);
  if (missingRoot) missingRoot.innerHTML = renderMissingSavedHtml(missing);
  root.innerHTML = sections
    .map((section) => {
      const inSection = items.filter((activity) => activity.section === section.id);
      if (inSection.length === 0) return '';
      return renderSectionHtml(section, inSection, {
        sections,
        repoSlug: repoSlugFromDocument(),
        activityHrefPrefix: '../activities',
      });
    })
    .filter(Boolean)
    .join('\n');

  updateButtons(saved);
  if (plannerRoot) document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: plannerRoot, source: 'saved' } }));
  if (missingRoot) document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: missingRoot, source: 'saved' } }));
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root, source: 'saved' } }));
}

function publishState(saved = readSaved()) {
  updateCounts(saved);
  updateButtons(saved);
  renderShortlist(saved);
}

function toggleSaved(slug) {
  if (!slug) return;
  const saved = readSaved();
  const nextSaved = !saved.has(slug);
  if (nextSaved) saved.add(slug);
  else saved.delete(slug);
  writeSaved(saved);
  track(nextSaved ? 'shortlist_save' : 'shortlist_remove', { slug, count: saved.size });
  publishState(saved);
}

function clearShortlist() {
  const saved = readSaved();
  if (saved.size === 0) return;
  saved.clear();
  writeSaved(saved);
  track('shortlist_clear', {});
  publishState(saved);
}

function shareUrl(saved = readSaved()) {
  const url = new URL(`${window.location.origin}${window.location.pathname}`);
  const { valid } = normalizeSavedSlugs([...saved], activities);
  url.searchParams.set('saved', valid.join(','));
  return url.toString();
}

async function copyShortlistLink() {
  const saved = readSaved();
  if (saved.size === 0) {
    setStatus('shortlist.share.empty', 'Save at least one activity before sharing.');
    return;
  }

  const url = shareUrl(saved);
  try {
    await navigator.clipboard.writeText(url);
    setStatus('shortlist.share.copied', 'Share link copied.');
  } catch {
    setStatus('shortlist.share.manual', 'Copy the link from your address bar.');
    window.history.replaceState(null, '', new URL(url).pathname + new URL(url).search);
  }
  track('shortlist_share', { count: saved.size });
}

function safeFileName(name) {
  return String(name ?? 'meinkinderradar-calendar')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'meinkinderradar-calendar';
}

function downloadIcs(name, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(name)}.ics`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function calendarStatusTarget(sourceElement) {
  return document.querySelector('[data-shortlist-status]')
    ?? sourceElement?.closest('[data-calendar-scope]')?.querySelector('[data-calendar-status]')
    ?? document.querySelector('[data-calendar-status]');
}

function exportCalendar(items, {
  name = 'MeinKinderRadar shortlist',
  statusTarget = null,
  emptyKey = 'shortlist.calendar.none',
  emptyText = 'No saved activities have enough schedule data for calendar export.',
} = {}) {
  const result = createIcsCalendar(items, { calendarName: name });
  if (result.included.length === 0) {
    setTranslatedStatus(statusTarget, emptyKey, emptyText, null, 'error');
    return result;
  }

  downloadIcs(name, result.ics);
  const params = { included: result.included.length, skipped: result.skipped.length };
  const fallback = `Calendar file created with ${params.included} activity/activity(s); ${params.skipped} skipped.`;
  setTranslatedStatus(statusTarget, 'shortlist.calendar.exported', fallback, params, 'success');
  track('calendar_export', params);
  return result;
}

function exportShortlistCalendar(sourceElement) {
  const items = savedActivities();
  if (items.length === 0) {
    setTranslatedStatus(
      calendarStatusTarget(sourceElement),
      'shortlist.calendar.empty',
      'Save at least one activity before exporting a calendar.',
      null,
      'error',
    );
    return;
  }

  exportCalendar(items, {
    name: 'MeinKinderRadar shortlist',
    statusTarget: calendarStatusTarget(sourceElement),
  });
}

function exportSingleActivityCalendar(slug, sourceElement) {
  const activity = activities.find((candidate) => candidate.slug === slug);
  exportCalendar(activity ? [activity] : [], {
    name: activity?.name ?? 'MeinKinderRadar activity',
    statusTarget: calendarStatusTarget(sourceElement),
    emptyKey: 'activity.calendar.none',
    emptyText: 'This activity needs a day and start time before calendar export.',
  });
}

function init() {
  publishState(importSavedFromUrl());

  document.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-save-activity]');
    if (saveButton) {
      toggleSaved(saveButton.dataset.saveActivity);
      return;
    }

    const calendarButton = event.target.closest('[data-export-calendar]');
    if (calendarButton) {
      exportSingleActivityCalendar(calendarButton.dataset.exportCalendar, calendarButton);
      return;
    }

    const clearButton = event.target.closest('[data-clear-shortlist]');
    if (clearButton) {
      clearShortlist();
      return;
    }

    const shareButton = event.target.closest('[data-share-shortlist]');
    if (shareButton) {
      copyShortlistLink();
      return;
    }

    const calendarShortlistButton = event.target.closest('[data-export-shortlist-calendar]');
    if (calendarShortlistButton) {
      exportShortlistCalendar(calendarShortlistButton);
      return;
    }

    const printButton = event.target.closest('[data-print-shortlist]');
    if (printButton) {
      track('shortlist_print', { count: readSaved().size });
      window.print();
    }
  });

  document.addEventListener('kr:dom-updated', (event) => {
    if (event.detail?.source === 'saved') return;
    const saved = readSaved();
    updateCounts(saved);
    updateButtons(saved);
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) publishState();
  });
}

init();
