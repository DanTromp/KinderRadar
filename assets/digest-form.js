import { track } from './analytics.js';
import { postDigestSignup } from './supabase-public.js';

function value(form, name) {
  return String(new FormData(form).get(name) ?? '').trim();
}

function locale() {
  return document.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : '') || '';
}

function setStatus(form, message, tone = 'neutral') {
  const status = form.querySelector('[data-form-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function validate(form) {
  if (value(form, 'website')) return 'Thanks.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value(form, 'email'))) {
    return 'Please add a valid email address.';
  }
  if (!new FormData(form).get('consent')) {
    return 'Please confirm you want to receive the digest.';
  }
  return '';
}

function payloadFor(form) {
  return {
    email: value(form, 'email'),
    citySlug: value(form, 'citySlug'),
    cityName: value(form, 'cityName'),
    interest: value(form, 'interest'),
    sourcePage: window.location.href,
    locale: locale(),
    consent: Boolean(new FormData(form).get('consent')),
  };
}

function syncCityName(form) {
  const select = form.elements.citySlug;
  const cityName = form.elements.cityName;
  if (!select || !cityName) return;
  const selected = select.options[select.selectedIndex];
  cityName.value = selected?.dataset.cityName || selected?.textContent || '';
}

async function submitDigest(form) {
  await postDigestSignup(payloadFor(form));
}

function wireForm(form) {
  syncCityName(form);
  form.elements.citySlug?.addEventListener('change', () => syncCityName(form));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    syncCityName(form);
    const button = form.querySelector('button[type="submit"]');
    const validation = validate(form);
    if (validation) {
      setStatus(form, validation, validation === 'Thanks.' ? 'success' : 'error');
      return;
    }

    button?.setAttribute('disabled', 'true');
    setStatus(form, 'Saving...', 'neutral');

    try {
      await submitDigest(form);
      setStatus(form, 'Thanks. You are on the digest list.', 'success');
      track('digest_signup_submit', {
        city: value(form, 'citySlug'),
        interest: value(form, 'interest'),
      });
      form.reset();
    } catch (error) {
      setStatus(form, error instanceof Error ? error.message : 'Could not save signup.', 'error');
    } finally {
      button?.removeAttribute('disabled');
    }
  });
}

document.querySelectorAll('[data-meinkinderradar-digest]').forEach(wireForm);
