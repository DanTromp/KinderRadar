// Browser glue: render listings from data, wire filters, chips, search, and
// URL state. Pure logic lives in filtering.mjs and render.mjs.

import { activities, sections } from './activities-data.mjs';
import {
  matchesFilters,
  matchesChips,
  matchesSearch,
  sortByFreshness,
  CHIP_DEFINITIONS,
} from './filtering.mjs';
import { renderSectionHtml } from './render.mjs';
import { analytics } from './analytics.js';

function repoSlugFromDocument() {
  return document.documentElement.dataset.repoSlug ?? '';
}

function citySlugFromDocument() {
  return document.documentElement.dataset.citySlug ?? '';
}

function townsForCity(citySlug) {
  // The page declares its nearby towns via a data attribute so this script
  // does not need to import the cities table.
  const raw = document.documentElement.dataset.cityTowns ?? '';
  return raw.split('|').map((t) => t.trim()).filter(Boolean);
}

function readSelectedFilters(form) {
  const formData = new FormData(form);
  return {
    age: String(formData.get('age') ?? ''),
    town: String(formData.get('town') ?? ''),
    category: String(formData.get('category') ?? ''),
    day: String(formData.get('day') ?? ''),
    beginnerFriendly: String(formData.get('beginnerFriendly') ?? ''),
    sort: String(formData.get('sort') ?? 'freshness'),
  };
}

function readActiveChips(container) {
  return Array.from(container.querySelectorAll('.chip[aria-pressed="true"]'))
    .map((el) => el.dataset.chipId)
    .filter(Boolean);
}

function syncUrlState({ selected, chips, query }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(selected)) {
    if (v && !(k === 'sort' && v === 'freshness')) params.set(k, v);
  }
  if (chips.length) params.set('chips', chips.join(','));
  if (query) params.set('q', query);
  const search = params.toString();
  const newUrl = `${window.location.pathname}${search ? '?' + search : ''}`;
  window.history.replaceState(null, '', newUrl);
}

function applyUrlStateToControls(form, chipContainer, searchInput) {
  const params = new URLSearchParams(window.location.search);
  for (const name of ['age', 'town', 'category', 'day', 'beginnerFriendly', 'sort']) {
    const v = params.get(name);
    if (v && form.elements[name]) form.elements[name].value = v;
  }
  const chipParam = params.get('chips');
  if (chipParam) {
    const activeIds = new Set(chipParam.split(',').filter(Boolean));
    chipContainer.querySelectorAll('.chip').forEach((el) => {
      el.setAttribute('aria-pressed', activeIds.has(el.dataset.chipId) ? 'true' : 'false');
    });
  }
  const q = params.get('q');
  if (q && searchInput) searchInput.value = q;
}

function buildChipBar(container) {
  container.innerHTML = CHIP_DEFINITIONS
    .map((c) => `<button type="button" class="chip" data-chip-id="${c.id}" data-i18n="${c.labelKey}" aria-pressed="false">${c.label}</button>`)
    .join('');
  container.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    chip.dispatchEvent(new CustomEvent('chipchange', { bubbles: true, detail: { chipId: chip.dataset.chipId, active: !pressed } }));
  });
}

function setActiveChips(container, chipIds) {
  const active = new Set(chipIds);
  container.querySelectorAll('.chip').forEach((el) => {
    el.setAttribute('aria-pressed', active.has(el.dataset.chipId) ? 'true' : 'false');
  });
}

function init() {
  const root = document.getElementById('listings-root');
  const form = document.getElementById('activity-filters');
  const chipContainer = document.getElementById('filter-chips');
  const searchInput = document.getElementById('activity-search');
  const emptyState = document.getElementById('empty-state');
  const emptyRecovery = document.getElementById('empty-recovery');
  const emptyRecoveryActions = document.getElementById('empty-recovery-actions');
  const missingLink = document.getElementById('missing-listing-link');
  const filterLoader = document.getElementById('filter-loader');
  if (!root || !form || !chipContainer || !emptyState) return;

  const citySlug = citySlugFromDocument();
  const repoSlug = repoSlugFromDocument();
  const allowedTowns = new Set(townsForCity(citySlug));

  // Listings scoped to this city (or all activities if no city scope set).
  // Closed listings are filtered out so they don't appear in any sort/filter.
  const cityActivities = (allowedTowns.size === 0
    ? activities
    : activities.filter((a) => allowedTowns.has(a.town))
  ).filter((a) => a.status !== 'reported-closed');

  // Initial render: one panel per section, populated from data and pre-sorted
  // by freshness. The DOM cards include all data-* attributes the filter
  // pipeline reads from, matching the old hand-authored structure.
  const sectionHtml = sections
    .map((section) => {
      const inSection = sortByFreshness(cityActivities.filter((a) => a.section === section.id));
      if (inSection.length === 0) return '';
      return renderSectionHtml(section, inSection, {
        sections,
        repoSlug,
        activityHrefPrefix: '../../activities',
      });
    })
    .join('\n');
  root.innerHTML = sectionHtml;

  buildChipBar(chipContainer);
  applyUrlStateToControls(form, chipContainer, searchInput);

  // Tell the i18n runtime to translate the freshly rebuilt chip bar and
  // listings root, so they pick up any non-English language already in use.
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root } }));
  document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: chipContainer } }));

  const allListingNodes = Array.from(root.querySelectorAll('.listing'));
  const listingsBySection = new Map();
  for (const node of allListingNodes) {
    const sectionEl = node.closest('[data-section-id]');
    const id = sectionEl?.dataset.sectionId ?? '';
    if (!listingsBySection.has(id)) listingsBySection.set(id, []);
    listingsBySection.get(id).push({ node, sectionEl });
  }

  const nodeToListing = new Map();
  for (const node of allListingNodes) {
    const slug = node.dataset.slug;
    const listing = cityActivities.find((a) => a.slug === slug);
    if (listing) nodeToListing.set(node, listing);
  }

  // Re-order DOM nodes within each section when the sort changes. Pure
  // re-ordering avoids re-rendering and preserves attached event state.
  const sortListings = (mode) => {
    for (const [, nodes] of listingsBySection) {
      const sectionEl = nodes[0]?.sectionEl;
      if (!sectionEl) continue;
      const grid = sectionEl.querySelector('.listing-grid');
      if (!grid) continue;
      const sorted = [...nodes].sort(({ node: a }, { node: b }) => {
        const la = nodeToListing.get(a);
        const lb = nodeToListing.get(b);
        if (mode === 'name') {
          return String(la?.name ?? '').localeCompare(String(lb?.name ?? ''));
        }
        // default: freshness
        const ta = Date.parse(la?.lastVerified ?? '') || 0;
        const tb = Date.parse(lb?.lastVerified ?? '') || 0;
        if (ta !== tb) return tb - ta;
        return String(la?.name ?? '').localeCompare(String(lb?.name ?? ''));
      });
      for (const { node } of sorted) grid.appendChild(node);
    }
  };

  // --- Analytics wiring -----------------------------------------------------
  const lastValues = { age: '', town: '', category: '', day: '', beginnerFriendly: '', sort: '' };
  let zeroFiredFor = null;
  let lastTrackedQuery = '';
  let searchTimer = null;
  let loaderTimer = null;

  const pulseFilterLoader = (source) => {
    if (!filterLoader || source === 'init') return;
    clearTimeout(loaderTimer);
    filterLoader.hidden = false;
    filterLoader.classList.add('is-active');
    root.classList.add('is-filtering');
    loaderTimer = setTimeout(() => {
      filterLoader.classList.remove('is-active');
      filterLoader.hidden = true;
      root.classList.remove('is-filtering');
    }, 380);
  };

  const updateMissingLink = (query) => {
    if (!missingLink) return;
    try {
      const url = new URL(missingLink.href);
      if (query) url.searchParams.set('missing-query', query);
      else url.searchParams.delete('missing-query');
      missingLink.href = url.toString();
    } catch { /* malformed href, ignore */ }
  };

  const recoveryActions = ({ selected, chips, query }) => {
    const actions = [];
    if (query.trim()) {
      actions.push({
        id: 'clear-search',
        label: 'Clear search',
        labelKey: 'city.empty.clearSearch',
        apply() {
          if (searchInput) searchInput.value = '';
        },
      });
    }
    if (selected.town) {
      actions.push({
        id: 'clear-town',
        label: 'Search all towns',
        labelKey: 'city.empty.clearTown',
        apply() {
          form.elements.town.value = '';
        },
      });
    }
    if (selected.age) {
      actions.push({
        id: 'clear-age',
        label: 'Try all ages',
        labelKey: 'city.empty.clearAge',
        apply() {
          form.elements.age.value = '';
        },
      });
    }
    if (selected.category) {
      actions.push({
        id: 'clear-category',
        label: 'Remove category',
        labelKey: 'city.empty.clearCategory',
        apply() {
          form.elements.category.value = '';
        },
      });
    }
    if (selected.day) {
      actions.push({
        id: 'clear-day',
        label: 'Try any day',
        labelKey: 'city.empty.clearDay',
        apply() {
          form.elements.day.value = '';
        },
      });
    }
    if (selected.beginnerFriendly) {
      actions.push({
        id: 'clear-beginner',
        label: 'Show all levels',
        labelKey: 'city.empty.clearBeginner',
        apply() {
          form.elements.beginnerFriendly.value = '';
        },
      });
    }
    if (chips.length) {
      actions.push({
        id: 'clear-chips',
        label: 'Remove quick filters',
        labelKey: 'city.empty.clearChips',
        apply() {
          setActiveChips(chipContainer, []);
        },
      });
    }
    if (actions.length > 1) {
      actions.push({
        id: 'reset-all',
        label: 'Reset all filters',
        labelKey: 'city.empty.resetAll',
        apply() {
          form.reset();
          setActiveChips(chipContainer, []);
          if (searchInput) searchInput.value = '';
        },
      });
    }
    return actions.slice(0, 4);
  };

  const renderRecovery = (visibleCount, state) => {
    if (!emptyRecovery || !emptyRecoveryActions) return;
    if (visibleCount > 0) {
      emptyRecovery.hidden = true;
      emptyRecoveryActions.innerHTML = '';
      return;
    }
    const actions = recoveryActions(state);
    emptyRecoveryActions.innerHTML = actions
      .map((action) => `<button type="button" class="recovery-button" data-recovery-action="${action.id}" data-i18n="${action.labelKey}">${action.label}</button>`)
      .join('');
    emptyRecovery.hidden = actions.length === 0;
    if (actions.length) {
      document.dispatchEvent(new CustomEvent('kr:dom-updated', { detail: { root: emptyRecovery } }));
    }
  };

  const render = ({ source } = {}) => {
    pulseFilterLoader(source);
    const selected = readSelectedFilters(form);
    const chips = readActiveChips(chipContainer);
    const query = searchInput ? searchInput.value : '';
    let visibleCount = 0;

    for (const node of allListingNodes) {
      const listing = nodeToListing.get(node);
      if (!listing) continue;
      const visible =
        matchesFilters(listing, selected) &&
        matchesChips(listing, chips) &&
        matchesSearch(listing, query);
      node.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    for (const [, nodes] of listingsBySection) {
      const sectionEl = nodes[0]?.sectionEl;
      if (!sectionEl) continue;
      sectionEl.hidden = !nodes.some(({ node }) => !node.hidden);
    }

    emptyState.hidden = visibleCount > 0;
    updateMissingLink(query);
    syncUrlState({ selected, chips, query });
    renderRecovery(visibleCount, { selected, chips, query });

    // Sort whenever it changes.
    if (selected.sort !== lastValues.sort) {
      sortListings(selected.sort);
    }

    // Emit filter_change events for any filter whose value changed.
    for (const key of ['age', 'town', 'category', 'day', 'beginnerFriendly', 'sort']) {
      if (selected[key] !== lastValues[key]) {
        if (source !== 'init') analytics.filterChange(key, selected[key], visibleCount);
        lastValues[key] = selected[key];
      }
    }

    // Zero-results: fire once per unique (state, query) until something
    // about the inputs changes.
    const stateKey = JSON.stringify({ ...selected, chips, q: query });
    if (visibleCount === 0 && source !== 'init' && stateKey !== zeroFiredFor) {
      analytics.zeroResults({ q: query, ...selected, chips });
      zeroFiredFor = stateKey;
    } else if (visibleCount > 0) {
      zeroFiredFor = null;
    }

    return visibleCount;
  };

  form.addEventListener('change', () => render({ source: 'form' }));
  emptyRecoveryActions?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-recovery-action]');
    if (!button) return;
    const selected = readSelectedFilters(form);
    const chips = readActiveChips(chipContainer);
    const query = searchInput ? searchInput.value : '';
    const action = recoveryActions({ selected, chips, query })
      .find((candidate) => candidate.id === button.dataset.recoveryAction);
    if (!action) return;
    action.apply();
    const visibleCount = render({ source: 'recovery' });
    analytics.emptyStateRecovery(action.id, visibleCount);
  });
  chipContainer.addEventListener('chipchange', (event) => {
    const visibleCount = render({ source: 'chip' });
    const detail = event?.detail;
    if (detail) analytics.filterChange(`chip:${detail.chipId}`, detail.active ? 'on' : 'off', visibleCount);
  });
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const visibleCount = render({ source: 'search' });
      // Debounced search analytics so we don't log every keystroke.
      clearTimeout(searchTimer);
      const q = searchInput.value;
      searchTimer = setTimeout(() => {
        if (q.trim() && q !== lastTrackedQuery) {
          analytics.search(q, visibleCount);
          lastTrackedQuery = q;
        }
      }, 600);
    });
  }
  document.querySelectorAll('[data-intent-id]').forEach((button) => {
    button.addEventListener('click', () => {
      let filters = {};
      try {
        filters = JSON.parse(button.dataset.intentFilters || '{}');
      } catch {
        filters = {};
      }
      const chips = String(button.dataset.intentChips ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      form.reset();
      if (searchInput) searchInput.value = '';
      for (const [name, value] of Object.entries(filters)) {
        if (form.elements[name]) form.elements[name].value = value;
      }
      setActiveChips(chipContainer, chips);
      const visibleCount = render({ source: 'intent' });
      analytics.intentSelect(button.dataset.intentId, visibleCount);
    });
  });
  render({ source: 'init' });
}

init();
