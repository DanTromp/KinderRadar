import { execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  activities,
  categories,
  cities,
  sections,
} from '../assets/activities-data.mjs';
import { buildOrganizers } from '../assets/organizers.mjs';
import { freshnessStatus, normalizedAccessibility, normalizedLocation } from '../assets/render.mjs';
import { buildCoverageReport } from './coverage-report.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const DATA_PATH = 'assets/activities-data.mjs';
const COLLECTION_COUNT = 6;

function isActive(activity) {
  return activity?.status !== 'reported-closed' && activity?.status !== 'inactive';
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function staleCounts(activeActivities, now) {
  const over = (days) => activeActivities.filter((activity) => {
    const freshness = freshnessStatus(activity, now);
    return freshness.days === null || freshness.days < 0 || freshness.days > days;
  }).length;
  return {
    over30: over(30),
    over60: over(60),
    over90: over(90),
  };
}

function oldestLastVerified(activeActivities) {
  return activeActivities
    .map((activity) => activity.lastVerified)
    .filter(Boolean)
    .sort()[0] ?? null;
}

function statusCounts(allActivities) {
  const counts = {};
  for (const activity of allActivities) {
    const status = activity.status ?? 'active';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

async function distSummary(distDir = DIST) {
  const files = await walkFiles(distDir);
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  const sitemapPath = join(distDir, 'sitemap.xml');
  const robotsPath = join(distDir, 'robots.txt');
  const sitemap = await readFile(sitemapPath, 'utf8');
  const robots = await readFile(robotsPath, 'utf8');
  const sitemapUrlCount = (sitemap.match(/<url>/g) ?? []).length;
  const canonicalPageCount = await htmlFiles.reduce(async (promise, file) => {
    const count = await promise;
    const html = await readFile(file, 'utf8');
    return count + (/<link rel="canonical"/.test(html) ? 1 : 0);
  }, Promise.resolve(0));

  return {
    distFileCount: files.length,
    htmlPageCount: htmlFiles.length,
    generatedEntryCount: htmlFiles.length + 2,
    sitemapUrlCount,
    robotsHasSitemap: /Sitemap:/i.test(robots),
    canonicalPageCount,
    samplePages: htmlFiles.slice(0, 5).map((file) => relative(distDir, file).replaceAll('\\', '/')),
  };
}

async function gitText(args, { cwd = ROOT } = {}) {
  try {
    const result = await execFileAsync('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr || error.message,
    };
  }
}

async function previousDataSummary() {
  const result = await gitText(['show', `HEAD:${DATA_PATH}`]);
  if (!result.ok || !result.stdout.trim()) {
    return { available: false, reason: result.stderr.trim() || 'No git HEAD data available.' };
  }

  try {
    const encoded = Buffer.from(result.stdout, 'utf8').toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}`);
    const previousActivities = Array.isArray(module.activities) ? module.activities : [];
    const previousActive = previousActivities.filter(isActive);
    return {
      available: true,
      activities: previousActivities.length,
      activeActivities: previousActive.length,
      inactiveActivities: previousActivities.length - previousActive.length,
      statusCounts: statusCounts(previousActivities),
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

async function gitSummary(current) {
  const status = await gitText(['status', '--porcelain', '--', DATA_PATH]);
  const previous = await previousDataSummary();
  const changed = status.ok ? status.stdout.trim().length > 0 : null;
  const diff = previous.available
    ? {
      activities: current.totals.activities - previous.activities,
      activeActivities: current.totals.activeActivities - previous.activeActivities,
      inactiveActivities: current.totals.inactiveActivities - previous.inactiveActivities,
    }
    : null;

  return {
    available: status.ok,
    dataFileChanged: changed,
    statusOutput: status.stdout.trim(),
    previous,
    diff,
  };
}

export async function buildReleaseSummary({
  now = new Date(),
  distDir = DIST,
  allActivities = activities,
  allCategories = categories,
  allCities = cities,
  allSections = sections,
  includeGit = true,
} = {}) {
  const activeActivities = allActivities.filter(isActive);
  const coverage = buildCoverageReport({
    activities: allActivities,
    categories: allCategories,
    cities: allCities,
    sections: allSections,
    now,
  });
  const dist = await distSummary(distDir);
  const metadata = {
    missingStartTime: activeActivities.filter((activity) => !activity.startTime).length,
    missingDayOfWeek: activeActivities.filter((activity) => !activity.dayOfWeek).length,
    missingAccessibility: activeActivities.filter((activity) => !normalizedAccessibility(activity)).length,
    missingGeodata: activeActivities.filter((activity) => !normalizedLocation(activity)).length,
  };
  const totals = {
    activities: allActivities.length,
    activeActivities: activeActivities.length,
    inactiveActivities: allActivities.length - activeActivities.length,
    cityPages: allCities.length,
    organizers: buildOrganizers(activeActivities).length,
    categories: allCategories.length,
    collections: COLLECTION_COUNT,
    sections: allSections.length,
  };
  const summary = {
    generatedAt: now.toISOString(),
    totals,
    dist,
    verification: {
      oldestLastVerified: oldestLastVerified(activeActivities),
      stale: staleCounts(activeActivities, now),
      fresh30Pct: coverage.verification.fresh30Pct,
      checked90Pct: coverage.verification.checked90Pct,
    },
    metadata,
    git: includeGit ? await gitSummary({ totals }) : { available: false, dataFileChanged: null, previous: { available: false }, diff: null },
  };
  return {
    ...summary,
    risks: detectReleaseRisks(summary),
  };
}

export function detectReleaseRisks(summary) {
  const risks = [];
  const warnings = [];

  if (summary.totals.activeActivities <= 0) {
    risks.push('No active activities would be published.');
  }
  if (summary.totals.cityPages <= 0) {
    risks.push('No city/place pages are configured.');
  }
  if (summary.dist.htmlPageCount <= 0) {
    risks.push('No generated HTML pages found in dist/.');
  }
  if (summary.dist.sitemapUrlCount <= 0) {
    risks.push('sitemap.xml has no URL entries.');
  }
  if (!summary.dist.robotsHasSitemap) {
    risks.push('robots.txt does not reference sitemap.xml.');
  }
  if (summary.dist.sitemapUrlCount < summary.dist.htmlPageCount) {
    warnings.push(`Sitemap URL count (${summary.dist.sitemapUrlCount}) is lower than HTML page count (${summary.dist.htmlPageCount}).`);
  }
  if (summary.dist.canonicalPageCount < summary.dist.htmlPageCount) {
    warnings.push(`Canonical tag count (${summary.dist.canonicalPageCount}) is lower than HTML page count (${summary.dist.htmlPageCount}).`);
  }
  if (summary.git?.diff) {
    if (summary.git.diff.activeActivities <= -5) {
      warnings.push(`Active activity count changed by ${summary.git.diff.activeActivities}; inspect the data diff before publishing.`);
    }
    if (summary.git.diff.inactiveActivities >= 5) {
      warnings.push(`Inactive/reported-closed activity count increased by ${summary.git.diff.inactiveActivities}; inspect the data diff before publishing.`);
    }
  }

  return { hardFailures: risks, warnings };
}

export function renderReleaseSummary(summary) {
  const lines = [
    'KinderRadar Release Check Summary',
    `Generated: ${summary.generatedAt}`,
    '',
    'Data:',
    `- Activities: ${summary.totals.activeActivities}/${summary.totals.activities} active (${summary.totals.inactiveActivities} inactive/reported closed)`,
    `- Place pages: ${summary.totals.cityPages}`,
    `- Organizer profiles: ${summary.totals.organizers}`,
    `- Categories: ${summary.totals.categories}`,
    `- Collections: ${summary.totals.collections}`,
    '',
    'Generated output:',
    `- HTML pages: ${summary.dist.htmlPageCount}`,
    `- Generated entries incl. sitemap/robots: ${summary.dist.generatedEntryCount}`,
    `- Dist files: ${summary.dist.distFileCount}`,
    `- Sitemap URLs: ${summary.dist.sitemapUrlCount}`,
    `- Canonical pages: ${summary.dist.canonicalPageCount}`,
    `- robots.txt references sitemap: ${summary.dist.robotsHasSitemap ? 'yes' : 'no'}`,
    '',
    'Freshness and metadata:',
    `- Oldest lastVerified: ${summary.verification.oldestLastVerified ?? 'unknown'}`,
    `- Listings older than 30/60/90 days: ${summary.verification.stale.over30}/${summary.verification.stale.over60}/${summary.verification.stale.over90}`,
    `- Missing startTime: ${summary.metadata.missingStartTime}`,
    `- Missing dayOfWeek: ${summary.metadata.missingDayOfWeek}`,
    `- Missing accessibility: ${summary.metadata.missingAccessibility}`,
    `- Missing geodata: ${summary.metadata.missingGeodata}`,
    '',
    'Git/data diff:',
    `- Git available: ${summary.git.available ? 'yes' : 'no'}`,
    `- ${DATA_PATH} changed: ${summary.git.dataFileChanged === null ? 'unknown' : summary.git.dataFileChanged ? 'yes' : 'no'}`,
  ];

  if (summary.git.diff) {
    lines.push(
      `- Activity count delta: ${summary.git.diff.activities}`,
      `- Active activity delta: ${summary.git.diff.activeActivities}`,
      `- Inactive/reported-closed delta: ${summary.git.diff.inactiveActivities}`,
    );
  } else if (summary.git.previous && !summary.git.previous.available) {
    lines.push(`- Previous data comparison unavailable: ${summary.git.previous.reason ?? 'unknown'}`);
  }

  lines.push(
    '',
    'Warnings:',
    ...(summary.risks.warnings.length ? summary.risks.warnings.map((warning) => `- ${warning}`) : ['- none']),
    '',
    'Hard failures:',
    ...(summary.risks.hardFailures.length ? summary.risks.hardFailures.map((risk) => `- ${risk}`) : ['- none']),
    '',
    'Manual deploy note: this command does not deploy, commit, write Supabase, or modify activity data.',
  );

  return `${lines.join('\n')}\n`;
}

function npmProcess(args) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...args].join(' ')],
    };
  }
  return { command: 'npm', args };
}

async function runStep(label, args) {
  console.log(`\n== ${label} ==`);
  await new Promise((resolveStep, rejectStep) => {
    const npm = npmProcess(args);
    const child = spawn(npm.command, npm.args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', rejectStep);
    child.on('exit', (code) => {
      if (code === 0) resolveStep();
      else rejectStep(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  await runStep('Tests', ['test']);
  await runStep('Build', ['run', 'build']);
  await runStep('Coverage report', ['run', 'coverage:report']);

  const summary = await buildReleaseSummary();
  console.log('');
  console.log(renderReleaseSummary(summary));
  if (summary.risks.hardFailures.length > 0) {
    process.exitCode = 1;
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
