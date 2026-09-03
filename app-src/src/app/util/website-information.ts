// What the repository's own reading of a web address contributes, and the one check that has to pass first.
//
// `getWebsiteInformation` is the lookup the repository's *Datei oder Link* dialog uses: the server fetches
// the address and answers with a title, a description, keywords and a licence. That is a genuine
// metadata extraction and it costs nothing extra, since the panel already makes the call to find out
// whether the page is in the repository already.
//
// The catch is that the server fetches it from where *it* stands: without the user's session, without
// cookies and without JavaScript. Behind a login, a paywall or a cookie wall it therefore describes the
// wall, not the page — plausibly and completely wrongly. So nothing from such an answer is used before it
// has been shown to describe the same page the browser is on.

import type { WebsiteInformation } from 'ngx-edu-sharing-api';

import { DerivedField } from './derived-metadata';
import { sharedTerms } from './german-terms';

/** How many words of the page's text an answer's description has to share to count as the same page. */
const SHARED_WITH_TEXT_MIN = 3;

/**
 * Whether the repository read the same page the browser has open. One word shared with the page's title is
 * enough — a title is short and its words are the subject; against the page's text, where any word may
 * occur by chance, several are required.
 *
 * An answer that states nothing cannot be checked and counts as not describing the page: there is nothing
 * to take from it anyway, and saying "no" keeps the caller from having to tell the two cases apart.
 */
export function describesSamePage(
  info: WebsiteInformation | null | undefined,
  pageTitle: string | null | undefined,
  pageText?: string | null,
): boolean {
  if (!info) return false;
  if (!info.title?.trim() && !info.description?.trim()) return false;
  if (sharedTerms(info.title, pageTitle).length >= 1) return true;
  if (sharedTerms(info.description, pageTitle).length >= 1) return true;
  return sharedTerms(info.description, pageText).length >= SHARED_WITH_TEXT_MIN;
}

/**
 * The answer as metadata fields. Only description and keywords: the page's own title is at least as good as
 * a server-side reading of it, and the licence is a label or an address that has to go through the licence
 * mapping before it means anything — the caller does that with the page's own licence statement.
 *
 * Stated rather than inferred: this is the repository reading the same page, not a guess about it.
 */
export function websiteInformationFields(
  info: WebsiteInformation | null | undefined,
): DerivedField[] {
  const fields: DerivedField[] = [];
  const description = info?.description?.replace(/\s+/g, ' ').trim();
  if (description) {
    fields.push({
      property: 'cclom:general_description',
      values: [description],
      source: 'website-info',
      standing: 'stated',
      evidence: 'Beschreibung, die das Repository beim Lesen der Adresse gefunden hat'
    });
  }
  const keywords = (info?.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);
  if (keywords.length) {
    fields.push({
      property: 'cclom:general_keyword',
      values: keywords,
      source: 'website-info',
      standing: 'stated',
      evidence: `${keywords.length} Schlagworte aus der Lesung der Adresse durch das Repository`
    });
  }
  return fields;
}
