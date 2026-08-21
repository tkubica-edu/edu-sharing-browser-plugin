#!/usr/bin/env node
// Sets the extension version everywhere it is written by hand, refreshes the
// lockfile, and prints the git commands that tag the release.
// Usage: node scripts/version.mjs <x.y.z>

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files carrying the version in their top-level "version" field. The
// per-browser manifest overlays (manifest.chrome/firefox/safari.json) hold no
// version of their own — they inherit it when build.mjs merges them onto
// manifest.base.json. package-lock.json follows via `npm install`.
const FILES = ['package.json', 'manifest.base.json'];

const VERSION_RE = /^\d+\.\d+\.\d+$/;

const log = (...a) => console.log(...a);

function usage(message) {
  if (message) log(`⚠ ${message}`);
  log('Usage: node scripts/version.mjs <x.y.z>');
  log('  e.g. node scripts/version.mjs 0.1.6');
  process.exit(1);
}

// Rewrites the first top-level "version" field and leaves the rest of the file
// byte-for-byte alone: manifest.base.json is hand-formatted with blank lines
// and grouping that a JSON.parse/stringify round-trip would flatten. Returns
// the version that was replaced.
async function setVersion(file, version) {
  const abs = path.join(ROOT, file);
  const before = await fs.readFile(abs, 'utf8');
  const field = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
  const match = before.match(field);
  if (!match) throw new Error(`no "version" field found in ${file}`);
  await fs.writeFile(abs, before.replace(field, `$1${version}$3`));
  return match[2];
}

async function main() {
  const version = process.argv[2];
  if (!version) usage('no version given.');
  if (!VERSION_RE.test(version)) usage(`"${version}" is not an x.y.z version.`);

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const current = pkg.version;
  if (current === version) {
    log(`⚠ already at ${version} — nothing to do.`);
    process.exit(1);
  }

  log(`edu-sharing version — ${current} → ${version}\n`);

  for (const file of FILES) {
    const previous = await setVersion(file, version);
    log(`✓ ${file}: ${previous} → ${version}`);
  }

  log('\n▶ npm install — pulling the new version into package-lock.json …');
  const npm = spawnSync('npm', ['install'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (npm.status !== 0) {
    log(`\n⚠ npm install exited with ${npm.status ?? npm.signal} — package-lock.json may still hold ${current}.`);
    log('  The files above are written; run `npm install` by hand to finish.');
  }

  log(`\n✓ ${version} written to ${FILES.join(', ')}, package-lock.json`);
  log('\nTODO: Commit the change, then tag and push:');
  log(`  git tag v${version}`);
  log('  git push --tags');
}

main().catch((e) => { console.error(e); process.exit(1); });
