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

function updateType(form) {
  return form.dataset.updateType || value(form, 'updateType') || 'update';
}

function payloadFor(form) {
  const type = updateType(form);
  const activitySlug = form.dataset.activitySlug || null;
  const activityName = form.dataset.activityName || value(form, 'activityName');
  const town = form.dataset.town || value(form, 'town');
  const sourceUrl = value(form, 'sourceUrl');
  const evidenceUrl = value(form, 'evidenceUrl') || sourceUrl;
  const notes = value(form, 'notes');
  const reporterEmail = value(form, 'reporterEmail');

  return {
    activity_slug: activitySlug,
    update_type: type,
    status: 'new',
    evidence_url: evidenceUrl || null,
    reporter_email: reporterEmail || null,
    payload: {
      activityName,
      town,
      city: form.dataset.city || '',
      sourceUrl,
      evidenceUrl,
      notes,
      pageUrl: window.location.href,
    },
  };
}

function validate(form) {
  const type = updateType(form);
  if (value(form, 'website')) {
    return 'Thanks.';
  }

  if (type === 'submission') {
    if (!value(form, 'activityName')) return 'Please add the activity name.';
    if (!value(form, 'town')) return 'Please choose a town.';
    if (!value(form, 'sourceUrl')) return 'Please add a source or organizer URL.';
  }

  return '';
}

async function submitUpdate(form) {
  const cfg = config();
  if (!cfg) {
    throw new Error('Supabase is not configured for public updates.');
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
    throw new Error(`Could not send update (${response.status}).`);
  }
}

function wireForm(form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const validation = validate(form);
    if (validation) {
      setStatus(form, validation, validation === 'Thanks.' ? 'success' : 'error');
      return;
    }

    button?.setAttribute('disabled', 'true');
    setStatus(form, 'Sending...', 'neutral');

    try {
      await submitUpdate(form);
      const type = updateType(form);
      setStatus(form, 'Thanks. This has been sent for review.', 'success');
      form.reset();
      track(`${type === 'submission' ? 'submit_activity' : type}_form_submit`, {});
    } catch (error) {
      setStatus(form, error instanceof Error ? error.message : 'Could not send update.', 'error');
    } finally {
      button?.removeAttribute('disabled');
    }
  });
}

document.querySelectorAll('[data-meinkinderradar-update]').forEach(wireForm);
