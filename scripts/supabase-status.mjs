import { readFile } from 'node:fs/promises';

function parseEnv(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function loadEnv() {
  const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and a Supabase key in .env first.');
  }

  return { url: url.replace(/\/$/, ''), key };
}

async function countRows(config, table) {
  const response = await fetch(`${config.url}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      range: '0-0',
      prefer: 'count=exact',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to count ${table}: ${response.status} ${await response.text()}`);
  }

  const range = response.headers.get('content-range') ?? '';
  const count = range.includes('/') ? range.split('/').at(-1) : 'unknown';
  return count;
}

const config = await loadEnv();
for (const table of ['cities', 'towns', 'activities', 'activity_sources', 'feed_items', 'activity_updates']) {
  console.log(`${table}: ${await countRows(config, table)}`);
}
