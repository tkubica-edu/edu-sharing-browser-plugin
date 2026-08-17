import { Injectable, inject } from '@angular/core';

import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { PageRecognitionService } from './page-recognition.service';

const DISCARD_PROMPT =
  'Es gibt eine noch nicht gespeicherte Erschließung. Repository trotzdem wechseln und die aktuelle verwerfen?';

/**
 * Runs the checks the panel's state is built on again — the session, the repository config and what the open page is.
 * They are answered once on boot, so a configuration change made afterwards would otherwise leave every view showing
 * what was true for the old settings.
 */
@Injectable({ providedIn: 'root' })
export class ContextRefreshService {
  private readonly auth = inject(AuthService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly conditions = inject(ConditionsService);
  private readonly curation = inject(CurationService);
  private readonly pageRecognition = inject(PageRecognitionService);
  private readonly webComponent = inject(BrowserExtensionCustomWebComponentService);

  /**
   * Bring everything the settings can invalidate up to date. A changed repository is a reload: the API library freezes
   * its rootUrl at bootstrap, so nothing short of booting again asks the repository the user actually configured — and
   * a reload re-runs all of this anyway. Everything else is re-checked in place.
   */
  async refresh(): Promise<void> {
    if (this.auth.needsReload()) return this.applyRepositoryChange();
    // The page can have become another one while the settings were open (see AppComponent).
    const tab = await this.browserExtension.getActiveTab().catch(() => null);
    this.conditions.activeUrl.set(tab?.url ?? null);
    this.conditions.activeTitle.set(tab?.title ?? null);
    this.webComponent.refresh();
    await this.auth.revalidate();
    await this.pageRecognition.recognize();
  }

  /**
   * Reload for a changed repository, asking first where that would cost work: the unsaved Erschließung belongs to the
   * repository being left and cannot be carried over, so it is the user's to discard.
   */
  private applyRepositoryChange(): void {
    if (this.curation.hasUnsavedWork() && !confirm(DISCARD_PROMPT)) return;
    this.auth.applyRepositoryChange();
  }
}
