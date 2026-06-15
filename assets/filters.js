import { matchesFilters } from '/assets/filtering.mjs';

function readListingData(listingElement) {
  const ageMin = Number.parseInt(listingElement.dataset.ageMin ?? '', 10);
  const ageMax = Number.parseInt(listingElement.dataset.ageMax ?? '', 10);

  return {
    node: listingElement,
    section: listingElement.closest('[data-section]'),
    ageMin: Number.isNaN(ageMin) ? 0 : ageMin,
    ageMax: Number.isNaN(ageMax) ? 99 : ageMax,
    town: listingElement.dataset.town ?? '',
    category: listingElement.dataset.category ?? '',
    beginnerFriendly: listingElement.dataset.beginnerFriendly ?? '',
  };
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

function initFilters() {
  const form = document.getElementById('activity-filters');
  const listings = Array.from(document.querySelectorAll('.listing')).map(readListingData);
  const emptyState = document.getElementById('empty-state');
  const sections = Array.from(document.querySelectorAll('[data-section]'));

  if (!form || listings.length === 0 || !emptyState) {
    return;
  }

  const render = () => {
    const selected = readSelectedFilters(form);
    let visibleCount = 0;

    listings.forEach((listing) => {
      const visible = matchesFilters(listing, selected);
      listing.node.hidden = !visible;
      if (visible) {
        visibleCount += 1;
      }
    });

    sections.forEach((section) => {
      const hasVisibleListing = listings.some((listing) => listing.section === section && !listing.node.hidden);
      section.hidden = !hasVisibleListing;
    });

    emptyState.hidden = visibleCount > 0;
  };

  form.addEventListener('change', render);
  render();
}

initFilters();
