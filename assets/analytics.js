// KinderRadar analytics shim.
//
// Goals (per launch plan §2):
//   - Cookieless, privacy-respecting; no cookie banner needed.
//   - Strip PII; never log free-text other than the search input (and that
//     trimmed/lowercased and capped at 60 chars).
//   - Respect navigator.doNotTrack — no-op when set.
//   - Single wrapper around the vendor (Plausible / Cloudflare Web
//     Analytics) so the vendor can be swapped without touching call sites.
//
// Event schema (also documented in README.md — keep in sync):
//   search              { q: string, results: number }
//   filter_change       { name: string, value: string, results: number }
//   zero_results        { q: string, town, age, category, beginnerFriendly,
//                         chips: string }
//   listing_click       { slug: string }
//   suggest_update_click, report_closed_click, confirm_still_running_click,
//   organizer_claim_click, submit_activity_click, missing_listing_click,
//   contact_click       (no props)
//
// To enable a vendor, set one of:
//   window.KINDERRADAR_PLAUSIBLE_DOMAIN = 'haltern.kinderradar.de';
//   window.KINDERRADAR_CF_BEACON = '<cloudflare token>';
// Without either, events are still validated locally (and visible in the
// devtools console when KINDERRADAR_DEBUG = true) but never leave the page.

const MAX_QUERY_LENGTH = 60;

function isDoNotTrack() {
  if (typeof navigator === 'undefined') return false;
  const dnt = navigator.doNotTrack ?? navigator.msDoNotTrack ?? (typeof window !== 'undefined' && window.doNotTrack);
  return dnt === '1' || dnt === 'yes' || dnt === true;
}

function sanitizeQuery(q) {
  return String(q ?? '').trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

function debugEnabled() {
  try {
    return Boolean(window.KINDERRADAR_DEBUG);
  } catch {
    return false;
  }
}

function vendorSend(name, props) {
  // Plausible: window.plausible(eventName, { props })
  if (typeof window !== 'undefined' && typeof window.plausible === 'function') {
    try { window.plausible(name, { props }); } catch { /* swallow */ }
  }
  // Cloudflare Web Analytics doesn't take custom events out of the box;
  // page views are auto-tracked when the beacon script is included in HTML.
  // Custom events under CF require Workers Analytics Engine or a separate
  // endpoint — left as a no-op for now so the wrapper stays cheap.
}

export function track(name, props = {}) {
  if (isDoNotTrack()) return;
  if (typeof name !== 'string' || !name) return;
  const safeProps = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') {
      safeProps[k] = v;
    } else {
      safeProps[k] = String(v).slice(0, MAX_QUERY_LENGTH);
    }
  }
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.debug('[kr-analytics]', name, safeProps);
  }
  vendorSend(name, safeProps);
}

function initPlausible() {
  if (isDoNotTrack() || typeof window === 'undefined' || typeof document === 'undefined') return;
  const domain = String(window.KINDERRADAR_PLAUSIBLE_DOMAIN ?? '').trim();
  if (!domain) return;

  if (typeof window.plausible !== 'function') {
    window.plausible = function plausibleQueue() {
      window.plausible.q = window.plausible.q || [];
      window.plausible.q.push(arguments);
    };
  }

  if (document.querySelector('script[data-kinderradar-plausible]')) return;
  const script = document.createElement('script');
  script.defer = true;
  script.dataset.kinderradarPlausible = 'true';
  script.dataset.domain = domain;
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
}

export const analytics = {
  search(q, results) {
    track('search', { q: sanitizeQuery(q), results: Number(results) || 0 });
  },
  filterChange(name, value, results) {
    track('filter_change', { name, value: String(value ?? ''), results: Number(results) || 0 });
  },
  zeroResults(state) {
    track('zero_results', {
      q: sanitizeQuery(state?.q),
      town: state?.town ?? '',
      age: state?.age ?? '',
      category: state?.category ?? '',
      beginnerFriendly: state?.beginnerFriendly ?? '',
      chips: Array.isArray(state?.chips) ? state.chips.join('|') : '',
    });
  },
  listingClick(slug) {
    track('listing_click', { slug: String(slug ?? '') });
  },
};

// Auto-wire any link tagged with data-analytics="event_name". Page-level
// trust-flow buttons (Suggest update, Report closed, etc.) declare their
// own event name so we don't have to maintain a selector list here.
function wireDataAnalytics() {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'click',
    (event) => {
      const a = event.target.closest('[data-analytics]');
      if (!a) return;
      track(a.dataset.analytics, {});
    },
    { capture: true },
  );

  // Auto-wire listing detail link clicks from the city page cards.
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('.listing h3 a, .listing a[href^="/activities/"]');
      if (!link) return;
      const article = link.closest('.listing');
      const slug = article?.dataset?.slug;
      if (slug) analytics.listingClick(slug);
    },
    { capture: true },
  );
}

initPlausible();
wireDataAnalytics();
