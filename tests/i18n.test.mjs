import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const en = await loadJson(join(ROOT, 'assets/i18n/en.json'));
const de = await loadJson(join(ROOT, 'assets/i18n/de.json'));

test('en.json and de.json have identical key sets', () => {
  const enKeys = new Set(Object.keys(en));
  const deKeys = new Set(Object.keys(de));
  const missingInDe = [...enKeys].filter((k) => !deKeys.has(k));
  const missingInEn = [...deKeys].filter((k) => !enKeys.has(k));
  assert.deepEqual(missingInDe, [], `keys missing in de.json: ${missingInDe.join(', ')}`);
  assert.deepEqual(missingInEn, [], `keys missing in en.json: ${missingInEn.join(', ')}`);
});

test('every translation value is a non-empty string', () => {
  for (const [lang, table] of [['en', en], ['de', de]]) {
    for (const [key, value] of Object.entries(table)) {
      assert.equal(typeof value, 'string', `${lang}.${key} must be a string`);
      assert.ok(value.length > 0, `${lang}.${key} must be non-empty`);
    }
  }
});

test('placeholders ({foo}) match between en and de for shared keys', () => {
  for (const key of Object.keys(en)) {
    const enPh = (en[key].match(/\{(\w+)\}/g) ?? []).sort();
    const dePh = (de[key].match(/\{(\w+)\}/g) ?? []).sort();
    assert.deepEqual(dePh, enPh, `placeholder mismatch in key "${key}": en=${enPh.join(',')} de=${dePh.join(',')}`);
  }
});

// Collect every data-i18n="..." and data-i18n-attr="attr:KEY,..." key the
// build emits across the generated site. Every one of those keys must exist
// in en.json (and therefore, by the parity test above, in de.json).
async function collectI18nKeysFromBuiltSite() {
  const keys = new Set();
  const dataI18nRe = /data-i18n="([^"]+)"/g;
  const dataI18nAttrRe = /data-i18n-attr="([^"]+)"/g;
  const files = [
    join(DIST, 'index.html'),
    join(DIST, 'shortlist', 'index.html'),
  ];
  for (const slug of readdirSync(join(DIST, 'cities'))) {
    files.push(join(DIST, 'cities', slug, 'index.html'));
  }
  for (const slug of readdirSync(join(DIST, 'collections'))) {
    files.push(join(DIST, 'collections', slug, 'index.html'));
  }
  for (const slug of readdirSync(join(DIST, 'activities'))) {
    files.push(join(DIST, 'activities', slug, 'index.html'));
  }
  for (const slug of readdirSync(join(DIST, 'organizers'))) {
    files.push(join(DIST, 'organizers', slug, 'index.html'));
  }
  for (const f of files) {
    const html = await readFile(f, 'utf8');
    for (const m of html.matchAll(dataI18nRe)) {
      keys.add(m[1].replace(/&amp;/g, '&'));
    }
    for (const m of html.matchAll(dataI18nAttrRe)) {
      for (const pair of m[1].split(',')) {
        const idx = pair.indexOf(':');
        if (idx > 0) keys.add(pair.slice(idx + 1).trim().replace(/&amp;/g, '&'));
      }
    }
  }
  return keys;
}

test('every data-i18n key in generated pages exists in en.json', async () => {
  const usedKeys = await collectI18nKeysFromBuiltSite();
  assert.ok(usedKeys.size > 20, `expected many i18n keys in built site, found ${usedKeys.size}`);
  const missing = [...usedKeys].filter((k) => !Object.prototype.hasOwnProperty.call(en, k));
  assert.deepEqual(missing, [], `i18n keys used in HTML but missing from en.json:\n${missing.join('\n')}`);
});

test('home page canonical uses the full production URL', async () => {
  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/meinkinderradar\.de\/" \/>/,
  );
});

function collectHtmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      collectHtmlFiles(path, out);
    } else if (entry.endsWith('.html')) {
      out.push(path);
    }
  }
  return out;
}

test('generated pages avoid root-relative internal assets and links', async () => {
  const offenders = [];

  for (const file of collectHtmlFiles(DIST)) {
    const html = await readFile(file, 'utf8');
    for (const pattern of [
      /\s(?:href|src)="\/(?:assets|cities|collections|shortlist|activities|organizers)\//g,
      /url=\/(?:cities|collections|shortlist|activities|organizers)\//g,
      /window\.location\.replace\('\/(?:cities|collections|shortlist|activities|organizers)\//g,
    ]) {
      for (const match of html.matchAll(pattern)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `root-relative internal URLs break GitHub Pages project hosting:\n${offenders.join('\n')}`,
  );
});
