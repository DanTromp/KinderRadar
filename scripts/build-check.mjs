import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  'index.html',
  'cities/haltern-am-see/index.html',
  'assets/styles.css',
  'assets/filters.js',
  'assets/filtering.mjs',
  'assets/activities-data.mjs',
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
}

console.log('Build check passed: static MVP files are present.');
