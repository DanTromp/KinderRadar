import { track } from './analytics.js';
import { postActivityUpdate } from './supabase-public.js';

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
  const organizerId = form.dataset.organizerId || value(form, 'organizerId');
  const organizerName = form.dataset.organizerName || value(form, 'organizerName');
  const claimantName = value(form, 'claimantName');
  const claimantEmail = value(form, 'claimantEmail') || value(form, 'reporterEmail');
  const claimantRole = value(form, 'claimantRole');
  const verificationUrl = value(form, 'verificationUrl') || value(form, 'evidenceUrl');
  const message = value(form, 'message') || value(form, 'notes');

  if (type === 'organizer_claim') {
    return {
      update_type: type,
      organizer_id: organizerId,
      evidence_url: verificationUrl || null,
      reporter_email: claimantEmail || null,
      payload: {
        organizerId,
        organizerName,
        claimantName,
        claimantEmail,
        claimantRole,
        verificationUrl,
        message,
        pageUrl: window.location.href,
      },
    };
  }

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

  if (type === 'organizer_claim') {
    if (!form.dataset.organizerId && !value(form, 'organizerId')) return 'This claim is missing an organizer reference. Please reload the page and try again.';
    if (!form.dataset.organizerName && !value(form, 'organizerName')) return 'This claim is missing the organizer name. Please reload the page and try again.';
    if (!value(form, 'claimantName')) return 'Please add your name.';
    if (!value(form, 'claimantEmail')) return 'Please add a valid email address.';
    if (!value(form, 'claimantRole') && !value(form, 'verificationUrl') && !value(form, 'message')) {
      return 'Please add your role, a verification URL, or a short message.';
    }
  }

  return '';
}

async function submitUpdate(form) {
  await postActivityUpdate(payloadFor(form), { purpose: 'public updates' });
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
