import { activities, sections } from './activities-data.mjs';
import { sortByFreshness } from './filtering.mjs';
import { renderSectionHtml } from './render.mjs';
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
  return sortByFreshness(activities.filter((activity) => saved.has(activity.slug)));
}

function validSlugs(slugs) {
  const known = new Set(activities.map((activity) => activity.slug));
  return slugs.filter((slug) => known.has(slug));
}

function importSavedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('saved');
  if (!raw) return readSaved();

  const imported = validSlugs(raw.split(',').map((slug) => slug.trim()).filter(Boolean));
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
  if (!status) return;
  status.dataset.i18n = key;
  status.textContent = fallback;
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: document, source: 'saved' } }));
}

function renderShortlist(saved = readSaved()) {
  const root = document.getElementById('shortlist-listings');
  if (!root) return;

  const empty = document.querySelector('[data-shortlist-empty]');
  const townCount = document.querySelector('[data-shortlist-town-count]');
  const items = savedActivities(saved);
  const towns = new Set(items.map((activity) => activity.town));
  if (townCount) townCount.textContent = String(towns.size);

  if (empty) empty.hidden = items.length > 0;
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
  url.searchParams.set('saved', [...saved].join(','));
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

function init() {
  publishState(importSavedFromUrl());

  document.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-save-activity]');
    if (saveButton) {
      toggleSaved(saveButton.dataset.saveActivity);
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
