import { Injectable, inject } from '@angular/core';
import { ClientutilsV1Service, WebsiteInformation } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

/** Log prefix for what the repository reads off a web address. */
const LOG = '[edu-sharing][website-info]';

/**
 * The repository's own reading of a web address (`getWebsiteInformation`, the lookup the *Datei oder Link*
 * dialog uses): which nodes already carry the address, and what the server made of the page — its title, a
 * description, keywords, a licence.
 *
 * One place for it because two callers want the same answer for the same address: the recognition, which
 * reads `duplicateNodes` to find out whether the page is in the repository already, and the metadata
 * derivation, which reads the rest of it. Answered from a session cache, so the second caller costs nothing
 * (see {@link read}).
 *
 * Best-effort like everything foreign in this panel: a repository that cannot answer leaves `null`, and both
 * callers have their own way on from there.
 */
@Injectable({ providedIn: 'root' })
export class WebsiteInformationService {
  private readonly clientUtils = inject(ClientutilsV1Service);

  /**
   * What the repository answered per address, for this session. Held as the promise rather than the answer,
   * so two callers asking at once make one request instead of two — which is the normal case here, the
   * recognition and the Erschließung starting on the same page.
   */
  private readonly answers = new Map<string, Promise<WebsiteInformation | null>>();

  /**
   * The repository's reading of the address; `null` where it will not answer. The same address is asked
   * about once per session: what the server reads off a page does not change while the panel is open, and
   * the recognition asks about every page the browser visits.
   */
  read(url: string): Promise<WebsiteInformation | null> {
    const held = this.answers.get(url);
    if (held) return held;
    const asked = this.ask(url);
    this.answers.set(url, asked);
    return asked;
  }

  /** What was already read for the address, without asking — for a caller that must not cost a request. */
  held(url: string): Promise<WebsiteInformation | null> | null {
    return this.answers.get(url) ?? null;
  }

  /** Forget what was read for an address, so the next read asks again. */
  invalidate(url?: string): void {
    if (url) this.answers.delete(url);
    else this.answers.clear();
  }

  private async ask(url: string): Promise<WebsiteInformation | null> {
    try {
      const info = await firstValueFrom(this.clientUtils.getWebsiteInformation({ url }));
      console.log(`${LOG} ← ${url}`, {
        title: info?.title,
        description: info?.description?.slice(0, 120),
        keywords: info?.keywords,
        license: info?.license,
        duplicateNodes: info?.duplicateNodes?.length ?? 0
      });
      return info ?? null;
    } catch (cause: unknown) {
      console.warn(`${LOG} the repository could not read ${url}:`, cause);
      return null;
    }
  }
}
