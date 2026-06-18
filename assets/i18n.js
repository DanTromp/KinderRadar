// Browser-side i18n runtime.
// Loads /assets/i18n/en.json and /assets/i18n/de.json once, picks a language
// (localStorage → navigator → 'en'), and translates any element carrying a
// data-i18n / data-i18n-attr / data-i18n-text-de attribute.
//
// Static pages render the English text inline so no-JS visitors and crawlers
// see a working page; this script then swaps it for the selected language.

const STORAGE_KEY = 'kr-lang';
const SUPPORTED = ['en', 'de'];

const state = {
  current: 'en',
  translations: { en: {}, de: {} },
  loaded: false,
};

function detectInitialLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {
    /* localStorage may be blocked; fall through */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language)
    ? navigator.language.slice(0, 2).toLowerCase()
    : 'en';
  return SUPPORTED.includes(nav) ? nav : 'en';
}

function lookup(lang, key) {
  const table = state.translations[lang];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  // Fallback chain: requested lang → en → raw key.
  const en = state.translations.en;
  if (en && Object.prototype.hasOwnProperty.call(en, key)) return en[key];
  return key;
}

function format(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : ''
  ));
}

function readParams(el) {
  const raw = el.getAttribute('data-i18n-params');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function translate(key, params) {
  return format(lookup(state.current, key), params);
}

export function apply(root) {
  const scope = root ?? document;

  if (state.loaded) {
    // Text content translation.
    const textEls = scope.querySelectorAll('[data-i18n]');
    textEls.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = format(lookup(state.current, key), readParams(el));
    });

    // Attribute translation. Format: "attr1:key1,attr2:key2".
    const attrEls = scope.querySelectorAll('[data-i18n-attr]');
    attrEls.forEach((el) => {
      const spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      const params = readParams(el);
      for (const pair of spec.split(',')) {
        const idx = pair.indexOf(':');
        if (idx <= 0) continue;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (!attr || !key) continue;
        el.setAttribute(attr, format(lookup(state.current, key), params));
      }
    });
  }

  // Free-text per-listing fields: data-i18n-text-de overrides the English
  // textContent when German is active. Initial text is the English version.
  const freeEls = scope.querySelectorAll('[data-i18n-text-de]');
  freeEls.forEach((el) => {
    const de = el.getAttribute('data-i18n-text-de');
    const en = el.getAttribute('data-i18n-text-en');
    if (state.current === 'de' && de) {
      el.textContent = de;
    } else if (en) {
      el.textContent = en;
    }
    // If no -en cache is present, leave whatever text is already there for
    // English mode — the SSR/runtime renderer put the English text in place.
  });

  if (!root) {
    document.documentElement.setAttribute('lang', state.current);
  }
}

export function setLang(lang) {
  if (!SUPPORTED.includes(lang) || lang === state.current) return;
  state.current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  apply();
  updateTogglePressed();
  document.dispatchEvent(new CustomEvent('kr:lang-change', { detail: { lang } }));
}

export function currentLang() {
  return state.current;
}

function updateTogglePressed() {
  document.querySelectorAll('[data-lang-toggle] [data-lang]').forEach((el) => {
    el.setAttribute('aria-pressed', el.getAttribute('data-lang') === state.current ? 'true' : 'false');
  });
}

function wireToggle() {
  document.querySelectorAll('[data-lang-toggle]').forEach((bar) => {
    bar.addEventListener('click', (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-lang]')
        : null;
      if (!target || !bar.contains(target)) return;
      const lang = target.getAttribute('data-lang');
      if (lang) setLang(lang);
    });
  });
  updateTogglePressed();
}

async function loadTranslations() {
  if (state.loaded) return;
  try {
    const enUrl = new URL('./i18n/en.json', import.meta.url);
    const deUrl = new URL('./i18n/de.json', import.meta.url);
    const [en, de] = await Promise.all([
      fetch(enUrl).then((r) => r.json()),
      fetch(deUrl).then((r) => r.json()),
    ]);
    state.translations = { en, de };
    state.loaded = true;
  } catch (err) {
    // Network failure: fall back to whatever was rendered (English) and
    // expose the failure on the console without breaking the page.
    console.warn('My Kids Radar i18n: failed to load translations', err);
  }
}

async function init() {
  state.current = detectInitialLang();
  // Apply early so the <html lang> and toggle press state reflect the choice
  // even before translations resolve. Then apply again when JSON has loaded.
  document.documentElement.setAttribute('lang', state.current);
  wireToggle();
  await loadTranslations();
  apply();
  // Re-apply whenever another script signals it rebuilt parts of the DOM
  // (e.g. filters.js rebuilding the chip bar / listings root).
  document.addEventListener('kr:dom-updated', (event) => {
    const root = (event && event.detail && event.detail.root) || undefined;
    apply(root);
  });
}

// Expose a small global so non-module scripts can re-trigger translation.
if (typeof window !== 'undefined') {
  window.krI18n = { apply, setLang, currentLang, translate };
}

init();
