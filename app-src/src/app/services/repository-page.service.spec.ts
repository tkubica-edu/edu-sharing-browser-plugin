import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { RepositoryPageService } from './repository-page.service';
import { SessionResumeService } from './session-resume.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthFake,
  BrowserExtensionFake,
  SessionResumeFake,
  fakeAuth,
  fakeBrowserExtension,
  fakeSessionResume,
} from '../../testing/fakes';

describe('RepositoryPageService', () => {
  let pages: RepositoryPageService;
  let auth: AuthFake;
  let extension: BrowserExtensionFake;
  let sessionResume: SessionResumeFake;

  beforeEach(() => {
    auth = fakeAuth();
    extension = fakeBrowserExtension();
    sessionResume = fakeSessionResume();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(SessionResumeService, sessionResume.fake),
      ],
    });
    pages = TestBed.inject(RepositoryPageService);
  });

  describe('the pages it points at', () => {
    it('names the sign-up and the password reset of the configured repository', () => {
      expect(pages.registerUrl()).toBe('https://repo.example/edu-sharing/components/register');
      expect(pages.passwordResetUrl()).toBe(
        'https://repo.example/edu-sharing/components/register/request',
      );
    });

    it('joins the path without doubling a trailing slash', () => {
      auth.fake.repositoryUrl.set('https://repo.example/edu-sharing//');

      expect(pages.registerUrl()).toBe('https://repo.example/edu-sharing/components/register');
    });

    it('follows the repository the panel is configured against', () => {
      auth.fake.repositoryUrl.set('https://other.example/edu-sharing');

      expect(pages.registerUrl()).toBe('https://other.example/edu-sharing/components/register');
    });
  });

  describe('open', () => {
    it('saves what the panel was doing before the load destroys it', async () => {
      const order: string[] = [];
      sessionResume.fake.save.mockImplementation(() => {
        order.push('save');
        return Promise.resolve();
      });
      extension.fake.navigateTab.mockImplementation(() => {
        order.push('navigate');
        return Promise.resolve();
      });

      await pages.open(pages.registerUrl());

      expect(order).toEqual(['save', 'navigate']);
      expect(sessionResume.fake.save).toHaveBeenCalledWith(pages.registerUrl());
    });

    it('takes the state tracking back up when the page stays after all, and reports why', async () => {
      const cause = new Error('WORKER_UNREACHABLE');
      extension.fake.navigateTab.mockRejectedValue(cause);

      await expect(pages.open(pages.registerUrl())).rejects.toBe(cause);

      // The panel lives on, so what `save` switched off has to be switched back on.
      expect(sessionResume.fake.track).toHaveBeenCalled();
    });

    it('leaves the tracking off while the navigation is under way', async () => {
      await pages.open(pages.registerUrl());

      expect(sessionResume.fake.track).not.toHaveBeenCalled();
    });
  });
});
