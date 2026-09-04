import { Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureBundleEditorWindow, installBundleWindowRedirect, repositoryWindowUrl } from './bundle-windows';

const REPO = 'https://repo.example.org/edu-sharing';

/** The extension's own document, which is what the bundle resolves its window URLs against. */
const PANEL_BASE = 'chrome-extension://abcdefghijklmnop/sidebar/index.html';

/** The address the bundle would open a search at, as it composes it from the panel's base. */
const PANEL_SEARCH = 'chrome-extension://abcdefghijklmnop/components/search?query=optik';

beforeAll(() => {
  const base = document.createElement('base');
  base.setAttribute('href', PANEL_BASE);
  document.head.appendChild(base);
});

describe('repositoryWindowUrl', () => {
  it('carries a route the bundle composed against the extension over to the repository', () => {
    expect(repositoryWindowUrl(PANEL_SEARCH, REPO)).toBe(`${REPO}/components/search?query=optik`);
  });

  it('keeps the fragment, which is part of where the bundle meant to send the tab', () => {
    expect(repositoryWindowUrl(`${PANEL_SEARCH}#treffer`, REPO)).toBe(
      `${REPO}/components/search?query=optik#treffer`,
    );
  });

  it('asks for guest access where a node is picked to be handed back', () => {
    const url = repositoryWindowUrl(
      'chrome-extension://abcdefghijklmnop/components/search?reurl=self',
      REPO,
    );
    expect(url).toBe(`${REPO}/components/search?reurl=self&allowGuest=true`);
  });

  it('asks for no guest access where nothing is handed back', () => {
    expect(repositoryWindowUrl(PANEL_SEARCH, REPO)).not.toContain('allowGuest');
  });

  it('sends a window with no recognizable route to the repository itself', () => {
    expect(repositoryWindowUrl('', REPO)).toBe(`${REPO}/`);
    expect(repositoryWindowUrl('chrome-extension://abcdefghijklmnop/sidebar/index.html', REPO)).toBe(
      `${REPO}/`,
    );
  });

  it('takes a repository address however many slashes it ends in', () => {
    expect(repositoryWindowUrl(PANEL_SEARCH, `${REPO}///`)).toBe(`${REPO}/components/search?query=optik`);
  });

  it('leaves a real web URL alone — a permalink or the connector link itself', () => {
    expect(repositoryWindowUrl('https://example.org/optik', REPO)).toBeNull();
    expect(repositoryWindowUrl('http://example.org/optik', REPO)).toBeNull();
  });

  it('carries a route the bundle wrote relative to the panel\'s own document over as well', () => {
    expect(repositoryWindowUrl('/components/search', REPO)).toBe(`${REPO}/components/search`);
  });

  it('rewrites nothing while no repository is configured', () => {
    expect(repositoryWindowUrl(PANEL_SEARCH, '')).toBeNull();
    expect(repositoryWindowUrl(PANEL_SEARCH, '///')).toBeNull();
  });

  it('rewrites nothing it cannot read as an address', () => {
    expect(repositoryWindowUrl('http://%%', REPO)).toBeNull();
  });
});

describe('installBundleWindowRedirect', () => {
  /** Stands in for the browser's own `window.open`, so what the patch calls through with is visible. */
  let nativeOpen: Mock;
  let repository = REPO;

  beforeAll(() => {
    nativeOpen = vi.fn(() => null);
    window.open = nativeOpen as unknown as typeof window.open;
    installBundleWindowRedirect(() => repository);
  });

  beforeEach(() => {
    repository = REPO;
    nativeOpen.mockClear();
  });

  it('sends a window the bundle opens on one of its own routes to the repository', () => {
    window.open(PANEL_SEARCH, '_blank');
    expect(nativeOpen).toHaveBeenCalledWith(`${REPO}/components/search?query=optik`, '_blank', undefined);
  });

  it('takes a URL object as readily as a string', () => {
    window.open(new URL(PANEL_SEARCH));
    expect(nativeOpen).toHaveBeenCalledWith(`${REPO}/components/search?query=optik`, undefined, undefined);
  });

  it('passes the bundle\'s own target and features on unchanged, so the caller keeps its handle', () => {
    window.open(PANEL_SEARCH, 'editor', 'width=800');
    expect(nativeOpen).toHaveBeenCalledWith(expect.any(String), 'editor', 'width=800');
  });

  it('passes a real web URL through untouched, as the caller wrote it', () => {
    const permalink = 'https://example.org/optik';
    window.open(permalink, '_blank');
    expect(nativeOpen).toHaveBeenCalledWith(permalink, '_blank', undefined);
  });

  it('follows the repository the panel is configured for, which a later install only refreshes', () => {
    installBundleWindowRedirect(() => 'https://andere.example.org/edu-sharing');
    window.open(PANEL_SEARCH);
    expect(nativeOpen).toHaveBeenCalledWith(
      'https://andere.example.org/edu-sharing/components/search?query=optik',
      undefined,
      undefined,
    );
    installBundleWindowRedirect(() => repository);
  });
});

describe('captureBundleEditorWindow', () => {
  let opened: string[];
  let release: () => void;

  beforeEach(() => {
    opened = [];
    release = captureBundleEditorWindow(() => REPO, (url) => opened.push(url));
  });

  afterEach(() => release());

  it('answers the bundle with a stub instead of opening a window the panel cannot follow', () => {
    const handle = window.open(PANEL_SEARCH, '_blank');
    expect(handle).not.toBeNull();
    expect(handle?.closed).toBe(false);
  });

  it('takes this tab where the bundle sends the window it believes it opened', () => {
    const handle = window.open('', '_blank');
    handle!.location.href = 'chrome-extension://abcdefghijklmnop/components/render/optik-node';
    expect(opened).toEqual([`${REPO}/components/render/optik-node`]);
  });

  it('takes this tab to a real web URL the bundle assigns, as the address it will really have', () => {
    const handle = window.open('', '_blank');
    handle!.location.href = 'https://example.org/optik';
    expect(opened).toEqual(['https://example.org/optik']);
  });

  it('carries what the bundle does with the handle: reading the address back, and closing it', () => {
    const handle = window.open('', '_blank');
    expect(handle!.location.href).toBe('');
    expect(() => handle!.close()).not.toThrow();
  });

  it('hands the windows back once the screen holding them is gone', () => {
    release();
    const handle = window.open(PANEL_SEARCH, '_blank');
    expect(handle).toBeNull();
    release = () => undefined;
  });

  it('leaves a later claim in force where an earlier one is released', () => {
    const later: string[] = [];
    const releaseLater = captureBundleEditorWindow(() => REPO, (url) => later.push(url));
    release();

    window.open('', '_blank')!.location.href = 'https://example.org/optik';

    expect(later).toEqual(['https://example.org/optik']);
    expect(opened).toEqual([]);
    releaseLater();
    release = () => undefined;
  });
});
