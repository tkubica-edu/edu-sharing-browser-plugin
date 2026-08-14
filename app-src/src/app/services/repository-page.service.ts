import { Injectable, computed, inject } from '@angular/core';

import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { SessionResumeService } from './session-resume.service';

/** Where the repository keeps the pages the panel sends the user to, relative to its own base URL. */
const PATHS = {
  /** Sign-up. */
  register: '/components/register',
  /** Sign-up's "forgot my password" view, which mails a reset link. */
  passwordReset: '/components/register/request'
} as const;

/**
 * The repository's own pages, for what the panel does not do itself: registering an account and resetting a password.
 * They open in the tab the panel is docked in, which the panel does not survive, so the state is saved first and the
 * panel comes back where it left off — the arrangement ContentFlowService makes for the content's own pages.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryPageService {
  private readonly auth = inject(AuthService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly sessionResume = inject(SessionResumeService);

  /** The sign-up page of the configured repository. */
  readonly registerUrl = computed(() => this.urlOf(PATHS.register));

  /** The page that sends a password reset mail. */
  readonly passwordResetUrl = computed(() => this.urlOf(PATHS.passwordReset));

  /**
   * Take the tab to one of those pages. The panel is destroyed by the load and reopened by the
   * background worker; what it was doing is restored from storage, so it returns to the step the user
   * left — with the session they will have made there.
   */
  async open(url: string): Promise<void> {
    await this.sessionResume.save(url);
    try {
      await this.browserExtension.navigateTab(url);
    } catch (cause: unknown) {
      // The page stayed, so this app lives on: take the state tracking back up, which `save` switched
      // off for what it assumed was the last write of this panel.
      this.sessionResume.track();
      throw cause;
    }
  }

  private urlOf(path: string): string {
    return `${this.auth.repositoryUrl().replace(/\/+$/, '')}${path}`;
  }
}
