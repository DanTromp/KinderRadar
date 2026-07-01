import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('source-only admin review renders local candidates without Supabase env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kr-source-review-'));
  const candidatesPath = join(dir, 'candidates.json');
  const outPath = join(dir, 'review.html');
  try {
    await writeFile(candidatesPath, JSON.stringify({
      candidates: [{
        id: 'source:test:source_change:abc',
        sourceId: 'test-source',
        sourceUrl: 'https://example.com/source',
        town: 'Haltern am See',
        candidateType: 'source_change',
        confidence: 'medium',
        reason: 'Page content changed.',
        detectedAt: '2026-07-01T10:00:00Z',
        status: 'needs_review',
        rawSnapshotRef: 'sha256:abc123',
      }],
    }), 'utf8');

    const result = await execFileAsync(process.execPath, [
      'scripts/supabase-updates.mjs',
      '--source-only',
      '--format=admin-html',
      `--source-candidates=${candidatesPath}`,
      `--out=${outPath}`,
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)) });

    assert.match(result.stdout, /Wrote 0 update\(s\)/);
    const html = await readFile(outPath, 'utf8');
    assert.match(html, /Source candidate: test-source/);
    assert.match(html, /machine-detected/);
    assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
