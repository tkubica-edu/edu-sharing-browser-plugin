// What the open page states about itself: its title and its picture, read off the page rather than generated
// from it. They are facts of the page, not proposals about it, so a flow that takes them over states them as
// values — see CurationService.analyze.

import type { PageData, PageImages } from '../services/browser-extension.service';
import { SOURCE_TEXT_KEY } from './agent-payload';

/** The page's own statements about itself, as far as a content is described by them. */
export interface PageFacts {
  url: string;
  /** What the page calls itself — its `<title>`, which is also the tab's. */
  title: string | null;
  /** The picture the page shows for itself; null for a page that names none — see {@link firstPageImage}. */
  imageUrl: string | null;
  /** The page's text, as prepared as the content script could make it. */
  text: string;
}

/**
 * The picture a page names for itself, in the order the extraction reads them (`pageImageUrls` in
 * `background.js`): the picture declared for sharing, the largest one inside the content, then the
 * card picture. The site icon is left out — it stands for the site rather than for this page.
 */
export function firstPageImage(images: PageImages | null | undefined): string | null {
  const stated = images?.ogImage?.url ?? images?.heroImage?.url ?? images?.twitterImage?.url;
  return stated?.trim() || null;
}

/**
 * What the page says about itself, or null for a page that could not be read at all. The text is the most
 * prepared of the three the content script offers — the same one the metadata agent is given (see
 * `background.js`), so both describe the page from the same wording.
 */
export function pageFactsOf(data: PageData | null | undefined): PageFacts | null {
  if (!data) return null;
  return {
    url: data.url,
    title: data.title?.trim() || null,
    imageUrl: firstPageImage(data.images),
    text: (data.formattedText || data.mainContent || data.text || '').trim()
  };
}

/**
 * The page's own statements as the flow's metadata payload — what an Erschließung outside the WLO context
 * produces instead of a `/generate` answer. Three fields and no `_origins`: nothing here is generated, so
 * nothing is marked as a machine's proposal, and the fields the page does not answer are left to the
 * repository's own generation (see MdsAiSuggestionService).
 */
export function pageMetadata(facts: PageFacts): Record<string, unknown> {
  return {
    ...(facts.title ? { 'cclom:title': facts.title } : {}),
    ...(facts.imageUrl ? { preview_image_url: facts.imageUrl } : {}),
    ...(facts.text ? { [SOURCE_TEXT_KEY]: facts.text } : {})
  };
}
