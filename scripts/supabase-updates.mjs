import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { describeUpdate, renderHtml, renderMarkdown } from './review-utils.mjs';

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

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  node scripts/supabase-updates.mjs [--status=new] [--format=text|markdown|html|json] [--out=path] [--limit=50]

Examples:
  npm run supabase:updates
  npm run supabase:updates -- --status=needs_review --format=markdown
  npm run supabase:review
`);
  process.exit(0);
}

async function fetchUpdates(config, status = 'new') {
  const query = new URLSearchParams({
    select: 'id,created_at,update_type,status,activity_slug,evidence_url,reporter_email,payload',
    status: `eq.${status}`,
    order: 'created_at.desc',
    limit: arg('limit', '50'),
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

function render(updates, { status, format }) {
  if (format === 'json') return `${JSON.stringify(updates, null, 2)}\n`;
  if (format === 'markdown' || format === 'md') return renderMarkdown(updates, { status });
  if (format === 'html') return renderHtml(updates, { status });
  if (updates.length === 0) return `No ${status} activity updates.\n`;
  return `${updates.length} ${status} activity update(s):\n\n${updates.map(describeUpdate).join('\n\n')}\n`;
}

const status = arg('status', 'new');
const format = arg('format', 'text');
const out = arg('out');
const config = await loadEnv();
const updates = await fetchUpdates(config, status);
const output = render(updates, { status, format });

if (out) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, output, 'utf8');
  console.log(`Wrote ${updates.length} update(s) to ${out}`);
} else {
  process.stdout.write(output);
}
