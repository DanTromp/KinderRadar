import { readFile } from 'node:fs/promises';

import { UPDATE_STATUSES } from './review-utils.mjs';

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
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || key === 'replace_with_service_role_key_locally') {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  }

  return { url: url.replace(/\/$/, ''), key };
}

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '';
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  node scripts/supabase-update-status.mjs --id=<activity_updates id> --status=<status>

Statuses:
  ${[...UPDATE_STATUSES].join(', ')}

Examples:
  npm run supabase:update-status -- --id=<uuid> --status=needs_review
  npm run supabase:update-status -- --id=<uuid> --status=applied
`);
  process.exit(0);
}

const id = arg('id');
const status = arg('status');

if (!id) {
  throw new Error('Missing --id=<activity_updates id>.');
}

if (!UPDATE_STATUSES.has(status)) {
  throw new Error(`Missing or invalid --status. Use one of: ${[...UPDATE_STATUSES].join(', ')}`);
}

const config = await loadEnv();
const response = await fetch(`${config.url}/rest/v1/activity_updates?id=eq.${encodeURIComponent(id)}`, {
  method: 'PATCH',
  headers: {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  },
  body: JSON.stringify({ status }),
});

if (!response.ok) {
  throw new Error(`Failed to update status: ${response.status} ${await response.text()}`);
}

const rows = await response.json();
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error(`No activity update found for id ${id}.`);
}

console.log(`Marked ${id} as ${status}.`);
