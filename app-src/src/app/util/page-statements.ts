// What the open page states about itself, read out of the extraction into one flat record.
//
// The content script (`content/content.js`) reads far more than the three facts a page's title, picture and
// text amount to: the meta tags, Open Graph, Dublin Core, LRMI, the JSON-LD blocks, a licence link, the
// page's own tags and breadcrumbs. All of it already crosses the wire; this module is where it becomes
// statements the panel can put into metadata fields without anything having generated them.
//
// Every statement carries the place it was read from. That is what lets the composer decide per field
// whether it enters the form as a value or as a proposal (see util/derived-metadata.ts), and what makes the
// log line say *why* a field holds what it holds — without reading the page a second time.

import type { PageData } from '../services/browser-extension.service';
import { StatedLicense, ccLicenseOf, ccLicenseOfUrl } from './page-license';
import { firstPageImage } from './page-facts';
import { SchemaClaims, primaryEntity, schemaClaimsOf, schemaEntitiesOf } from './schema-org';
import { normalizeLabel } from './german-terms';
import { toDurationMs, toIsoDate } from './dates';

/** Where a statement was read. Ordered from the page's own machine-readable declarations to its prose. */
export type StatementSource =
  | 'meta' | 'og' | 'twitter' | 'dc' | 'lrmi' | 'jsonld' | 'license' | 'semantic' | 'nav' | 'url' | 'text';

/** One statement of the page, with the place it was read from. */
export interface Stated<T> {
  value: T;
  source: StatementSource;
}

/** A keyword the page states, with the place it names it. */
export type StatedKeyword = Stated<string>;

/** The page's own statements about itself, as far as they are metadata about a content. */
export interface PageStatements {
  url: string;
  canonicalUrl: string | null;
  host: string | null;
  siteName: string | null;
  title: Stated<string> | null;
  description: Stated<string> | null;
  /** One entry per keyword; the same word from two places appears once, under the first of them. */
  keywords: StatedKeyword[];
  language: Stated<string> | null;
  author: Stated<string> | null;
  publisher: Stated<string> | null;
  published: Stated<string> | null;
  license: StatedLicense | null;
  identifier: Stated<string> | null;
  learningTimeMs: Stated<number> | null;
  imageUrl: string | null;
  /** The page's readable text — what a derivation reads, never the formatted metadata dump. */
  contentText: string;
  /** The page's headings, outermost first; empty where the extraction reported none. */
  headings: string[];
  /**
   * Free labels for the vocabulary-bound properties, to be resolved against a metadata set's valuespace
   * (see util/vocabulary-match.ts). Never written to a node as they are — a label is not a value.
   */
  terms: PageTerms;
}

/** The page's own words for the things a metadata set holds a vocabulary for. */
export interface PageTerms {
  learningResourceType: string[];
  educationalContext: string[];
  intendedEndUserRole: string[];
  discipline: string[];
}

/** How long a description may be; beyond this it is an article, not a description of one. */
const DESCRIPTION_MAX = 2000;

/** A keyword longer than this, or of more words than {@link KEYWORD_WORDS_MAX}, is a sentence. */
const KEYWORD_LENGTH_MAX = 60;
const KEYWORD_WORDS_MAX = 4;

/** How many keywords are taken over at most — a page tagging itself with forty says nothing with them. */
const KEYWORDS_MAX = 12;

/** Navigational words a site tags every page with; they classify the site, not the content. */
const KEYWORD_NOISE = /^(home|start|startseite|übersicht|uebersicht|suche|impressum|datenschutz|kontakt|news|blog|allgemein)$/i;

/** How much of an author line is a name; beyond it stands a dateline or a reading time. */
const AUTHOR_MAX = 80;

/** What an author line is cut at — everything after it belongs to the page's furniture, not to the name. */
const AUTHOR_TAIL = /\s*(?:[·•|]|\n|\r|\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}|\d{1,2}\.\s*\w+\s+\d{4})/;

/** Language codes that state that there is no language, or several — none of them is an answer. */
const NO_LANGUAGE: readonly string[] = ['zxx', 'und', 'mul'];

/**
 * The page's statements, or `null` for a page that could not be read at all. Every field is the first
 * source that answered, in the order this module documents per field — the page's own machine-readable
 * declaration before its prose, and its prose before anything inferred from the site around it.
 */
export function pageStatementsOf(data: PageData | null | undefined): PageStatements | null {
  if (!data) return null;
  const entities = schemaEntitiesOf(data.structuredData);
  const canonicalUrl = data.canonical?.url?.trim() || null;
  const claims = schemaClaimsOf(primaryEntity(entities, canonicalUrl ?? data.url), data.lrmi);
  const siteName = data.openGraph?.siteName?.trim() || null;
  const contentText = (data.mainContent || data.text || '').trim();
  const title = statedTitle(data, siteName);
  return {
    url: data.url,
    canonicalUrl,
    host: hostOf(canonicalUrl ?? data.url),
    siteName,
    title,
    description: statedDescription(data, claims),
    keywords: statedKeywords(data, claims, title?.value ?? null, siteName),
    language: statedLanguage(data, claims),
    author: statedAuthor(data, claims),
    publisher: statedPublisher(claims, siteName),
    published: statedPublished(data, claims),
    license: statedLicense(data, claims),
    identifier: statedIdentifier(data, claims, canonicalUrl),
    learningTimeMs: statedLearningTime(data, claims),
    imageUrl: firstPageImage(data.images),
    contentText,
    headings: (data.headings ?? []).map((heading) => heading.text.trim()).filter(Boolean),
    terms: {
      learningResourceType: unique([...claims.learningResourceTypes, ...claims.types]),
      educationalContext: unique(claims.educationalLevels),
      intendedEndUserRole: unique(claims.educationalRoles),
      discipline: unique(claims.subjects)
    }
  };
}

/**
 * What the page calls itself. Dublin Core and Open Graph before the document title, because both are
 * written for a reader elsewhere while `<title>` is written for a browser tab — which is why it so often
 * carries the site's name as a suffix.
 */
function statedTitle(data: PageData, siteName: string | null): Stated<string> | null {
  const candidates: [string | null | undefined, StatementSource][] = [
    [data.dublinCore?.title, 'dc'],
    [data.openGraph?.title, 'og'],
    [data.title, 'meta'],
    [data.twitter?.title, 'twitter']
  ];
  for (const [value, source] of candidates) {
    const stated = collapse(value);
    if (stated) return { value: withoutSiteSuffix(stated, siteName, data.url), source };
  }
  return null;
}

/**
 * The title without the site's name behind a separator. Only where the tail *is* the site's name (or its
 * host label) and something of substance remains: a title is allowed to contain a dash, and "Optik – Licht"
 * must survive whole.
 */
function withoutSiteSuffix(title: string, siteName: string | null, url: string): string {
  const site = normalizeLabel(siteName) || hostLabel(url);
  if (!site) return title;
  const split = /^(.*?)\s+[|–—-]\s+([^|–—-]+)$/.exec(title);
  if (!split) return title;
  const head = split[1].trim();
  if (normalizeLabel(split[2]) !== site || head.length < 5) return title;
  return head;
}

/**
 * The page's own abstract. The plain `description` first — it is the one a site writes for its own listing;
 * the sharing vocabularies repeat it or shorten it, and JSON-LD often carries the site's boilerplate.
 */
function statedDescription(data: PageData, claims: SchemaClaims): Stated<string> | null {
  const candidates: [string | null | undefined, StatementSource][] = [
    [data.meta?.description, 'meta'],
    [data.openGraph?.description, 'og'],
    [data.twitter?.description, 'twitter'],
    [data.dublinCore?.description, 'dc'],
    [claims.description, 'jsonld']
  ];
  for (const [value, source] of candidates) {
    const stated = collapse(value);
    if (stated) return { value: shortened(stated, DESCRIPTION_MAX), source };
  }
  return null;
}

/**
 * The keywords the page states about itself, from every place it may state them, in the order of how
 * deliberately each is written: the keywords meta tag and the page's tags are chosen for this content,
 * Dublin Core's subject and the JSON-LD claims likewise, and a breadcrumb classifies it in passing.
 *
 * Dropped are the ones that say nothing about *this* content: a sentence, the site's own name, the title,
 * the host, and the navigational words every page of a site carries.
 */
function statedKeywords(
  data: PageData,
  claims: SchemaClaims,
  title: string | null,
  siteName: string | null,
): StatedKeyword[] {
  const groups: [readonly string[], StatementSource][] = [
    [split(data.meta?.keywords), 'meta'],
    [data.tags?.items ?? [], 'meta'],
    [split(data.dublinCore?.subject), 'dc'],
    [claims.keywords, 'jsonld'],
    [(data.breadcrumbs?.items ?? []).slice(1).map((crumb) => crumb.text), 'nav']
  ];
  const refused = new Set(
    [title, siteName, hostLabel(data.url)].map((value) => normalizeLabel(value)).filter(Boolean),
  );
  const keywords: StatedKeyword[] = [];
  const seen = new Set<string>();
  for (const [values, source] of groups) {
    for (const value of values) {
      const keyword = collapse(value);
      const folded = normalizeLabel(keyword);
      if (!keyword || !folded || seen.has(folded) || refused.has(folded)) continue;
      if (keyword.length > KEYWORD_LENGTH_MAX) continue;
      if (folded.split(' ').length > KEYWORD_WORDS_MAX) continue;
      if (/^\d+$/.test(folded) || KEYWORD_NOISE.test(keyword)) continue;
      seen.add(folded);
      keywords.push({ value: keyword, source });
      if (keywords.length >= KEYWORDS_MAX) return keywords;
    }
  }
  return keywords;
}

/**
 * The language the page is written in, as its own declaration — the `lang` attribute first, which is the
 * one a browser and a screen reader go by. Only the primary subtag: the property holds a language, not a
 * region, and `de-DE` and `de-AT` are the same value there.
 */
function statedLanguage(data: PageData, claims: SchemaClaims): Stated<string> | null {
  const candidates: [string | null | undefined, StatementSource][] = [
    [data.meta?.language, 'meta'],
    [data.openGraph?.locale, 'og'],
    [data.dublinCore?.language, 'dc'],
    [claims.language, 'jsonld']
  ];
  for (const [value, source] of candidates) {
    const primary = /^([a-z]{2,3})(?:[-_]|$)/i.exec((value ?? '').trim());
    const language = primary?.[1].toLowerCase();
    if (language && !NO_LANGUAGE.includes(language)) return { value: language, source };
  }
  return null;
}

/** Who wrote it, as the page names them — cleaned of the dateline an author line so often carries. */
function statedAuthor(data: PageData, claims: SchemaClaims): Stated<string> | null {
  const candidates: [string | null | undefined, StatementSource][] = [
    [data.meta?.author, 'meta'],
    [data.dublinCore?.creator, 'dc'],
    [claims.author, 'jsonld'],
    [data.semantic?.author?.text, 'semantic']
  ];
  for (const [value, source] of candidates) {
    const name = authorName(value);
    if (name) return { value: name, source };
  }
  return null;
}

/** An author line as the name in it: the lead-in removed, the tail cut, and nothing that is not a name. */
function authorName(value: string | null | undefined): string | null {
  const stated = collapse(value);
  if (!stated) return null;
  const withoutLead = stated.replace(/^(?:von|by|autor(?:in)?(?::|\s)|geschrieben von)\s*/i, '').trim();
  const cut = withoutLead.split(AUTHOR_TAIL)[0].trim();
  const name = cut.length > AUTHOR_MAX ? '' : cut;
  return name && /\p{L}{2}/u.test(name) ? name : null;
}

/**
 * Who published it. Deliberately no fallback to the host: a domain is an address, not a publisher, and the
 * publisher field is copied into the author field where that is empty (see `mapAgentFields`).
 */
function statedPublisher(claims: SchemaClaims, siteName: string | null): Stated<string> | null {
  if (claims.publisher) return { value: collapse(claims.publisher)!, source: 'jsonld' };
  return siteName ? { value: siteName, source: 'og' } : null;
}

/** When it was published, in the one spelling everything downstream reads (see util/dates.ts). */
function statedPublished(data: PageData, claims: SchemaClaims): Stated<string> | null {
  const candidates: [string | null | undefined, StatementSource][] = [
    [claims.published, 'jsonld'],
    [data.meta?.publishedTime, 'meta'],
    [data.semantic?.publishDate?.datetime, 'semantic'],
    [data.dublinCore?.date, 'dc']
  ];
  for (const [value, source] of candidates) {
    const date = toIsoDate(value);
    if (date) return { value: date, source };
  }
  return null;
}

/**
 * The licence the page states. The licence link the extraction found leads, since it is the page's
 * machine-readable statement; a `license` in the JSON-LD says the same thing and is read where there is no
 * link. What is only in the running text is reported as found but not declared (see `ccLicenseOf`), and the
 * composer keeps it out of the fields.
 */
function statedLicense(data: PageData, claims: SchemaClaims): StatedLicense | null {
  const found = ccLicenseOf(data.license);
  if (found?.declared) return found;
  const fromClaims = ccLicenseOfUrl(claims.licenseUrl);
  if (fromClaims) return { ...fromClaims, source: 'jsonld', declared: true };
  const rights = ccLicenseOf(
    data.dublinCore?.rights ? { source: 'meta[DC.rights]', text: data.dublinCore.rights } : null,
  );
  return found ?? rights;
}

/** What identifies the work: a DOI or ISBN if stated, else the canonical address where it differs. */
function statedIdentifier(
  data: PageData,
  claims: SchemaClaims,
  canonicalUrl: string | null,
): Stated<string> | null {
  if (claims.identifier) return { value: claims.identifier, source: 'jsonld' };
  if (canonicalUrl && canonicalUrl !== data.url) return { value: canonicalUrl, source: 'url' };
  return null;
}

/** How long the content takes to work through, where the page states it as a duration. */
function statedLearningTime(data: PageData, claims: SchemaClaims): Stated<number> | null {
  if (claims.learningTimeMs) return { value: claims.learningTimeMs, source: 'jsonld' };
  const lrmi = toDurationMs(data.lrmi?.timeRequired);
  return lrmi ? { value: lrmi, source: 'lrmi' } : null;
}

/** A comma- or semicolon-separated declaration as its entries. */
function split(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Whitespace collapsed to single spaces, trimmed; `null` for anything that is then empty. */
function collapse(value: string | null | undefined): string | null {
  const stated = (value ?? '').replace(/\s+/g, ' ').trim();
  return stated || null;
}

/** A text cut to at most `max` characters, at the last sentence end before it where there is one. */
function shortened(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return sentence > max / 2 ? cut.slice(0, sentence + 1) : `${cut.trimEnd()}…`;
}

/** The host of an address, or `null` where it is none. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The registrable label of an address's host (`beispiel` of `www.beispiel.de`), folded for comparison. */
function hostLabel(url: string): string {
  const host = hostOf(url);
  if (!host) return '';
  const labels = host.replace(/^www\./, '').split('.');
  return normalizeLabel(labels[0] ?? '');
}

/** The list without repeats, comparing folded labels and keeping the first spelling. */
function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const folded = normalizeLabel(value);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    kept.push(value.trim());
  }
  return kept;
}
