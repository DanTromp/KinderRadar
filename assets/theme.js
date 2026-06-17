const STORAGE_KEY = 'kr-theme';
const THEMES = ['light', 'night', 'forest'];

function preferredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (THEMES.includes(stored)) return stored;
  } catch {
    /* localStorage can be unavailable; fall through */
  }

  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'night';
  }

  return 'light';
}

function applyTheme(theme) {
  const safeTheme = THEMES.includes(theme) ? theme : 'light';
  document.documentElement.dataset.theme = safeTheme;
  document.querySelectorAll('[data-theme-toggle] [data-theme-value]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.themeValue === safeTheme ? 'true' : 'false');
  });
}

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

function initThemeControls() {
  document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-theme-value]')
        : null;
      if (!button || !toggle.contains(button)) return;
      setTheme(button.dataset.themeValue);
    });
  });
}

applyTheme(preferredTheme());
initThemeControls();

if (typeof window !== 'undefined') {
  window.krTheme = { setTheme };
}
