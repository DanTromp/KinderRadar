import {
  normalizeActivityUpdateSubmission,
  normalizeDigestSignup,
} from './submissions.js';

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicError(response, body, target = 'review queue') {
  const snippet = stripHtml(body);
  const cloudflare521 = response.status === 521 || /Cloudflare|Web server is down|Error code 521/i.test(snippet);
  if (cloudflare521) {
    return `The ${target} is temporarily unreachable (${response.status}). Please try again in a few minutes.`;
  }
  if (response.status === 401 || response.status === 403) {
    return `The ${target} is not accepting submissions right now. Please try again later.`;
  }
  if (response.status >= 500) {
    return `The ${target} is temporarily unavailable (${response.status}). Please try again in a few minutes.`;
  }
  return `Could not save this submission (${response.status}). Please check the form and try again.`;
}

export function publicSupabaseConfig(purpose = 'submissions') {
  if (typeof window === 'undefined') {
    throw new Error(`Supabase is not configured for ${purpose}.`);
  }
  const cfg = window.MEINKINDERRADAR_SUPABASE;
  if (!cfg?.url || !cfg?.publishableKey) {
    throw new Error(`Supabase is not configured for ${purpose}.`);
  }

  let url;
  try {
    url = new URL(String(cfg.url));
  } catch {
    throw new Error(`Supabase is not configured correctly for ${purpose}.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Supabase is not configured correctly for ${purpose}.`);
  }

  return {
    url: url.href.replace(/\/$/, ''),
    key: String(cfg.publishableKey),
  };
}

async function postActivityUpdateRow(payload, { purpose = 'submissions' } = {}) {
  const cfg = publicSupabaseConfig(purpose);
  let response;

  try {
    response = await fetch(`${cfg.url}/rest/v1/activity_updates`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the review queue. Please try again in a few minutes.');
  }

  if (!response.ok) {
    throw new Error(publicError(response, await response.text()));
  }
}

export async function postActivityUpdate(payload, { purpose = 'submissions' } = {}) {
  await postActivityUpdateRow(normalizeActivityUpdateSubmission(payload), { purpose });
}

async function postDigestSubscriberRow(payload) {
  const cfg = publicSupabaseConfig('digest signups');
  let response;

  try {
    response = await fetch(`${cfg.url}/rest/v1/digest_subscribers`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the digest list. Please try again in a few minutes.');
  }

  if (response.status === 409) {
    return;
  }

  if (!response.ok) {
    throw new Error(publicError(response, await response.text(), 'digest list'));
  }
}

export async function postDigestSignup(payload) {
  await postDigestSubscriberRow(normalizeDigestSignup(payload));
}
