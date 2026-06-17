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
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || key === 'replace_with_service_role_key_locally') {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  }

  return { url: url.replace(/\/$/, ''), key };
}

async function fetchUpdates(config, status = 'new') {
  const query = new URLSearchParams({
    select: 'id,created_at,update_type,status,activity_slug,evidence_url,reporter_email,payload',
    status: `eq.${status}`,
    order: 'created_at.desc',
    limit: '25',
  });
  const response = await fetch(`${config.url}/rest/v1/activity_updates?${query.toString()}`, {
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch updates: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function describe(update) {
  const payload = update.payload ?? {};
  const subject = update.activity_slug || payload.activityName || '(missing activity name)';
  const town = payload.town ? `, ${payload.town}` : '';
  const evidence = update.evidence_url ? `\n  evidence: ${update.evidence_url}` : '';
  const notes = payload.notes ? `\n  notes: ${String(payload.notes).slice(0, 180)}` : '';
  return `[${update.update_type}] ${subject}${town}\n  id: ${update.id}\n  created: ${update.created_at}${evidence}${notes}`;
}

const statusArg = process.argv.find((arg) => arg.startsWith('--status='))?.split('=').at(1) ?? 'new';
const config = await loadEnv();
const updates = await fetchUpdates(config, statusArg);

if (updates.length === 0) {
  console.log(`No ${statusArg} activity updates.`);
} else {
  console.log(`${updates.length} ${statusArg} activity update(s):\n`);
  console.log(updates.map(describe).join('\n\n'));
}
