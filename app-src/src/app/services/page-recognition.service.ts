import { Injectable, inject, signal } from '@angular/core';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';

/**
 * Recognises the open page as a content the repository already holds — the second way (next to the
 * OnlyOffice plugin's `DOCUMENT_INFO`) for a node to arrive on its own.
 *
 * It asks the repository the same question the *Datei oder Link* dialog asks while a link is being
 * typed: `getWebsiteInformation` looks the URL up and answers, among the page's own metadata, with
 * the nodes that already carry it (`duplicateNodes`, matched on `ccm:wwwurl`). A hit means the page
 * has been erschlossen before, so there is nothing to curate — the existing content is what the
 * panel should work on, and it surfaces as the *Inhalt erkannt* menu entry.
 *
 * Only where nothing else already speaks for the page, and it ranks LAST behind those:
 *
 * - an insert host (the OnlyOffice editor, `…/eduservlet/connector`): the plugin announces the
 *   document it has open, a statement about the *editor* rather than about the page's URL, and it
 *   is the accurate one — the editor's own URL says nothing about the content being edited;
 * - a repository page: it announces its node itself (`PREVIEW_NODE`).
 *
 * On both, asking `getWebsiteInformation` about the URL would at best repeat that answer and at
 * worst contradict it, so it is not asked at all.
 */
@Injectable({ providedIn: 'root' })
export class PageRecognitionService {
  private readonly clientUtils = inject(ClientutilsV1Service);
  private readonly auth = inject(AuthService);
  private readonly conditions = inject(ConditionsService);
  private readonly curation = inject(CurationService);

  /** True while the lookup is in flight, so the shell can say the page is still being checked. */
  readonly checking = signal(false);

  /**
   * Look the active page up and adopt the first content that already carries its URL. Answers
   * whether one was found.
   *
   * Silent on every failure: the lookup is a bonus (a guest session may not be allowed to run it,
   * and an unreachable page is not an error either) — without it the user simply gets the
   * *Inhalt erschließen* offer they would have got anyway.
   */
  async recognize(): Promise<boolean> {
    const url = httpUrl(this.conditions.activeUrl());
    // No lookup where something else speaks for the page (see the class comment), without a
    // session to run it under, or when the panel already works on something — adopting would
    // refuse anyway, and the answer would be thrown away.
    if (
      !url ||
      this.conditions.onlyOfficePresent() ||
      this.conditions.onEduSharing() ||
      !this.auth.authorized() ||
      this.curation.activeNode() ||
      this.curation.hasUnsavedWork()
    ) {
      return false;
    }
    this.checking.set(true);
    try {
      const information = await firstValueFrom(this.clientUtils.getWebsiteInformation({ url }));
      // The first one: the repository answers with every node carrying this URL, and they are
      // versions of the same finding — "this page is already in here".
      const existing = information?.duplicateNodes?.[0];
      if (!existing) return false;
      this.curation.adoptDetectedNode(existing);
      return true;
    } catch {
      return false;
    } finally {
      this.checking.set(false);
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
