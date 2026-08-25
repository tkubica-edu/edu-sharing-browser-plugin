import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_CONFIG, METADATA_AGENT_API_URL } from '../app/config';
import { GENERATE_FIXTURES } from '../app/services/dev-mode.service';
import { CONTENT_TEXT_MAX } from '../app/util/page-context';

/**
 * The contracts between the panel and the extension around it — `background/background.js`,
 * `content/*.js`, `sw.js`, the manifests and the root `config.js`. None of those files exports
 * anything: two of them assign to `self` and one runs as an injected IIFE, so nothing here can be
 * imported and the extension's side of each pair is read as text.
 *
 * Every pair below is held in step by hand today, and each one breaks *silently*: a panel action the
 * worker does not route answers `NO_RESPONSE`, a file missing from one of the two lists leaves one
 * browser without it, a storage key that drifts leaves one side reading what the other never wrote.
 * That is what makes them worth a test even though no logic is being exercised.
 */

/** The repo root, found from the working directory — `npm test` runs from either it or `app-src`. */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'manifest.base.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no repo root above ' + process.cwd());
    dir = parent;
  }
  return dir;
}

const ROOT = repoRoot();

/** One of the repo's files, as text. */
function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** One of the repo's JSON files. */
function readJson(path: string): Record<string, never> {
  return JSON.parse(read(path));
}

/**
 * A data-only file evaluated instead of parsed: `config.js` and `background/dev-fixtures.js` are
 * literals behind a `self` guard, so running them in a sandbox states what the worker really sees —
 * a regex over them would state what this spec believes about their formatting.
 */
function evaluate<T>(path: string, name: string): T {
  const source = read(path);
  return new Function(
    'self',
    'module',
    'console',
    `${source}\nreturn ${name};`,
  )({}, undefined, { log: () => undefined }) as T;
}

/** The strings of a `const NAME = new Set([...])`. */
function setLiteral(source: string, name: string): string[] {
  const found = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`).exec(source);
  expect(found, `no Set literal named ${name}`).not.toBeNull();
  return [...found![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** The value of a `const NAME = '…'`. */
function stringConstant(source: string, name: string): string {
  const found = new RegExp(`const ${name} = '([^']*)'`).exec(source);
  expect(found, `no string constant named ${name}`).not.toBeNull();
  return found![1];
}

/** The value of a `const NAME = 123`. */
function numberConstant(source: string, name: string): number {
  const found = new RegExp(`const ${name} = (\\d+)`).exec(source);
  expect(found, `no number constant named ${name}`).not.toBeNull();
  return Number(found![1]);
}

/** Every string literal in `source`, whatever quotes it carries. */
function stringLiterals(source: string): string[] {
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}

const background = read('background/background.js');
const panelHost = read('content/panel-host.js');
const content = read('content/content.js');
const browserExtensionService = read('app-src/src/app/services/browser-extension.service.ts');

describe('the actions the panel sends and the worker routes', () => {
  /** Every `action:` the panel puts into a message to the worker. */
  const sent = [
    ...new Set([...browserExtensionService.matchAll(/action: '([^']+)'/g)].map((m) => m[1])),
  ];
  /** Plus the one the content script sends, which speaks for the page rather than for the panel. */
  const sentByPanelHost = [...new Set([...panelHost.matchAll(/action: '([^']+)'/g)].map((m) => m[1]))];
  const allowed = setLiteral(background, 'ALLOWED_ACTIONS');
  const routed = [...background.matchAll(/case '([^']+)':/g)].map((match) => match[1]);

  it('reads more than one action out of each side, or it is asserting on nothing', () => {
    expect(sent.length).toBeGreaterThan(1);
    expect(allowed.length).toBeGreaterThan(1);
    expect(routed.length).toBeGreaterThan(1);
  });

  it('lets every action the panel sends past the listener', () => {
    // The listener returns before the switch for anything it does not know, so an action missing
    // here is a route that cannot work however completely it is implemented behind it.
    expect(allowed).toEqual(expect.arrayContaining(sent));
  });

  it('lets the content script`s own report past as well', () => {
    expect(allowed).toEqual(expect.arrayContaining(sentByPanelHost));
  });

  it('routes every action it lets past', () => {
    // The other direction: an allowed action with no case answers `UNKNOWN_ACTION`, which reads like
    // a stale caller rather than like a worker that was never finished.
    expect(routed).toEqual(expect.arrayContaining(allowed));
  });

  it('allows nothing it does not route, so the two lists are one', () => {
    expect([...allowed].sort()).toEqual([...routed].sort());
  });
});

describe('the files the worker is built from', () => {
  const imported = [
    ...read('sw.js')
      .slice(read('sw.js').indexOf('importScripts('))
      .matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  const declared = (readJson('manifest.firefox.json') as unknown as {
    background: { scripts: string[] };
  }).background.scripts;

  it('loads the same files in the same order in both browsers', () => {
    // Chrome runs `sw.js`, Firefox the manifest's list; a file added to one alone leaves the other
    // browser's worker without it, and the failure shows up as an undefined global far from here.
    expect(imported).toEqual(declared);
  });

  it('names only files that are there', () => {
    expect(imported.length).toBeGreaterThan(1);
    imported.forEach((file) => expect(existsSync(join(ROOT, file)), file).toBe(true));
  });
});

describe('the panel element the two content scripts share', () => {
  it('is found again by the id it was created under', () => {
    // The worker asks the page whether the panel is there, the host script created it — under two
    // literals that no build step ties together.
    expect(stringConstant(background, 'PANEL_ELEMENT_ID')).toBe(
      stringConstant(panelHost, 'PANEL_ID'),
    );
  });
});

describe('the page text the panel reads', () => {
  it('is cut to one length on both sides of the message', () => {
    // The content script cuts what it extracts, the panel cuts what it assembles for the agent. Two
    // different numbers mean the panel's own limit is the only one that ever applies, silently.
    expect(numberConstant(content, 'MAIN_CONTENT_MAX')).toBe(CONTENT_TEXT_MAX);
  });
});

describe('the dev mode`s fixtures', () => {
  const fixtures = evaluate<{ agentGenerate: Record<string, unknown> }>(
    'background/dev-fixtures.js',
    'EDU_SHARING_DEV_FIXTURES',
  );

  it('offers exactly the contents the worker holds, in the same order', () => {
    // The settings' select is the sidebar's list, the payload behind a pick is the worker's map. An
    // id in the select that the map has no entry under fakes a run that answers nothing; and both
    // sides call the *first* entry the default, so the order is part of the contract.
    expect(GENERATE_FIXTURES.map((fixture) => fixture.id)).toEqual(Object.keys(fixtures.agentGenerate));
  });

  it('holds a payload for each of them', () => {
    expect(GENERATE_FIXTURES.length).toBeGreaterThan(1);
    GENERATE_FIXTURES.forEach((fixture) =>
      expect(fixtures.agentGenerate[fixture.id], fixture.id).toBeTruthy(),
    );
  });
});

describe('the storage keys the two sides meet in', () => {
  const keys = Object.values(APP_CONFIG.storageKeys) as string[];

  /**
   * Keys that belong to the extension's side alone: the worker's record of which tabs have the panel
   * open, and the width the host page's script keeps. The panel never reads either, so neither has a
   * second side to agree with — they are named here so that any *other* key on that side has to.
   */
  const EXTENSION_ONLY = ['eduSharingOpenPanels', 'eduSharingPanelWidth'];

  /** The storage keys a plain-JS file names, stripped of a `:${…}` suffix a prefixed key carries. */
  function keysIn(source: string): string[] {
    return [
      ...new Set(
        stringLiterals(source)
          .filter((literal) => literal.startsWith('eduSharing'))
          .map((literal) => literal.split(/[:$]/)[0]),
      ),
    ];
  }

  it.each([
    ['background/background.js', background],
    ['content/panel-host.js', panelHost],
    ['content/content.js', content],
  ])('states no key in %s that the panel does not know', (_file, source) => {
    keysIn(source).forEach((key) =>
      expect([...keys, ...EXTENSION_ONLY], key).toContain(key),
    );
  });

  it('reads the dev mode and the resumed step under the keys the panel writes', () => {
    // The three the two sides really share: the panel writes them, the worker and the host script
    // read them.
    const shared = keysIn(background).concat(keysIn(panelHost)).filter((key) => keys.includes(key));
    expect(shared).toEqual(
      expect.arrayContaining([
        APP_CONFIG.storageKeys.devMode,
        APP_CONFIG.storageKeys.devModeGenerate,
        APP_CONFIG.storageKeys.resumeState,
        APP_CONFIG.storageKeys.theme,
      ]),
    );
  });
});

describe('the repository the two configs default to', () => {
  const workerConfig = evaluate<{
    repository: { defaultUrl: string };
    getApiUrl: () => string;
  }>('config.js', 'EDU_SHARING_CONFIG');

  it('is one repository, not two', () => {
    // The worker has its own copy of the config; a change in the panel's alone leaves a message that
    // names no base being answered against the previous repository.
    expect(workerConfig.repository.defaultUrl).toBe(APP_CONFIG.defaultRepositoryUrl);
  });

  it('derives the same metadata agent from it', () => {
    expect(workerConfig.getApiUrl()).toBe(METADATA_AGENT_API_URL);
  });
});
