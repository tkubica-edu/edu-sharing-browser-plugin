#!/usr/bin/env node
// Cross-platform build: ng build the sidebar, merge per-browser manifests, copy
// shared source, and zip each target into dist/.
// Usage: node scripts/build.mjs [--target=chrome|firefox|safari|all] [--no-zip] [--no-ng]
//        node scripts/build.mjs --target=<one> --watch [--run]

import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const VENDOR = path.join(ROOT, 'vendor');
const APP_SRC = path.join(ROOT, 'app-src');
const SIDEBAR = path.join(ROOT, 'sidebar');
// Pre-built web-component bundles, each copied verbatim into the target under the folder name the
// app loads it by (see WebComponentBundleService):
//   scripts/edu → edu/  — edu-sharing bundle (edu-sharing-mds-editor-wrapper, …)
//   scripts/wlo → wlo/  — WLO bundle (metadata-agent-canvas, …), loaded only when the repository
//                         config enables the browser extension custom web component
//   scripts/boerdi → boerdi/ — chat widget of the KI assistant (boerdi-chat), loaded by its screen
const BUNDLE_DIRS = ['edu', 'wlo', 'boerdi'];

// Parts of those bundles that stay out of the package, keyed by bundle name and given as
// POSIX paths relative to the bundle root. Excluding a directory drops its whole subtree.
//   edu/assets/monaco — the Monaco editor is reachable only from the bundle's admin-page and
//                       embed-page lazy routes; the extension mounts custom elements and never
//                       starts that router. Its ts.worker is ~6.7 MB, above the 5 MB
//                       addons-linter can parse, which fails `web-ext lint` with FILE_TOO_LARGE.
const BUNDLE_EXCLUDES = { edu: ['assets/monaco'] };

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
  const watch = argv.includes('--watch');
  const run = argv.includes('--run');
  // A watch run rebuilds on every keystroke-sized change; zipping that is pure waste.
  const zip = !argv.includes('--no-zip') && !watch;
  const ng = !argv.includes('--no-ng');

  const target = String(values.target || 'all').toLowerCase();
  const targets = target === 'all' ? TARGETS : [target];
  for (const t of targets) {
    if (!TARGETS.includes(t)) {
      console.error(`Unknown target "${t}". Use one of: ${TARGETS.join(', ')}, all.`);
      process.exit(1);
    }
  }
  if (watch && targets.length !== 1) {
    console.error('--watch builds a single target; pass --target=chrome|firefox|safari.');
    process.exit(1);
  }
  return { targets, zip, ng, watch, run };
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

// Angular CLI (application builder) writes the sidebar app here.
const NG_OUT = path.join(APP_SRC, 'dist', 'sidebar', 'browser');

// Replace sidebar/ with the Angular build output.
async function refreshSidebar() {
  if (!existsSync(NG_OUT)) {
    console.error(`✗ Angular output not found at ${rel(NG_OUT)}.`);
    return false;
  }
  await fs.rm(SIDEBAR, { recursive: true, force: true });
  await fs.mkdir(SIDEBAR, { recursive: true });
  await fs.cp(NG_OUT, SIDEBAR, { recursive: true });
  log('✓ sidebar/ refreshed from Angular build');
  return true;
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
    if (!(await refreshSidebar())) process.exit(1);
  })();
}

// True when `relPath` (relative to a bundle root, platform separators) is one of the POSIX
// `excludes` or sits below one. The bundle root itself comes through as '' and is never excluded.
function isExcluded(relPath, excludes) {
  const p = relPath.split(path.sep).join('/');
  return excludes.some((e) => p === e || p.startsWith(e + '/'));
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

  // Web-component bundles → outDir/<name>, keeping the folder name the app loads them by.
  for (const name of BUNDLE_DIRS) {
    const src = path.join(ROOT, 'scripts', name);
    if (!existsSync(src)) {
      log(`⚠ ${rel(src)} not found — the ${name} web components will not be packaged.`);
      continue;
    }
    const excludes = BUNDLE_EXCLUDES[name] ?? [];
    await fs.cp(src, path.join(outDir, name), {
      recursive: true,
      filter: (from) => !isExcluded(path.relative(src, from), excludes)
    });
    if (excludes.length) log(`  ↳ ${name}: left out ${excludes.join(', ')}`);
  }

  const manifest = await writeManifest(target, outDir);

  log(`✓ assembled ${rel(outDir)} (${manifest.background.service_worker ? 'service_worker' : 'scripts'} background)`);
  return outDir;
}

// Merge manifest.base.json with the target's delta into outDir/manifest.json.
async function writeManifest(target, outDir) {
  const base = await readJson(path.join(ROOT, 'manifest.base.json'));
  const delta = await readJson(path.join(ROOT, `manifest.${target}.json`));
  const manifest = deepMerge(base, delta);
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
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

// Re-copy one shared dir or file from the repo root into an assembled target.
async function syncShared(name, outDir) {
  const src = path.join(ROOT, name);
  const dest = path.join(outDir, name);
  if (!existsSync(src)) return;
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(src, dest, { recursive: true });
  } else {
    await fs.copyFile(src, dest);
  }
  log(`↻ ${name} → ${rel(outDir)}`);
}

// Put the running Angular build straight into the target's sidebar/, leaving the committed
// sidebar/ — which holds the production build — untouched.
async function syncNgOutput(outDir) {
  if (!existsSync(path.join(NG_OUT, 'index.html'))) return;
  const dest = path.join(outDir, 'sidebar');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(NG_OUT, dest, { recursive: true });
  log(`↻ sidebar (ng watch) → ${rel(outDir)}`);
}

// Collapse a burst of file-system events into a single trailing call.
function debounce(fn, ms) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void fn(); }, ms);
  };
}

// Watch a path for changes; a missing path is skipped rather than fatal.
function watchPath(target, handler) {
  const p = path.join(ROOT, target);
  if (!existsSync(p)) return;
  const recursive = existsSync(p) && fsSync.statSync(p).isDirectory();
  fsSync.watch(p, { recursive }, handler);
}

// Development loop: `ng build --watch` rebuilds the sidebar app on every source change, its output
// and the extension's own source are copied into the assembled target as they change, and (with
// --run) web-ext keeps a Firefox instance on that folder, reloading the extension whenever it moves.
async function watchTarget(target, { ng, run }) {
  await ensureVendorPolyfill();

  let ngProc = null;
  if (ng && existsSync(path.join(APP_SRC, 'angular.json'))) {
    log(`▶ ng build --watch in ${rel(APP_SRC)} …`);
    ngProc = spawn('npx', ['ng', 'build', '--watch', '--configuration=development'], {
      cwd: APP_SRC, stdio: 'inherit', shell: process.platform === 'win32'
    });
    // The first watch build has to land before the target can be assembled from it.
    log('… waiting for the first Angular build');
    while (!existsSync(path.join(NG_OUT, 'index.html'))) await delay(500);
    await delay(500);
  }

  const outDir = await assembleTarget(target);
  if (ngProc) await syncNgOutput(outDir);

  let webExtProc = null;
  if (run) {
    if (target === 'firefox') {
      log('▶ web-ext run — Firefox reloads the extension on every rebuild');
      webExtProc = spawn('npx', ['web-ext', 'run', '--source-dir', rel(outDir)], {
        cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'
      });
    } else {
      log(`⚠ --run only drives Firefox; reload ${target} by hand on its extensions page.`);
    }
  }

  if (ngProc) watchPath(path.relative(ROOT, NG_OUT), debounce(() => syncNgOutput(outDir), 400));

  // The extension's own source, which no Angular build covers.
  const shared = ngProc ? SHARED_DIRS.filter((d) => d !== 'sidebar') : SHARED_DIRS;
  for (const name of [...shared, ...SHARED_FILES]) {
    watchPath(name, debounce(() => syncShared(name, outDir), 200));
  }
  for (const name of ['manifest.base.json', `manifest.${target}.json`]) {
    watchPath(name, debounce(async () => {
      await writeManifest(target, outDir);
      log(`↻ manifest.json → ${rel(outDir)}`);
    }, 200));
  }

  log(`\n👀 watching — ${rel(outDir)} stays up to date. Ctrl-C to stop.`);
  log(`   The committed ${rel(SIDEBAR)} is left alone; only ${rel(outDir)} follows the ng watch.`);
  log('   A reloaded extension does not re-render an open panel: close and reopen it.');

  const stop = () => {
    ngProc?.kill();
    webExtProc?.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { targets, zip, ng, watch, run } = parseCli();
  log(`edu-sharing build — targets: ${targets.join(', ')}\n`);

  if (watch) return watchTarget(targets[0], { ng, run });

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
    log('Or without Xcode (temporary, gone at the next Safari restart):');
    log('  Safari → Settings → Advanced → tick "Show features for web developers"');
    log('  → that is what makes the Developer tab appear');
    log('  → Developer → Extensions');
    log('  → tick "Allow unsigned extensions"');
    log('  → "Add Temporary Extension…" → pick dist/safari');
  }
  log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
