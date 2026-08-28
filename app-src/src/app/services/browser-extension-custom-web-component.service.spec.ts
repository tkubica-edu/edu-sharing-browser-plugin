import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ConfigService, DEFAULT, Variables } from 'ngx-edu-sharing-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

/** Class the service stamps on the document while the panel is a WLO one. */
const THEME_CLASS = 'wlo-theme';

/** The repository-config variable the service reads. */
const CONFIG_VARIABLE = 'browserExtensionCustomWebComponent';

/**
 * `ConfigService` reduced to the one thing this service reads: the stream of repository variables. `null`
 * is what the library emits before a config has been fetched, so the stream starts on it.
 */
function fakeConfig() {
  const variables = new BehaviorSubject<Variables | null>(null);
  const fake = {
    observeVariables: () => variables.asObservable(),
  } satisfies Partial<ConfigService>;
  return { fake, variables };
}

describe('BrowserExtensionCustomWebComponentService', () => {
  let browserExtension: BrowserExtensionFake;
  let config: ReturnType<typeof fakeConfig>;

  beforeEach(() => {
    browserExtension = fakeBrowserExtension();
    config = fakeConfig();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, browserExtension.fake),
        provideFake(ConfigService, config.fake as unknown as Partial<ConfigService>),
      ],
    });
  });

  afterEach(() => document.documentElement.classList.remove(THEME_CLASS));

  /** The service with the repository's answer already in it, as a booted panel has it. */
  function bootedWith(variable: unknown): BrowserExtensionCustomWebComponentService {
    const service = TestBed.inject(BrowserExtensionCustomWebComponentService);
    service.initialize();
    config.variables.next({ [CONFIG_VARIABLE]: variable } as unknown as Variables);
    return service;
  }

  it('follows the repository config while the setting stands at its default', () => {
    const service = bootedWith(true);
    expect(service.enabled()).toBe(true);
    expect(service.offeredByRepository()).toBe(true);
    expect(service.metadataSet()).toBe(APP_CONFIG.metadataSet);
  });

  it('reads the raw string "true" as the flag, since the config types every value as string', () => {
    expect(bootedWith('true').enabled()).toBe(true);
    expect(bootedWith('false').enabled()).toBe(false);
  });

  it('leaves the flag alone while there is no config yet', () => {
    const service = TestBed.inject(BrowserExtensionCustomWebComponentService);
    service.initialize();
    config.variables.next(null);
    expect(service.enabled()).toBe(false);
  });

  it('reads the repository variable as unset while the setting is off', async () => {
    const service = bootedWith(true);
    await service.setEnabled(false);

    expect(service.enabled()).toBe(false);
    // What the repository answered is kept apart from what the panel makes of it: the settings' checkbox
    // shows the switch, and the hint beside it shows the repository.
    expect(service.offeredByRepository()).toBe(true);
    expect(service.settingEnabled()).toBe(false);
    expect(service.metadataSet()).toBe(DEFAULT);
  });

  it('stays off where the setting is on but the repository offers nothing', () => {
    const service = bootedWith(false);
    expect(service.settingEnabled()).toBe(true);
    expect(service.enabled()).toBe(false);
  });

  it('takes the palette off the document with the setting', async () => {
    const service = bootedWith(true);
    TestBed.tick();
    expect(document.documentElement.classList.contains(THEME_CLASS)).toBe(true);

    await service.setEnabled(false);
    TestBed.tick();
    expect(document.documentElement.classList.contains(THEME_CLASS)).toBe(false);
  });

  it('persists the switch and takes it back over on the next boot', async () => {
    await TestBed.inject(BrowserExtensionCustomWebComponentService).setEnabled(false);
    expect(browserExtension.storage.get(APP_CONFIG.storageKeys.wloEnabled)).toBe(false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, browserExtension.fake),
        provideFake(ConfigService, config.fake as unknown as Partial<ConfigService>),
      ],
    });
    const next = TestBed.inject(BrowserExtensionCustomWebComponentService);
    await next.load();
    expect(next.settingEnabled()).toBe(false);
  });

  it('counts as changed only where it stands away from the default', async () => {
    const service = TestBed.inject(BrowserExtensionCustomWebComponentService);
    expect(service.changedSettings()).toBe(0);
    await service.setEnabled(false);
    expect(service.changedSettings()).toBe(1);
  });
});
