#!/usr/bin/env node
// Cross-platform build: ng build the sidebar, merge per-browser manifests, copy
// shared source, and zip each target into dist/.
// Usage: node scripts/build.mjs [--target=chrome|firefox|safari|all] [--no-zip] [--no-ng]

import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(ROOT, 'vendor');
const APP_SRC = path.join(ROOT, 'app-src');
const SIDEBAR = path.join(ROOT, 'sidebar');
// Pre-built edu-sharing web component bundle (registers <edu-sharing-mds-editor>)
// and the small host files (html/env/bridge) overlaid on top of it.
const WEBCOMPONENT_SRC = path.join(ROOT, 'scripts', 'webcomponent');
const WEBCOMPONENT_HOST = path.join(ROOT, 'webcomponent-host');

const TARGETS = ['chrome', 'firefox', 'safari'];

// Shared source copied verbatim into every target build.
const SHARED_DIRS = ['icons', 'background', 'content', 'sidebar', 'vendor'];
const SHARED_FILES = ['config.js', 'sw.js'];

const log = (...a) => console.log(...a);
const rel = (p) => path.relative(ROOT, p) || '.';

function parseCli() {
  // strict:false so we can support `--no-zip` / `--no-ng` negations manually
  // (Node's parseArgs does not auto-negate boolean options).
  const { values } = parseArgs({
    strict: false,
    options: { target: { type: 'string', default: 'all' } }
  });
  const argv = process.argv.slice(2);
  const zip = !argv.includes('--no-zip');
  const ng = !argv.includes('--no-ng');

  const target = String(values.target || 'all').toLowerCase();
  const targets = target === 'all' ? TARGETS : [target];
  for (const t of targets) {
    if (!TARGETS.includes(t)) {
      console.error(`Unknown target "${t}". Use one of: ${TARGETS.join(', ')}, all.`);
      process.exit(1);
    }
  }
  return { targets, zip, ng };
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge delta onto base: objects merge recursively; arrays/scalars replace.
function deepMerge(base, delta) {
  if (!isPlainObject(base) || !isPlainObject(delta)) return delta;
  const out = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function ensureVendorPolyfill() {
  const dest = path.join(VENDOR, 'browser-polyfill.min.js');
  const src = path.join(APP_SRC, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.min.js');
  await fs.mkdir(VENDOR, { recursive: true });
  if (existsSync(src)) {
    await fs.copyFile(src, dest);
    await fs.copyFile(src + '.map', path.join(VENDOR, 'browser-polyfill.min.js.map')).catch(() => {});
    log(`✓ vendored webextension-polyfill → ${rel(dest)}`);
  } else if (existsSync(dest)) {
    log(`✓ using existing ${rel(dest)} (node_modules not installed)`);
  } else {
    console.error('✗ webextension-polyfill not found. Install app-src deps, or commit vendor/browser-polyfill.min.js.');
    process.exit(1);
  }
}

// Build the Angular sidebar app and copy its dist into sidebar/.
function buildAngular() {
  if (!existsSync(path.join(APP_SRC, 'angular.json'))) {
    log(`⚠ --ng: no Angular project at ${rel(APP_SRC)}; skipping (using committed sidebar/).`);
    return Promise.resolve();
  }
  log(`▶ ng build in ${rel(APP_SRC)} …`);
  const r = spawnSync('npx', ['ng', 'build', '--configuration=production'], {
    cwd: APP_SRC, stdio: 'inherit', shell: process.platform === 'win32'
  });
  if (r.status !== 0) { console.error('✗ ng build failed.'); process.exit(1); }
  return (async () => {
    // Angular CLI (application builder) writes to dist/<name>/browser.
    const distApp = path.join(APP_SRC, 'dist', 'sidebar', 'browser');
    if (!existsSync(distApp)) {
      console.error(`✗ Angular output not found at ${rel(distApp)}.`);
      process.exit(1);
    }
    await fs.rm(SIDEBAR, { recursive: true, force: true });
    await fs.mkdir(SIDEBAR, { recursive: true });
    await fs.cp(distApp, SIDEBAR, { recursive: true });
    log('✓ sidebar/ refreshed from Angular build');
  })();
}

async function assembleTarget(target) {
  const outDir = path.join(DIST, target);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const d of SHARED_DIRS) {
    const src = path.join(ROOT, d);
    if (existsSync(src)) await fs.cp(src, path.join(outDir, d), { recursive: true });
  }
  for (const f of SHARED_FILES) {
    const src = path.join(ROOT, f);
    if (existsSync(src)) await fs.copyFile(src, path.join(outDir, f));
  }

  // edu-sharing web component bundle → outDir/webcomponent, with the host overlay
  // (mds-editor.html, mds-env.js, mds-bridge.js) copied on top.
  if (existsSync(WEBCOMPONENT_SRC)) {
    const wcOut = path.join(outDir, 'webcomponent');
    await fs.cp(WEBCOMPONENT_SRC, wcOut, { recursive: true });
    if (existsSync(WEBCOMPONENT_HOST)) await fs.cp(WEBCOMPONENT_HOST, wcOut, { recursive: true });
  } else {
    log(`⚠ ${rel(WEBCOMPONENT_SRC)} not found — MDS editor will not be packaged.`);
  }

  const base = await readJson(path.join(ROOT, 'manifest.base.json'));
  const delta = await readJson(path.join(ROOT, `manifest.${target}.json`));
  const manifest = deepMerge(base, delta);
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  log(`✓ assembled ${rel(outDir)} (${manifest.background.service_worker ? 'service_worker' : 'scripts'} background)`);
  return outDir;
}

async function zipDir(dir) {
  let archiver;
  try {
    archiver = (await import('archiver')).default;
  } catch {
    log(`⚠ skipping zip for ${rel(dir)} (run \`npm install\` to enable zipping).`);
    return;
  }
  const { createWriteStream } = await import('node:fs');
  const zipPath = dir + '.zip';
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize();
  });
  log(`✓ zipped → ${rel(zipPath)}`);
}

async function main() {
  const { targets, zip, ng } = parseCli();
  log(`edu-sharing build — targets: ${targets.join(', ')}\n`);

  if (ng) await buildAngular();
  await ensureVendorPolyfill();

  for (const target of targets) {
    const outDir = await assembleTarget(target);
    if (zip && target !== 'safari') await zipDir(outDir);
  }

  if (targets.includes('safari')) {
    log('\nSafari: wrap the folder into an Xcode app project (macOS + Xcode):');
    log('  xcrun safari-web-extension-converter dist/safari');
    log('  → open the generated project in Xcode and Run.');
  }
  log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
