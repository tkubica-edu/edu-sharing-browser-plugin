import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { About, AboutService } from 'ngx-edu-sharing-api';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepositoryVersionService } from './repository-version.service';
import { provideFake } from '../../testing/provide-fake';
import { resetExtensionApi, useExtensionApi } from '../../testing/extension-globals.setup';

/** `/_about` reduced to the one field this service reads, answered as the library hands it over. */
function fakeAbout(about: Observable<About>) {
  return { getAbout: () => about } satisfies Partial<AboutService>;
}

/** What `/_about` answers for a repository of `version`, with the rest of the payload left empty. */
function aboutWith(version: string | undefined): About {
  return { version: { major: 1, minor: 1, repository: version }, services: [] };
}

/** A `fetch` answering `edu/versions.json` with `versions`, the shape the build writes it in. */
function fetchAnsweringVersions(versions: string[]): Mock {
  return vi.fn(async () => new Response(JSON.stringify(versions), { status: 200 }));
}

/** A `fetch` failing the request for `edu/versions.json`, as an incomplete package would. */
function fetchWithNoVersions(): Mock {
  return vi.fn(async () => new Response('', { status: 404 }));
}

/**
 * The service against an `/_about` that answers `about` and a package whose `edu/versions.json`
 * answers `packaged`, with the request already settled.
 */
async function loadedWith(
  about: Observable<About>,
  packaged: string[] = ['11.0'],
): Promise<RepositoryVersionService> {
  TestBed.configureTestingModule({ providers: [provideFake(AboutService, fakeAbout(about))] });
  vi.stubGlobal('fetch', fetchAnsweringVersions(packaged));
  const service = TestBed.inject(RepositoryVersionService);
  await service.load();
  return service;
}

describe('RepositoryVersionService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // `packageUrl()` reads `browser.runtime.getURL`; the passthrough below leaves the path
    // untouched, so the fetch mocks above can answer on the plain `edu/versions.json` path.
    useExtensionApi({ runtime: { getURL: (path: string) => path } });
  });

  afterEach(() => resetExtensionApi());

  it('reports the version the repository names and the bundle folder built for it', async () => {
    const service = await loadedWith(of(aboutWith('11.0')));
    expect(service.version()).toBe('11.0');
    expect(service.major()).toBe(11);
    expect(service.supported()).toBe(true);
    expect(service.webComponentsRefused()).toBe(false);
    expect(service.checked()).toBe(true);
    expect(service.error()).toBeNull();
    expect(service.packagedVersions()).toEqual(['11.0']);
    expect(service.bundleVersion()).toBe('11.0');
    expect(service.bundleVersionExact()).toBe(true);
  });

  it('ignores the patch component when matching a packaged folder', async () => {
    const service = await loadedWith(of(aboutWith('11.0.7')));
    expect(service.bundleVersion()).toBe('11.0');
    expect(service.bundleVersionExact()).toBe(true);
  });

  it('falls back to the closest packaged minor of the same major, and says so', async () => {
    const service = await loadedWith(of(aboutWith('11.3')), ['11.0', '12.0']);
    expect(service.supported()).toBe(true);
    expect(service.webComponentsRefused()).toBe(false);
    expect(service.bundleVersion()).toBe('11.0');
    expect(service.bundleVersionExact()).toBe(false);
  });

  it('refuses the web components for another major version', async () => {
    const service = await loadedWith(of(aboutWith('10.3')));
    expect(service.major()).toBe(10);
    expect(service.supported()).toBe(false);
    expect(service.webComponentsRefused()).toBe(true);
    expect(service.bundleVersion()).toBeNull();
  });

  it('names every packaged version for the settings notice', async () => {
    const service = await loadedWith(of(aboutWith('10.3')), ['11.0', '12.0']);
    expect(service.packagedVersionsText()).toBe('11.0, 12.0');
  });

  it('leaves the web components to their own load where the repository could not be asked', async () => {
    const service = await loadedWith(throwError(() => new Error('offline')));
    expect(service.version()).toBeNull();
    expect(service.error()).toBe('offline');
    expect(service.checked()).toBe(true);
    expect(service.supported()).toBe(false);
    expect(service.webComponentsRefused()).toBe(false);
    // No version was named, so the newest packaged bundle is picked rather than none at all.
    expect(service.bundleVersion()).toBe('11.0');
  });

  it('leaves them to it as well where the answer names no repository version', async () => {
    const service = await loadedWith(of(aboutWith(undefined)));
    expect(service.version()).toBeNull();
    expect(service.major()).toBeNull();
    expect(service.webComponentsRefused()).toBe(false);
    expect(service.bundleVersion()).toBe('11.0');
  });

  it('carries no bundle folder where the package names none at all', async () => {
    TestBed.configureTestingModule({
      providers: [provideFake(AboutService, fakeAbout(of(aboutWith('11.0'))))],
    });
    vi.stubGlobal('fetch', fetchWithNoVersions());
    const service = TestBed.inject(RepositoryVersionService);
    await service.load();

    expect(service.packagedVersions()).toEqual([]);
    expect(service.bundleVersion()).toBeNull();
    // Not a refusal by version — the repository named one, the package simply carries no folder.
    expect(service.webComponentsRefused()).toBe(true);
  });

  it('asks the repository once, however many callers wait for the answer', async () => {
    let asked = 0;
    const about = new Observable<About>((subscriber) => {
      asked += 1;
      subscriber.next(aboutWith('11.0'));
      subscriber.complete();
    });
    const service = await loadedWith(about);
    await service.load();
    expect(asked).toBe(1);
  });
});
