const UPDATE_TYPES = new Set(['submission', 'update', 'closed', 'confirm', 'claim', 'organizer_claim']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  slug: 120,
  name: 160,
  town: 120,
  city: 120,
  url: 800,
  email: 254,
  role: 120,
  notes: 1200,
  interest: 80,
  locale: 12,
  token: 96,
};

export class SubmissionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SubmissionValidationError';
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function limited(value, max, label, { required = false } = {}) {
  const next = text(value);
  if (required && !next) {
    throw new SubmissionValidationError(`Please add ${label}.`);
  }
  if (next.length > max) {
    throw new SubmissionValidationError(`${label} is too long. Please shorten it and try again.`);
  }
  return next;
}

function email(value, { required = false } = {}) {
  const next = text(value).toLowerCase();
  if (!next) {
    if (required) throw new SubmissionValidationError('Please add a valid email address.');
    return null;
  }
  if (next.length > LIMITS.email || !EMAIL_RE.test(next)) {
    throw new SubmissionValidationError('Please add a valid email address.');
  }
  return next;
}

function httpUrl(value, label, { required = false } = {}) {
  const next = limited(value, LIMITS.url, label, { required });
  if (!next) return '';
  let url;
  try {
    url = new URL(next);
  } catch {
    throw new SubmissionValidationError(`Please add a valid ${label}.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SubmissionValidationError(`Please add a valid ${label}.`);
  }
  return url.href;
}

function optionalPageUrl(value) {
  const next = text(value);
  if (!next) return '';
  try {
    return httpUrl(next, 'page URL');
  } catch {
    return '';
  }
}

function locale(value) {
  const next = limited(value, LIMITS.locale, 'locale').toLowerCase();
  if (!next) return '';
  return next.replace(/[^a-z-]/g, '').slice(0, LIMITS.locale);
}

function randomToken() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new SubmissionValidationError('Could not prepare signup securely. Please try again.');
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanSlug(value, label, { required = false } = {}) {
  const next = limited(value, LIMITS.slug, label, { required });
  if (!next) return '';
  if (!SLUG_RE.test(next)) {
    throw new SubmissionValidationError(`Please add a valid ${label}.`);
  }
  return next;
}

function requireActivitySlug(type, activitySlug) {
  if (type !== 'submission' && type !== 'organizer_claim' && !activitySlug) {
    throw new SubmissionValidationError('This report is missing an activity reference. Please reload the page and try again.');
  }
}

function normalizeOrganizerClaim(input, payload) {
  const organizerId = cleanSlug(
    input.organizer_id || input.organizerId || payload.organizerId || payload.organizerSlug || '',
    'organizer reference',
    { required: true },
  );
  const organizerName = limited(
    payload.organizerName || input.organizerName,
    LIMITS.name,
    'the organizer name',
    { required: true },
  );
  const claimantName = limited(
    payload.claimantName || input.claimantName || payload.reporterName || input.reporterName,
    LIMITS.name,
    'your name',
    { required: true },
  );
  const claimantEmail = email(
    input.claimant_email || input.claimantEmail || payload.claimantEmail || input.reporter_email || input.reporterEmail,
    { required: true },
  );
  const claimantRole = limited(payload.claimantRole || input.claimantRole, LIMITS.role, 'your role');
  const verificationUrl = httpUrl(
    payload.verificationUrl || input.verificationUrl || payload.website || input.website || input.evidence_url || input.evidenceUrl || '',
    'verification URL',
  );
  const message = limited(payload.message || payload.notes || input.message || input.notes, LIMITS.notes, 'message');
  const pageUrl = optionalPageUrl(payload.pageUrl || input.pageUrl);

  if (!claimantRole && !verificationUrl && !message) {
    throw new SubmissionValidationError('Please add your role, a verification URL, or a short message.');
  }

  return {
    activity_slug: null,
    update_type: 'organizer_claim',
    status: 'new',
    evidence_url: verificationUrl || null,
    reporter_email: claimantEmail,
    payload: {
      organizerId,
      organizerName,
      claimantName,
      claimantEmail,
      claimantRole,
      verificationUrl,
      message,
      pageUrl,
    },
  };
}

export function normalizeActivityUpdateSubmission(input = {}) {
  const type = text(input.update_type || input.updateType || 'update');
  if (!UPDATE_TYPES.has(type)) {
    throw new SubmissionValidationError('Please choose a valid report type.');
  }

  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  if (type === 'organizer_claim') {
    return normalizeOrganizerClaim(input, payload);
  }

  const activitySlug = cleanSlug(input.activity_slug || input.activitySlug || '', 'activity reference');
  const activityName = limited(payload.activityName || input.activityName, LIMITS.name, 'the activity name', { required: type === 'submission' });
  const town = limited(payload.town || input.town, LIMITS.town, 'the town', { required: type === 'submission' });
  const city = limited(payload.city || input.city, LIMITS.city, 'the city');
  const sourceUrl = httpUrl(payload.sourceUrl || input.sourceUrl, 'source or organizer URL', { required: type === 'submission' });
  const evidenceUrl = httpUrl(input.evidence_url || input.evidenceUrl || payload.evidenceUrl || sourceUrl, 'evidence or source URL');
  const notes = limited(payload.notes || input.notes, LIMITS.notes, 'notes');
  const reporterEmail = email(input.reporter_email || input.reporterEmail);
  const pageUrl = optionalPageUrl(payload.pageUrl || input.pageUrl);

  requireActivitySlug(type, activitySlug);

  if ((type === 'update' || type === 'closed') && !evidenceUrl && !notes) {
    throw new SubmissionValidationError('Please add evidence, a source URL, or a short note.');
  }

  if (type === 'claim' && !reporterEmail && !evidenceUrl && !notes) {
    throw new SubmissionValidationError('Please add your email, evidence URL, or a short note so we can verify the claim.');
  }

  return {
    activity_slug: activitySlug || null,
    update_type: type,
    status: 'new',
    evidence_url: evidenceUrl || null,
    reporter_email: reporterEmail,
    payload: {
      activityName,
      town,
      city,
      sourceUrl,
      evidenceUrl,
      notes,
      pageUrl,
    },
  };
}

export function normalizeDigestSignup(input = {}, { now = new Date() } = {}) {
  const emailAddress = email(input.email || input.reporter_email, { required: true });
  if (input.consent !== true) {
    throw new SubmissionValidationError('Please confirm you want to receive the digest.');
  }

  const citySlug = cleanSlug(input.citySlug, 'area', { required: true });
  const cityName = limited(input.cityName, LIMITS.city, 'area');
  const interest = limited(input.interest, LIMITS.interest, 'digest interest');
  const sourcePage = optionalPageUrl(input.sourcePage);
  const signupLocale = locale(input.locale);

  return {
    email: emailAddress,
    locale: signupLocale || null,
    source: {
      citySlug,
      cityName,
      interest,
      sourcePage,
    },
    consent_at: now.toISOString(),
    unsubscribe_token: randomToken(),
  };
}
