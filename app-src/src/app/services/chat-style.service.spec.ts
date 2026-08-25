import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { ChatStyleService } from './chat-style.service';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

describe('ChatStyleService', () => {
  let style: ChatStyleService;
  let extension: BrowserExtensionFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    style = TestBed.inject(ChatStyleService);
  });

  const key = APP_CONFIG.storageKeys.chatStyleOverrides;

  it('corrects the widget unless it was switched off', () => {
    // The panel's steps are written for the corrected widget, so they are what an install gets.
    expect(style.overridesEnabled()).toBe(true);
    expect(style.changedSettings()).toBe(0);
  });

  describe('load', () => {
    it('takes over a switch that was turned off', async () => {
      extension.storage.set(key, false);

      await style.load();

      expect(style.overridesEnabled()).toBe(false);
    });

    it('stays on where nothing was stored', async () => {
      await style.load();

      expect(style.overridesEnabled()).toBe(true);
    });
  });

  describe('what the settings count', () => {
    it('counts nothing for the state the panel ships with', () => {
      expect(style.changedSettings()).toBe(0);
    });

    it('counts the switch once the widget is seen as it ships', async () => {
      await style.setOverridesEnabled(false);

      expect(style.changedSettings()).toBe(1);
    });
  });

  describe('persistence', () => {
    it('writes the switch through, so it survives a reload', async () => {
      await style.setOverridesEnabled(false);

      expect(style.overridesEnabled()).toBe(false);
      expect(extension.storage.get(key)).toBe(false);
    });

    it('writes the checked-in state back just as explicitly', async () => {
      await style.setOverridesEnabled(false);

      await style.resetToDefault();

      expect(style.overridesEnabled()).toBe(true);
      expect(extension.storage.get(key)).toBe(true);
    });
  });
});
