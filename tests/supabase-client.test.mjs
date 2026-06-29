import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadSupabaseEnv,
  normalizeSupabaseUrl,
  parseEnv,
  supabaseFetch,
  supabaseHeaders,
} from '../scripts/supabase-client.mjs';

test('parseEnv reads quoted and unquoted Supabase values', () => {
  assert.deepEqual(parseEnv(`
    # local only
    SUPABASE_URL="https://example.supabase.co/"
    SUPABASE_SERVICE_ROLE_KEY=secret
  `), {
    SUPABASE_URL: 'https://example.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  });
});

test('normalizeSupabaseUrl validates and trims trailing slash', () => {
  assert.equal(normalizeSupabaseUrl('https://example.supabase.co/'), 'https://example.supabase.co');
  assert.throws(() => normalizeSupabaseUrl('not-a-url'), /valid http\(s\) URL/);
  assert.throws(() => normalizeSupabaseUrl('ftp://example.supabase.co'), /http or https/);
});

test('loadSupabaseEnv validates required URL and key values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kr-supabase-env-'));
  const envFile = join(dir, '.env');
  try {
    await writeFile(envFile, 'SUPABASE_URL=https://example.supabase.co/\n', 'utf8');
    await assert.rejects(
      () => loadSupabaseEnv({ envFile, requireServiceRole: true, action: 'testing' }),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );

    await writeFile(envFile, 'SUPABASE_URL=not-a-url\nSUPABASE_SERVICE_ROLE_KEY=secret\n', 'utf8');
    await assert.rejects(
      () => loadSupabaseEnv({ envFile, requireServiceRole: true, action: 'testing' }),
      /valid http\(s\) URL/,
    );

    await writeFile(envFile, 'SUPABASE_URL=https://example.supabase.co/\nSUPABASE_SERVICE_ROLE_KEY=secret\n', 'utf8');
    assert.deepEqual(await loadSupabaseEnv({ envFile, requireServiceRole: true, action: 'testing' }), {
      url: 'https://example.supabase.co',
      key: 'secret',
      serviceRole: 'secret',
      publishableKey: undefined,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('supabaseHeaders preserves the existing REST auth header shape', () => {
  assert.deepEqual(supabaseHeaders('abc', { prefer: 'count=exact' }), {
    apikey: 'abc',
    authorization: 'Bearer abc',
    prefer: 'count=exact',
  });
});

test('supabaseFetch reports Cloudflare 521 as project availability issue', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<title>supabase.co | 521: Web server is down</title>', {
    status: 521,
    statusText: 'Web Server Is Down',
  });

  try {
    await assert.rejects(
      () => supabaseFetch(
        { url: 'https://example.supabase.co', key: 'secret' },
        '/rest/v1/cities?select=*',
        {},
        'Count rows in cities',
      ),
      /Cloudflare 521.*active\/reachable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('supabaseFetch reports network failures without dumping stack traces', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      () => supabaseFetch(
        { url: 'https://example.supabase.co', key: 'secret' },
        '/rest/v1/cities?select=*',
        {},
        'Count rows in cities',
      ),
      /could not reach Supabase.*fetch failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
