import { track } from './analytics.js';

function config() {
  const cfg = window.MEINKINDERRADAR_SUPABASE;
  if (!cfg?.url || !cfg?.publishableKey) return null;
  return {
    url: String(cfg.url).replace(/\/$/, ''),
    key: String(cfg.publishableKey),
  };
}

function value(form, name) {
  return String(new FormData(form).get(name) ?? '').trim();
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
    activity_slug: null,
    update_type: 'submission',
    status: 'new',
    evidence_url: null,
    reporter_email: value(form, 'email'),
    payload: {
      type: 'digest_signup',
      citySlug: value(form, 'citySlug'),
      cityName: value(form, 'cityName'),
      interest: value(form, 'interest'),
      sourcePage: window.location.href,
      consent: true,
    },
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
  const cfg = config();
  if (!cfg) {
    throw new Error('Supabase is not configured for digest signups.');
  }

  const response = await fetch(`${cfg.url}/rest/v1/activity_updates`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(payloadFor(form)),
  });

  if (!response.ok) {
    throw new Error(`Could not save signup (${response.status}).`);
  }
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
