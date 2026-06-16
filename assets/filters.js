// Browser glue: render listings from data, wire filters, chips, search, and
// URL state. Pure logic lives in filtering.mjs and render.mjs.

import { activities, sections } from '/assets/activities-data.mjs';
import {
  matchesFilters,
  matchesChips,
  matchesSearch,
  sortByFreshness,
  CHIP_DEFINITIONS,
} from '/assets/filtering.mjs';
import { renderSectionHtml } from '/assets/render.mjs';

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
    beginnerFriendly: String(formData.get('beginnerFriendly') ?? ''),
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
    if (v) params.set(k, v);
  }
  if (chips.length) params.set('chips', chips.join(','));
  if (query) params.set('q', query);
  const search = params.toString();
  const newUrl = `${window.location.pathname}${search ? '?' + search : ''}`;
  window.history.replaceState(null, '', newUrl);
}

function applyUrlStateToControls(form, chipContainer, searchInput) {
  const params = new URLSearchParams(window.location.search);
  for (const name of ['age', 'town', 'category', 'beginnerFriendly']) {
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
    .map((c) => `<button type="button" class="chip" data-chip-id="${c.id}" aria-pressed="false">${c.label}</button>`)
    .join('');
  container.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    chip.dispatchEvent(new CustomEvent('chipchange', { bubbles: true }));
  });
}

function init() {
  const root = document.getElementById('listings-root');
  const form = document.getElementById('activity-filters');
  const chipContainer = document.getElementById('filter-chips');
  const searchInput = document.getElementById('activity-search');
  const emptyState = document.getElementById('empty-state');
  if (!root || !form || !chipContainer || !emptyState) return;

  const citySlug = citySlugFromDocument();
  const repoSlug = repoSlugFromDocument();
  const allowedTowns = new Set(townsForCity(citySlug));

  // Listings scoped to this city (or all activities if no city scope set).
  const cityActivities = allowedTowns.size === 0
    ? activities
    : activities.filter((a) => allowedTowns.has(a.town));

  // Initial render: one panel per section, populated from data and pre-sorted
  // by freshness. The DOM cards include all data-* attributes the filter
  // pipeline reads from, matching the old hand-authored structure.
  const sectionHtml = sections
    .map((section) => {
      const inSection = sortByFreshness(cityActivities.filter((a) => a.section === section.id));
      if (inSection.length === 0) return '';
      return renderSectionHtml(section, inSection, { sections, repoSlug });
    })
    .join('\n');
  root.innerHTML = sectionHtml;

  buildChipBar(chipContainer);
  applyUrlStateToControls(form, chipContainer, searchInput);

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

  const render = () => {
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
    syncUrlState({ selected, chips, query });
  };

  form.addEventListener('change', render);
  chipContainer.addEventListener('chipchange', render);
  if (searchInput) {
    searchInput.addEventListener('input', render);
  }
  render();
}

init();
