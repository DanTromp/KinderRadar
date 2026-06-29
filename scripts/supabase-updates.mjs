import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeUpdate, renderAdminHtml, renderHtml, renderMarkdown } from './review-utils.mjs';
import { loadSupabaseEnv, supabaseFetch, supabaseHeaders } from './supabase-client.mjs';

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
    order: 'created_at.desc',
    limit: arg('limit', '50'),
  });
  if (status !== 'all') {
    query.set('status', `eq.${status}`);
  }
  const response = await supabaseFetch(config, `/rest/v1/activity_updates?${query.toString()}`, {
    headers: supabaseHeaders(config.key),
  }, `Fetch ${status} activity updates`);

  return response.json();
}

function render(updates, { status, format }) {
  if (format === 'json') return `${JSON.stringify(updates, null, 2)}\n`;
  if (format === 'markdown' || format === 'md') return renderMarkdown(updates, { status });
  if (format === 'admin-html') return renderAdminHtml(updates, { status });
  if (format === 'html') return renderHtml(updates, { status });
  if (updates.length === 0) return `No ${status} activity updates.\n`;
  return `${updates.length} ${status} activity update(s):\n\n${updates.map(describeUpdate).join('\n\n')}\n`;
}

export async function main() {
  const status = arg('status', 'new');
  const format = arg('format', 'text');
  const out = arg('out');
  const config = await loadSupabaseEnv({
    requireServiceRole: true,
    action: 'reviewing Supabase activity updates',
  });
  const updates = await fetchUpdates(config, status);
  const output = render(updates, { status, format });

  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, output, 'utf8');
    console.log(`Wrote ${updates.length} update(s) to ${out}`);
  } else {
    process.stdout.write(output);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
