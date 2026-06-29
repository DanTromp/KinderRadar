import test from 'node:test';
import assert from 'node:assert/strict';

import {
  postDigestSignup,
  postActivityUpdate,
  publicSupabaseConfig,
} from '../assets/supabase-public.js';

function installSupabaseConfig(config) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      MEINKINDERRADAR_SUPABASE: config,
    },
  });
}

function cleanup() {
  delete globalThis.window;
}

test('publicSupabaseConfig validates configured URL and publishable key', () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });

  try {
    assert.deepEqual(publicSupabaseConfig('public updates'), {
      url: 'https://example.supabase.co',
      key: 'public-key',
    });
  } finally {
    cleanup();
  }
});

test('publicSupabaseConfig rejects missing public config', () => {
  installSupabaseConfig(null);
  try {
    assert.throws(() => publicSupabaseConfig('public updates'), /not configured/);
  } finally {
    cleanup();
  }
});

test('postActivityUpdate preserves the happy-path REST insert behavior', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 201 });
  };

  try {
    await postActivityUpdate({
      activity_slug: 'kids-tennis',
      update_type: 'update',
      evidence_url: 'https://example.com/source',
      payload: {
        activityName: ' Kids Tennis ',
        town: ' Sythen ',
        notes: ' New start time ',
        ignored: 'strip me',
      },
      unexpected: 'strip me too',
    }, { purpose: 'public updates' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/activity_updates');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.apikey, 'public-key');
    assert.equal(calls[0].options.headers.authorization, 'Bearer public-key');
    assert.equal(calls[0].options.headers.prefer, 'return=minimal');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      activity_slug: 'kids-tennis',
      update_type: 'update',
      status: 'new',
      evidence_url: 'https://example.com/source',
      reporter_email: null,
      payload: {
        activityName: 'Kids Tennis',
        town: 'Sythen',
        city: '',
        sourceUrl: '',
        evidenceUrl: 'https://example.com/source',
        notes: 'New start time',
        pageUrl: '',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postActivityUpdate rejects empty update submissions before Supabase insert', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('', { status: 201 });
  };

  try {
    await assert.rejects(
      () => postActivityUpdate({ activity_slug: 'kids-tennis', update_type: 'update' }, { purpose: 'public updates' }),
      /Please add evidence, a source URL, or a short note/,
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postActivityUpdate rejects unknown types and overlong values before insert', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('', { status: 201 });
  };

  try {
    await assert.rejects(
      () => postActivityUpdate({ update_type: 'mystery' }, { purpose: 'public updates' }),
      /valid report type/,
    );
    await assert.rejects(
      () => postActivityUpdate({
        activity_slug: 'kids-tennis',
        update_type: 'update',
        payload: { notes: 'x'.repeat(1201) },
      }, { purpose: 'public updates' }),
      /notes is too long/,
    );
    await assert.rejects(
      () => postActivityUpdate({
        update_type: 'closed',
        payload: { notes: 'Closed per organizer website.' },
      }, { purpose: 'public updates' }),
      /missing an activity reference/,
    );
    await assert.rejects(
      () => postActivityUpdate({
        activity_slug: 'kids-tennis',
        update_type: 'claim',
      }, { purpose: 'public updates' }),
      /email, evidence URL, or a short note/,
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postActivityUpdate accepts normalized organizer claims without live data edits', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 201 });
  };

  try {
    await postActivityUpdate({
      update_type: 'organizer_claim',
      organizer_id: 'tus-haltern',
      reporter_email: ' Coach@Example.COM ',
      payload: {
        organizerName: ' TuS Haltern ',
        claimantName: ' Coach Example ',
        claimantRole: ' Youth coach ',
        verificationUrl: 'https://tushaltern.de/kontakt',
        message: ' Please update our profile contact. ',
        ignored: 'strip me',
      },
    }, { purpose: 'public updates' });

    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.update_type, 'organizer_claim');
    assert.equal(body.activity_slug, null);
    assert.equal(body.reporter_email, 'coach@example.com');
    assert.equal(body.evidence_url, 'https://tushaltern.de/kontakt');
    assert.deepEqual(body.payload, {
      organizerId: 'tus-haltern',
      organizerName: 'TuS Haltern',
      claimantName: 'Coach Example',
      claimantEmail: 'coach@example.com',
      claimantRole: 'Youth coach',
      verificationUrl: 'https://tushaltern.de/kontakt',
      message: 'Please update our profile contact.',
      pageUrl: '',
    });
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postActivityUpdate rejects invalid organizer claims before Supabase insert', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('', { status: 201 });
  };

  try {
    await assert.rejects(
      () => postActivityUpdate({
        update_type: 'organizer_claim',
        payload: {
          organizerName: 'TuS Haltern',
          claimantName: 'Coach Example',
          claimantEmail: 'coach@example.com',
        },
      }, { purpose: 'public updates' }),
      /organizer reference/,
    );
    await assert.rejects(
      () => postActivityUpdate({
        update_type: 'organizer_claim',
        organizer_id: 'tus-haltern',
        payload: {
          organizerName: 'TuS Haltern',
          claimantName: 'Coach Example',
          claimantEmail: 'not-an-email',
          message: 'Please verify.',
        },
      }, { purpose: 'public updates' }),
      /valid email address/,
    );
    await assert.rejects(
      () => postActivityUpdate({
        update_type: 'organizer_claim',
        organizer_id: 'tus-haltern',
        payload: {
          organizerName: 'TuS Haltern',
          claimantName: 'Coach Example',
          claimantEmail: 'coach@example.com',
        },
      }, { purpose: 'public updates' }),
      /role, a verification URL, or a short message/,
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postDigestSignup inserts a normalized digest subscriber, not an activity update', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 201 });
  };

  try {
    await postDigestSignup({
      email: ' Parent@Example.COM ',
      citySlug: 'haltern-am-see',
      cityName: ' Haltern am See ',
      interest: ' weekend ',
      sourcePage: 'https://meinkinderradar.de/',
      locale: 'DE',
      consent: true,
      extra: 'strip me',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/digest_subscribers');
    assert.doesNotMatch(calls[0].url, /activity_updates/);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.email, 'parent@example.com');
    assert.equal(body.locale, 'de');
    assert.equal(body.source.cityName, 'Haltern am See');
    assert.equal(body.source.interest, 'weekend');
    assert.equal(body.source.sourcePage, 'https://meinkinderradar.de/');
    assert.match(body.consent_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(body.unsubscribe_token, /^[a-f0-9]{32}$/);
    assert.equal(Object.hasOwn(body.source, 'extra'), false);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postDigestSignup rejects invalid email before Supabase insert', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('', { status: 201 });
  };

  try {
    await assert.rejects(
      () => postDigestSignup({
        email: 'not-an-email',
        citySlug: 'haltern-am-see',
        consent: true,
      }),
      /valid email address/,
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postDigestSignup treats duplicate email signups as already handled', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('duplicate key value violates unique constraint', { status: 409 });
  };

  try {
    await postDigestSignup({
      email: 'parent@example.com',
      citySlug: 'haltern-am-see',
      consent: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/digest_subscribers');
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test('postActivityUpdate reports Cloudflare 521 without a false success', async () => {
  installSupabaseConfig({
    url: 'https://example.supabase.co/',
    publishableKey: 'public-key',
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<h1>Web server is down</h1>', { status: 521 });

  try {
    await assert.rejects(
      () => postActivityUpdate({
        activity_slug: 'kids-tennis',
        update_type: 'update',
        evidence_url: 'https://example.com/source',
      }, { purpose: 'public updates' }),
      /review queue is temporarily unreachable \(521\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});
