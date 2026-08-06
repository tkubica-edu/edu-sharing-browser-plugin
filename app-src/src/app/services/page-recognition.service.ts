import { Injectable, inject } from '@angular/core';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { nodeIdFromRepositoryUrl } from '../util/repository-links';
import { AuthService } from './auth.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';

/**
 * Recognises what the open page is about, so that content arrives on its own — the counterpart, for
 * every other page, of the OnlyOffice plugin announcing the document it has open.
 *
 * Two ways, in this order, because the page can *say* what it shows and only otherwise has to be
 * looked up:
 *
 * 1. **A repository page names its node in its own URL** — `…/components/render/<id>`, the `id` of
 *    the open collection or folder (see `nodeIdFromRepositoryUrl`). That is the page stating its
 *    content, so it is taken as it stands and only loaded; no lookup can improve on it. This is
 *    the same standing the OnlyOffice document has, arrived at from the URL rather than from a
 *    message.
 * 2. **Any other page is looked up by URL** — the same question the *Datei oder Link* dialog asks
 *    while a link is being typed: `getWebsiteInformation` answers, among the page's own metadata,
 *    with the nodes that already carry it (`duplicateNodes`, matched on `ccm:wwwurl`). A hit means
 *    the page has been erschlossen before, so there is nothing to curate — the existing content is
 *    what the panel should work on.
 *
 * Either way the finding surfaces as the *Inhalt erkannt* menu entry.
 *
 * Not on an insert host (the OnlyOffice editor, `…/eduservlet/connector`): there the plugin
 * announces the document it has open, a statement about the *editor* rather than about the page's
 * URL, and the accurate one — the editor's own URL says nothing about the content being edited.
 * And not by lookup on a repository page: its URL is the repository's own, so asking about it would
 * at best repeat what step 1 already read and at worst contradict it.
 */
@Injectable({ providedIn: 'root' })
export class PageRecognitionService {
  private readonly clientUtils = inject(ClientutilsV1Service);
  private readonly auth = inject(AuthService);
  private readonly conditions = inject(ConditionsService);
  private readonly curation = inject(CurationService);

  /**
   * Recognise the open page's content and adopt it. Answers whether one was found.
   *
   * Reports being under way through `ConditionsService.recognizingContent`, and clears it on every
   * way out — the *Inhalt erkannt* entry says "wird geprüft" until then and "kein Inhalt erkannt"
   * afterwards, so leaving it set would leave the panel checking forever.
   *
   * Silent on every failure: this is a bonus (a guest session may not be allowed to read the node or
   * to run the lookup, and an unreachable page is not an error either) — without it the user simply
   * gets the *Inhalt erschließen* offer they would have got anyway.
   */
  async recognize(): Promise<boolean> {
    // Without a session there is nothing to ask under — and the login runs this again (see
    // AppComponent), so the question stays open rather than being answered with "no content".
    if (!this.auth.authorized()) return false;
    // On an insert host the plugin speaks for the page (see the class comment): its answer is what
    // settles the recognition there, so this one leaves the state alone — see
    // AppComponent.askHostForItsDocument.
    if (this.conditions.onlyOfficePresent()) return false;
    // Nothing to recognise either when the panel already works on something — adopting would refuse
    // anyway, and the answer would be thrown away.
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
