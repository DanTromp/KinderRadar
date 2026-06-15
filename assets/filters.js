import { matchesFilters } from '/assets/filtering.mjs';

function readListingData(listingElement) {
  const ageMin = Number.parseInt(listingElement.dataset.ageMin ?? '', 10);
  const ageMax = Number.parseInt(listingElement.dataset.ageMax ?? '', 10);

  return {
    node: listingElement,
    ageMin: Number.isNaN(ageMin) ? 0 : ageMin,
    ageMax: Number.isNaN(ageMax) ? 99 : ageMax,
    type: listingElement.dataset.type ?? '',
    weekdays: (listingElement.dataset.weekdays ?? '').split(',').map((day) => day.trim()).filter(Boolean),
    setting: listingElement.dataset.setting ?? '',
    cost: listingElement.dataset.cost ?? '',
    beginnerFriendly: listingElement.dataset.beginnerFriendly ?? '',
  };
}

function readSelectedFilters(form) {
  const formData = new FormData(form);
  return {
    age: String(formData.get('age') ?? ''),
    type: String(formData.get('type') ?? ''),
    weekday: String(formData.get('weekday') ?? ''),
    setting: String(formData.get('setting') ?? ''),
    cost: String(formData.get('cost') ?? ''),
    beginnerFriendly: String(formData.get('beginnerFriendly') ?? ''),
  };
}

function initFilters() {
  const form = document.getElementById('activity-filters');
  const listings = Array.from(document.querySelectorAll('.listing')).map(readListingData);
  const emptyState = document.getElementById('empty-state');

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

    emptyState.hidden = visibleCount > 0;
  };

  form.addEventListener('change', render);
  render();
}

initFilters();
