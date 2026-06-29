import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { loadSupabaseEnv, supabaseFetch, supabaseHeaders } from './supabase-client.mjs';

async function countRows(config, table) {
  const response = await supabaseFetch(config, `/rest/v1/${table}?select=*`, {
    headers: {
      ...supabaseHeaders(config.key),
      range: '0-0',
      prefer: 'count=exact',
    },
  }, `Count rows in ${table}`);

  const range = response.headers.get('content-range') ?? '';
  const count = range.includes('/') ? range.split('/').at(-1) : 'unknown';
  return count;
}

export async function main() {
  const config = await loadSupabaseEnv({ action: 'checking Supabase status' });
  for (const table of ['cities', 'towns', 'organizers', 'activities', 'activity_sources', 'feed_items', 'activity_updates']) {
    console.log(`${table}: ${await countRows(config, table)}`);
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
