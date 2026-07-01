import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('source monitor workflow is report-only and does not require Supabase or deploy', async () => {
  const workflow = await readFile(new URL('../.github/workflows/source-monitor.yml', import.meta.url), 'utf8');

  assert.match(workflow, /cron: '17 6 \* \* 1'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /npm run sources:check/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /source-monitor-report/);
  assert.doesNotMatch(workflow, /SUPABASE_/);
  assert.doesNotMatch(workflow, /wrangler|pages deploy|npm run build:supabase/i);
});
