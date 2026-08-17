/**
 * Fetch the widget bundle from the backend into `scripts/boerdi/`.
 *
 * **Why this is necessary.** Manifest V3 forbids remotely loaded code: an
 * extension page runs under `script-src 'self'`, so a
 * `<script src="https://backend/widget/boerdi-widget.js">` is blocked. The
 * bundle therefore has to sit in the folder. That is not a detour this example
 * takes, it is the rule — every real extension has to do it the same way.
 *
 *     node scripts/fetch-widget.mjs https://87.106.127.225.nip.io   # the deployed backend
 *     node scripts/fetch-widget.mjs http://localhost:8000          # one running locally
 *
 * Afterwards `npm run build:chrome`, so the bundle reaches `dist/`, and then
 * "Reload" in `chrome://extensions` — Chrome does not notice a swapped bundle
 * on its own.
 *
 * **Only against a backend you trust.** Whatever arrives here runs with the
 * extension's privileges afterwards, including the access it has to the pages
 * you granted it. There is no checksum (none is published), so the source is
 * the whole of the security. Over `http://` on a foreign host anyone in
 * between can swap the code; this script says so but refuses nothing —
 * developing against `localhost`, `http` is the normal case.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, 'boerdi', 'boerdi-widget.js');

const base = (process.argv[2] || 'http://localhost:8000').replace(/\/+$/, '');
const source = `${base}/widget/boerdi-widget.js`;

console.log(`Fetching ${source}`);

// Unencrypted from a foreign host: then anyone along the way decides what runs
// with the extension's privileges next. No abort — against `localhost` that is
// exactly everyday development.
try {
  const url = new URL(source);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) {
    console.warn(`\n  WARNING: ${url.hostname} serves over http, so unprotected.`);
    console.warn("  Whatever arrives here runs with the extension's privileges afterwards.\n");
  }
} catch {
  // Unusable address — the fetch below reports it with a clearer line anyway.
}

let response;
try {
  response = await fetch(source);
} catch (err) {
  console.error(`\n  Backend unreachable: ${err.message}`);
  console.error('  Is it running? And is the address right?\n');
  process.exit(1);
}

if (!response.ok) {
  console.error(`\n  ${response.status} ${response.statusText}`);
  if (response.status === 503) {
    console.error('  503 means: the bundle is not built in the backend.');
    console.error('  In its repository: cd frontend && npm run build:widget\n');
  }
  process.exit(1);
}

const code = await response.text();
// A 200 carrying an HTML error page would be worse than a 404: the file would
// be there, and the extension would fail only on load, with a syntax error
// nobody traces back to here.
if (/^\s*</.test(code)) {
  console.error('\n  The response is not JavaScript but HTML.');
  console.error('  Does the address really point at the backend?\n');
  process.exit(1);
}

await mkdir(dirname(TARGET), { recursive: true });
await writeFile(TARGET, code, 'utf8');

const kb = Math.round(code.length / 1024);
console.log(`  Wrote scripts/boerdi/boerdi-widget.js (${kb} kB).`);
console.log('  Now run npm run build:chrome and hit "Reload" in chrome://extensions.');
