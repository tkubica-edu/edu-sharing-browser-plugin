import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { About, AboutService } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { RepositoryVersionService } from './repository-version.service';
import { provideFake } from '../../testing/provide-fake';

/** `/_about` reduced to the one field this service reads, answered as the library hands it over. */
function fakeAbout(about: Observable<About>) {
  return { getAbout: () => about } satisfies Partial<AboutService>;
}

/** What `/_about` answers for a repository of `version`, with the rest of the payload left empty. */
function aboutWith(version: string | undefined): About {
  return { version: { major: 1, minor: 1, repository: version }, services: [] };
}

/** The service against an `/_about` that answers `about`, with the request already settled. */
async function loadedWith(about: Observable<About>): Promise<RepositoryVersionService> {
  TestBed.configureTestingModule({ providers: [provideFake(AboutService, fakeAbout(about))] });
  const service = TestBed.inject(RepositoryVersionService);
  await service.load();
  return service;
}

describe('RepositoryVersionService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('reports the version the repository names', async () => {
    const service = await loadedWith(of(aboutWith('11.0')));
    expect(service.version()).toBe('11.0');
    expect(service.major()).toBe(11);
    expect(service.supported()).toBe(true);
    expect(service.webComponentsRefused()).toBe(false);
    expect(service.checked()).toBe(true);
    expect(service.error()).toBeNull();
  });

  it('refuses the web components for another major version', async () => {
    const service = await loadedWith(of(aboutWith('10.3')));
    expect(service.major()).toBe(10);
    expect(service.supported()).toBe(false);
    expect(service.webComponentsRefused()).toBe(true);
  });

  it('leaves the web components to their own load where the repository could not be asked', async () => {
    const service = await loadedWith(throwError(() => new Error('offline')));
    expect(service.version()).toBeNull();
    expect(service.error()).toBe('offline');
    expect(service.checked()).toBe(true);
    expect(service.supported()).toBe(false);
    expect(service.webComponentsRefused()).toBe(false);
  });

  it('leaves them to it as well where the answer names no repository version', async () => {
    const service = await loadedWith(of(aboutWith(undefined)));
    expect(service.version()).toBeNull();
    expect(service.major()).toBeNull();
    expect(service.webComponentsRefused()).toBe(false);
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
