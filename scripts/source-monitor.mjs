import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGISTRY = new URL('../data/source-registry.json', import.meta.url);
const DEFAULT_SNAPSHOT = new URL('../review/source-monitor/snapshot.json', import.meta.url);
const DEFAULT_CANDIDATES = new URL('../review/source-monitor/candidates.json', import.meta.url);
const DEFAULT_REPORT_JSON = new URL('../review/source-monitor/report.json', import.meta.url);
const DEFAULT_REPORT_MARKDOWN = new URL('../review/source-monitor/report.md', import.meta.url);
const USER_AGENT = 'MeinKinderRadar source monitor/1.0 (+https://meinkinderradar.de; manual review only)';
const DEFAULT_TIMEOUT_MS = 8000;
const TRUST_LEVELS = new Set(['official', 'organizer', 'partner', 'community']);
const FREQUENCIES = new Set(['weekly', 'monthly', 'quarterly', 'manual']);

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeId(value) {
  return text(value).toLowerCase();
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sourceSummary(source) {
  return source?.id ? `source "${source.id}"` : 'source';
}

export function hashContent(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

export function validateSourceRegistry(input) {
  const errors = [];
  const warnings = [];
  const rawSources = Array.isArray(input) ? input : [];

  if (!Array.isArray(input)) {
    errors.push('Source registry must be a JSON array.');
  }

  const ids = new Map();
  const urls = new Map();
  const sources = rawSources.map((raw, index) => {
    const source = {
      id: normalizeId(raw?.id),
      town: text(raw?.town),
      sourceType: text(raw?.sourceType || raw?.source_type || 'website'),
      organizerName: text(raw?.organizerName || raw?.organizer_name),
      url: text(raw?.url),
      trustLevel: text(raw?.trustLevel || raw?.trust_level),
      crawlFrequency: text(raw?.crawlFrequency || raw?.crawl_frequency || 'manual'),
      active: raw?.active !== false,
      notes: text(raw?.notes),
    };

    if (!source.id) errors.push(`source at index ${index} is missing id.`);
    if (source.id && ids.has(source.id)) errors.push(`Duplicate source id "${source.id}".`);
    if (source.id) ids.set(source.id, source);

    if (!source.town) errors.push(`${sourceSummary(source)} is missing town.`);
    if (!source.url) errors.push(`${sourceSummary(source)} is missing url.`);
    if (source.url && !validHttpUrl(source.url)) errors.push(`${sourceSummary(source)} has invalid url "${source.url}".`);
    const normalizedUrl = source.url.toLowerCase().replace(/\/$/, '');
    if (source.url && urls.has(normalizedUrl)) errors.push(`Duplicate source url "${source.url}".`);
    if (source.url) urls.set(normalizedUrl, source);

    if (!source.trustLevel) errors.push(`${sourceSummary(source)} is missing trustLevel.`);
    if (source.trustLevel && !TRUST_LEVELS.has(source.trustLevel)) {
      errors.push(`${sourceSummary(source)} has unsupported trustLevel "${source.trustLevel}".`);
    }

    if (!FREQUENCIES.has(source.crawlFrequency)) {
      warnings.push(`${sourceSummary(source)} has non-standard crawlFrequency "${source.crawlFrequency}".`);
    }

    return source;
  });

  return { sources, errors, warnings };
}

export async function loadSourceRegistry(registryPath = DEFAULT_REGISTRY) {
  const contents = await readFile(registryPath, 'utf8');
  const parsed = JSON.parse(contents);
  const result = validateSourceRegistry(parsed);
  if (result.errors.length > 0) {
    throw new Error(`Invalid source registry:\n${result.errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return result;
}

function snapshotEntryFor(check) {
  return {
    sourceId: check.sourceId,
    url: check.sourceUrl,
    result: check.result,
    httpStatus: check.httpStatus,
    hash: check.hash,
    etag: check.etag,
    lastModified: check.lastModified,
    checkedAt: check.checkedAt,
  };
}

export async function readSnapshot(snapshotPath = DEFAULT_SNAPSHOT) {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const entries = Array.isArray(parsed?.sources) ? parsed.sources : [];
    return {
      exists: true,
      generatedAt: text(parsed?.generatedAt),
      sources: entries.filter((entry) => entry?.sourceId),
      warnings: [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, generatedAt: '', sources: [], warnings: [] };
    }
    return {
      exists: false,
      generatedAt: '',
      sources: [],
      warnings: [`Could not read previous source snapshot; starting fresh. ${error.message}`],
    };
  }
}

function previousById(snapshot) {
  return new Map((snapshot?.sources ?? []).map((entry) => [entry.sourceId, entry]));
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function checkSource(source, {
  fetchImpl = globalThis.fetch,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const checkedAt = now.toISOString();
  const timer = timeoutSignal(timeoutMs);

  try {
    const response = await fetchImpl(source.url, {
      redirect: 'follow',
      signal: timer.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
      },
    });
    const body = await response.text();
    return {
      sourceId: source.id,
      sourceUrl: source.url,
      town: source.town,
      organizerName: source.organizerName,
      checkedAt,
      result: response.ok ? 'reachable' : 'http_error',
      httpStatus: response.status,
      statusText: text(response.statusText),
      hash: hashContent(body),
      etag: text(response.headers.get('etag')),
      lastModified: text(response.headers.get('last-modified')),
      error: '',
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      sourceId: source.id,
      sourceUrl: source.url,
      town: source.town,
      organizerName: source.organizerName,
      checkedAt,
      result: timedOut ? 'timeout' : 'unreachable',
      httpStatus: null,
      statusText: '',
      hash: '',
      etag: '',
      lastModified: '',
      error: timedOut ? `Timed out after ${timeoutMs}ms.` : text(error?.message || error),
    };
  } finally {
    timer.clear();
  }
}

function changeCandidate(source, check, type, confidence, reason) {
  const rawSnapshotRef = check.hash
    ? `sha256:${check.hash.slice(0, 16)}`
    : `status:${check.result}:${check.httpStatus ?? 'none'}`;
  const candidateType = type === 'availability_changed'
    ? 'source_unreachable'
    : 'source_change';
  const id = [
    'source',
    source.id,
    candidateType,
    check.hash ? check.hash.slice(0, 12) : `${check.result}-${check.httpStatus ?? 'none'}`,
  ].join(':');
  return {
    id,
    sourceId: source.id,
    sourceUrl: source.url,
    town: source.town,
    organizerName: source.organizerName,
    candidateType,
    detectedChangeType: type,
    confidence,
    reason,
    detectedAt: check.checkedAt,
    checkedAt: check.checkedAt,
    status: 'needs_review',
    reviewStatus: 'needs_review',
    rawSnapshotRef,
  };
}

export function classifyCheck(source, check, previous, snapshotExists) {
  if (!previous) {
    if (!snapshotExists) return { state: 'baseline', candidate: null };
    return {
      state: 'new_source',
      candidate: changeCandidate(source, check, 'new_source', 'medium', 'Source is active but was not present in the previous snapshot.'),
    };
  }

  const previousReachable = previous.result === 'reachable';
  if (check.result !== 'reachable') {
    if (previous.result !== check.result || previous.httpStatus !== check.httpStatus) {
      return {
        state: check.result,
        candidate: changeCandidate(source, check, 'availability_changed', 'low', `Source check returned ${check.result}${check.httpStatus ? ` (${check.httpStatus})` : ''}.`),
      };
    }
    return { state: check.result, candidate: null };
  }

  if (!previousReachable) {
    return {
      state: 'available_again',
      candidate: changeCandidate(source, check, 'availability_changed', 'low', 'Source is reachable again after a previous failed check.'),
    };
  }

  if (previous.httpStatus !== check.httpStatus) {
    return {
      state: 'status_changed',
      candidate: changeCandidate(source, check, 'status_changed', 'low', `HTTP status changed from ${previous.httpStatus ?? 'unknown'} to ${check.httpStatus}.`),
    };
  }

  if (previous.hash && check.hash && previous.hash !== check.hash) {
    return {
      state: 'changed',
      candidate: changeCandidate(source, check, 'content_changed', 'medium', 'Page content hash changed since the previous snapshot.'),
    };
  }

  if (!previous.hash && ((previous.etag && previous.etag !== check.etag) || (previous.lastModified && previous.lastModified !== check.lastModified))) {
    return {
      state: 'changed',
      candidate: changeCandidate(source, check, 'content_changed', 'low', 'ETag or Last-Modified changed since the previous snapshot.'),
    };
  }

  return { state: 'unchanged', candidate: null };
}

export async function buildSourceMonitorReport({
  registry,
  snapshot = { exists: false, sources: [], warnings: [] },
  fetchImpl = globalThis.fetch,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const validation = validateSourceRegistry(registry);
  if (validation.errors.length > 0) {
    throw new Error(`Invalid source registry:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }

  const previous = previousById(snapshot);
  const activeSources = validation.sources.filter((source) => source.active);
  const inactiveSources = validation.sources.filter((source) => !source.active);
  const checks = [];
  const candidates = [];

  for (const source of activeSources) {
    const check = await checkSource(source, { fetchImpl, now, timeoutMs });
    const classification = classifyCheck(source, check, previous.get(source.id), snapshot.exists);
    checks.push({ ...check, state: classification.state });
    if (classification.candidate) candidates.push(classification.candidate);
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      sources: validation.sources.length,
      activeSources: activeSources.length,
      inactiveSources: inactiveSources.length,
      changedSources: candidates.length,
      reachableSources: checks.filter((check) => check.result === 'reachable').length,
      unreachableSources: checks.filter((check) => check.result !== 'reachable').length,
    },
    warnings: [...validation.warnings, ...(snapshot.warnings ?? [])],
    snapshotExists: snapshot.exists,
    checks,
    skippedInactive: inactiveSources.map((source) => ({ sourceId: source.id, url: source.url, town: source.town })),
    candidates,
    snapshot: {
      generatedAt: now.toISOString(),
      sources: checks.map(snapshotEntryFor),
    },
  };
}

export function renderSourceMonitorReport(report) {
  const lines = [
    'KinderRadar Source Monitor',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${report.totals.activeSources}/${report.totals.sources} active sources checked, ${report.totals.reachableSources} reachable, ${report.totals.unreachableSources} unreachable, ${report.candidates.length} review candidate(s).`,
    report.snapshotExists ? 'Snapshot: compared with previous local snapshot.' : 'Snapshot: no previous snapshot found; this run establishes the baseline.',
  ];

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', ...report.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('', 'Sources:');
  if (report.checks.length === 0) {
    lines.push('- none checked');
  } else {
    lines.push(...report.checks.map((check) => {
      const status = check.httpStatus ? `${check.result} ${check.httpStatus}` : check.result;
      return `- [${check.state}] ${check.sourceId} (${check.town}): ${status} | ${check.sourceUrl}`;
    }));
  }

  if (report.skippedInactive.length > 0) {
    lines.push('', 'Skipped inactive sources:', ...report.skippedInactive.map((source) => `- ${source.sourceId} (${source.town})`));
  }

  lines.push('', 'Review candidates:');
  if (report.candidates.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...report.candidates.map((candidate) => `- ${candidate.sourceId}: ${candidate.detectedChangeType} (${candidate.confidence}) | ${candidate.reason}`));
  }

  return `${lines.join('\n')}\n`;
}

export function renderSourceMonitorMarkdown(report) {
  const candidateRows = report.candidates.length
    ? report.candidates.map((candidate) => `| ${candidate.sourceId} | ${candidate.town || ''} | ${candidate.detectedChangeType} | ${candidate.confidence} | ${candidate.reason} |`)
    : ['| none |  |  |  |  |'];
  const checkRows = report.checks.length
    ? report.checks.map((check) => `| ${check.sourceId} | ${check.town || ''} | ${check.state} | ${check.result} | ${check.httpStatus ?? ''} | ${check.sourceUrl} |`)
    : ['| none |  |  |  |  |  |'];
  const warnings = report.warnings.length
    ? report.warnings.map((warning) => `- ${warning}`)
    : ['- none'];

  return [
    '# KinderRadar Source Monitor Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Sources checked: ${report.totals.activeSources}/${report.totals.sources}`,
    `- Reachable: ${report.totals.reachableSources}`,
    `- Unreachable or HTTP errors: ${report.totals.unreachableSources}`,
    `- Review candidates: ${report.candidates.length}`,
    `- Snapshot: ${report.snapshotExists ? 'compared with previous local snapshot' : 'baseline run; no previous snapshot found'}`,
    '',
    '## Warnings',
    '',
    ...warnings,
    '',
    '## Sources',
    '',
    '| Source | Town | State | Result | HTTP | URL |',
    '| --- | --- | --- | --- | --- | --- |',
    ...checkRows,
    '',
    '## Review Candidates',
    '',
    '| Source | Town | Change | Confidence | Reason |',
    '| --- | --- | --- | --- | --- |',
    ...candidateRows,
    '',
    'This report is review-only. It does not publish activities, update Supabase, or modify live activity data.',
    '',
  ].join('\n');
}

async function writeJson(pathLike, value) {
  const filePath = pathLike instanceof URL ? fileURLToPath(pathLike) : pathLike;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(pathLike, value) {
  const filePath = pathLike instanceof URL ? fileURLToPath(pathLike) : pathLike;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

function argValue(args, name, fallback) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  return fallback;
}

function wantsJson(args) {
  return args.includes('--json') || args.includes('--format=json');
}

function printHelp() {
  console.log([
    'Usage: node scripts/source-monitor.mjs [--json] [--no-write]',
    '',
    'Options:',
    '  --registry=<path>    Source registry JSON path.',
    '  --snapshot=<path>    Previous/current snapshot path.',
    '  --candidates=<path>  Candidate report output path.',
    '  --report=<path>      Full JSON report output path.',
    '  --markdown=<path>    Markdown report output path.',
    '  --timeout=<ms>       Per-source fetch timeout. Default: 8000.',
    '',
    'Reads trusted source URLs, writes small review-only metadata under review/source-monitor/,',
    'and never edits live activity data or Supabase.',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const registryPath = resolve(argValue(args, '--registry', fileURLToPath(DEFAULT_REGISTRY)));
  const snapshotPath = resolve(argValue(args, '--snapshot', fileURLToPath(DEFAULT_SNAPSHOT)));
  const candidatesPath = resolve(argValue(args, '--candidates', fileURLToPath(DEFAULT_CANDIDATES)));
  const reportPath = resolve(argValue(args, '--report', fileURLToPath(DEFAULT_REPORT_JSON)));
  const markdownPath = resolve(argValue(args, '--markdown', fileURLToPath(DEFAULT_REPORT_MARKDOWN)));
  const timeoutMs = Number(argValue(args, '--timeout', DEFAULT_TIMEOUT_MS));
  const shouldWrite = !args.includes('--no-write');

  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const snapshot = await readSnapshot(snapshotPath);
  const report = await buildSourceMonitorReport({
    registry,
    snapshot,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  });

  if (shouldWrite) {
    await writeJson(snapshotPath, report.snapshot);
    await writeJson(candidatesPath, {
      generatedAt: report.generatedAt,
      candidates: report.candidates,
    });
    await writeJson(reportPath, report);
    await writeText(markdownPath, renderSourceMonitorMarkdown(report));
  }

  if (wantsJson(args)) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderSourceMonitorReport(report));
    if (shouldWrite) {
      console.log(`Wrote snapshot: ${snapshotPath}`);
      console.log(`Wrote candidates: ${candidatesPath}`);
      console.log(`Wrote report: ${reportPath}`);
      console.log(`Wrote markdown: ${markdownPath}`);
    }
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
