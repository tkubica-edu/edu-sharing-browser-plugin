import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthFake,
  BrowserExtensionFake,
  CurationFake,
  PageRecognitionFake,
  WebComponentFake,
  fakeAuth,
  fakeBrowserExtension,
  fakeCuration,
  fakePageRecognition,
  fakeWebComponent,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { ContextRefreshService } from './context-refresh.service';
import { CurationService } from './curation.service';
import { PageRecognitionService } from './page-recognition.service';

describe('ContextRefreshService', () => {
  let refresh: ContextRefreshService;
  let auth: AuthFake;
  let extension: BrowserExtensionFake;
  let curation: CurationFake;
  let recognition: PageRecognitionFake;
  let webComponent: WebComponentFake;
  let conditions: ConditionsService;

  beforeEach(() => {
    auth = fakeAuth();
    extension = fakeBrowserExtension();
    curation = fakeCuration();
    recognition = fakePageRecognition();
    webComponent = fakeWebComponent();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(CurationService, curation.fake),
        provideFake(PageRecognitionService, recognition.fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
      ],
    });
    refresh = TestBed.inject(ContextRefreshService);
    conditions = TestBed.inject(ConditionsService);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('with the repository unchanged', () => {
    it('takes over the page the browser is on now', async () => {
      extension.showing({ url: 'https://example.org/optik', title: 'Optik' });

      await refresh.refresh();

      expect(conditions.activeUrl()).toBe('https://example.org/optik');
      expect(conditions.activeTitle()).toBe('Optik');
    });

    it('reads a tab that cannot be asked about as no page', async () => {
      conditions.activeUrl.set('https://example.org/vorher');
      extension.fake.getActiveTab.mockRejectedValueOnce(new Error('no tab'));

      await refresh.refresh();

      expect(conditions.activeUrl()).toBeNull();
      expect(conditions.activeTitle()).toBeNull();
    });

    it('re-checks everything the settings can invalidate', async () => {
      await refresh.refresh();

      expect(webComponent.fake.refresh).toHaveBeenCalled();
      expect(auth.fake.revalidate).toHaveBeenCalled();
      expect(recognition.fake.recognize).toHaveBeenCalled();
    });

    it('re-checks the session before it asks what this page is', async () => {
      await refresh.refresh();

      expect(auth.fake.revalidate.mock.invocationCallOrder[0]).toBeLessThan(
        recognition.fake.recognize.mock.invocationCallOrder[0],
      );
    });

    it('never reloads for a repository that did not change', async () => {
      await refresh.refresh();

      expect(auth.fake.applyRepositoryChange).not.toHaveBeenCalled();
    });
  });

  describe('with the repository changed', () => {
    beforeEach(() => auth.fake.needsReload.set(true));

    it('reloads, since the API library freezes its root URL at bootstrap', async () => {
      await refresh.refresh();

      expect(auth.fake.applyRepositoryChange).toHaveBeenCalled();
      expect(recognition.fake.recognize).not.toHaveBeenCalled();
    });

    it('reloads without asking where nothing is at stake', async () => {
      const asked = vi.fn(() => true);
      vi.stubGlobal('confirm', asked);

      await refresh.refresh();

      expect(asked).not.toHaveBeenCalled();
      expect(auth.fake.applyRepositoryChange).toHaveBeenCalled();
    });

    it('asks first where an unsaved Erschließung would be lost with it', async () => {
      curation.fake.hasUnsavedWork.set(true);
      const asked = vi.fn(() => true);
      vi.stubGlobal('confirm', asked);

      await refresh.refresh();

      expect(asked).toHaveBeenCalledWith(expect.stringContaining('Erschließung'));
      expect(auth.fake.applyRepositoryChange).toHaveBeenCalled();
    });

    it('stays where it is when the user will not discard that work', async () => {
      curation.fake.hasUnsavedWork.set(true);
      vi.stubGlobal('confirm', vi.fn(() => false));

      await refresh.refresh();

      expect(auth.fake.applyRepositoryChange).not.toHaveBeenCalled();
    });
  });
});
