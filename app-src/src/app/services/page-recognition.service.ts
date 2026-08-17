import { Injectable, inject } from '@angular/core';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { nodeIdFromRepositoryUrl } from '../util/repository-links';
import { AuthService } from './auth.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';

/**
 * Recognises what the open page is about, so content arrives on its own — the counterpart, for every other page, of
 * the plugin announcing its document. A repository page names its node in its own URL; every other page is looked up
 * by URL, where a hit means it has been erschlossen before. Not on an insert host, where the plugin speaks.
 */
@Injectable({ providedIn: 'root' })
export class PageRecognitionService {
  private readonly clientUtils = inject(ClientutilsV1Service);
  private readonly auth = inject(AuthService);
  private readonly conditions = inject(ConditionsService);
  private readonly curation = inject(CurationService);

  /** The last recognition's answer no longer describes the open page, so it has to be asked again. */
  private stale = false;

  /** Mark the recognition as outdated: what the repository holds for the open page has changed. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * Recognise again where something has invalidated the last answer ({@link invalidate}), and only then — the lookup
   * costs a request, and every other way onto a page already triggers one of its own.
   */
  async recognizeIfStale(): Promise<boolean> {
    if (!this.stale) return false;
    this.stale = false;
    return await this.recognize();
  }

  /**
   * Recognise the open page's content and adopt it; answers whether one was found. Reports being under way through
   * `ConditionsService.recognizingContent` and clears it on every way out, since a flag left set would leave the panel
   * checking forever. Silent on every failure — without it the user simply gets the *Inhalt erschließen* offer.
   */
  async recognize(): Promise<boolean> {
    // Nothing to ask under, and the login runs this again (AppComponent) — so the question stays open
    // rather than being answered with "no content".
    if (!this.auth.authorized()) return false;
    // On an insert host the plugin speaks for the page (see the class comment) and its answer settles
    // the recognition — see AppComponent.askHostForItsDocument.
    if (this.conditions.onlyOfficePresent()) return false;
    // Nothing to recognise while the panel already works on something: adopting would refuse anyway.
    if (this.curation.activeNode() || this.curation.hasUnsavedWork()) {
      this.conditions.recognizingContent.set(false);
      return false;
    }
    const url = this.conditions.activeUrl();
    this.conditions.recognizingContent.set(true);
    try {
      // What the page itself says it shows, first and in place of any lookup.
      const named = nodeIdFromRepositoryUrl(url);
      if (named) return await this.curation.adoptDetectedNodeId(named);
      // A repository page that names no node (a search, the workspace root) shows no single content,
      // and its URL is the repository's own — there is nothing to look up.
      if (this.conditions.onEduSharing()) return false;
      const lookupUrl = httpUrl(url);
      if (!lookupUrl) return false;
      const information = await firstValueFrom(
        this.clientUtils.getWebsiteInformation({ url: lookupUrl }),
      );
      // The first one: the repository answers with every node carrying this URL, and they are
      // versions of the same finding — "this page is already in here".
      const existing = information?.duplicateNodes?.[0];
      if (!existing) return false;
      this.curation.adoptDetectedNode(existing);
      return true;
    } catch {
      return false;
    } finally {
      this.conditions.recognizingContent.set(false);
    }
  }
}

/** The URL if it is one the repository can be asked about, else null — `about:`, `chrome:`, … are not. */
function httpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
