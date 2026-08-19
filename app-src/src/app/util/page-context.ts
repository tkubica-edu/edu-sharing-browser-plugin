/**
 * What the KI assistant is told about the page the panel is open on. The widget derives this from its own
 * location — which inside the panel is the extension, not the page — so it is handed over instead (see
 * AiAssistantScreenComponent). Snake_case keys and the `url:*` sources are the widget's own wire format,
 * kept verbatim so a context from here reads like one it read itself.
 */

/** What kind of page the assistant is looking at; `other` for one none of the rules below match. */
export type PageKind = 'topic' | 'collection' | 'content' | 'subject' | 'search' | 'other';

/**
 * The page as the assistant is told about it. Every http(s) page carries its address; the fields below it are
 * set where they apply, and a tab that is no page at all is described by its kind alone.
 */
export interface PageContext {
  page_kind: PageKind;
  page_url?: string;
  page_host?: string;
  /** The content the page shows (`content`). */
  node_id?: string;
  /** The collection the page shows (`collection`), or the one a topic page is built on (`topic`). */
  collection_id?: string;
  topic_page_slug?: string;
  subject_slug?: string;
  search_query?: string;
  /**
   * What the page says it is about, in the widget's field for the page's visible text. From the panel that is the
   * tab's title and nothing more: reading the page itself needs the content script, and for a page outside the
   * repository the title is the only thing that names its subject at all.
   */
  page_text?: string;
  /** Which rule below recognised the page — the widget's own vocabulary for it. */
  detection_source?: string;
}

/** What a page turned out to be about — the context without the address every page has. */
type PageSubject = Omit<PageContext, 'page_url' | 'page_host'>;

/**
 * What the assistant works from — the fields that decide which materials and which skills a context stands
 * for. Two contexts agreeing on all of them are the same page under a different address.
 */
const SUBJECT_FIELDS = [
  'page_kind',
  'node_id',
  'collection_id',
  'topic_page_slug',
  'subject_slug',
  'search_query'
] as const satisfies readonly (keyof PageContext)[];

/** A node id as the repository writes it into its URLs. */
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A topic-page or subject-portal slug, as those pages carry it in their path. */
const SLUG = /^[a-z0-9-]{2,80}$/i;

/** Bounds on a search term worth passing on: a single character says nothing, a long one is not a term. */
const QUERY_MIN = 2;
const QUERY_MAX = 200;

/** Cap on the page text, so a document abusing its title cannot take over the assistant's prompt. */
const TEXT_MAX = 300;

/**
 * Cap on the text of a content handed over to be checked. Far above {@link TEXT_MAX}, because this text IS the
 * subject of the dialogue rather than a hint about it — but bounded all the same: what is passed on travels in
 * the assistant's prompt.
 */
const CONTENT_TEXT_MAX = 8000;

/**
 * What the page is about, or `null` for an address that is none — `about:`, a blank tab, nothing at all. The title
 * is the tab's, as the browser reports it; passing it on is what gives the assistant a subject for a page whose
 * address says nothing about one.
 */
export function pageContextOf(
  url: string | null | undefined,
  title?: string | null,
): PageContext | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return {
    page_url: parsed.href,
    page_host: parsed.hostname,
    ...(subjectOf(parsed) ?? { page_kind: 'other' }),
    ...pageText(title)
  };
}

/** A content the panel curates, as the fields the assistant is told about it. */
export interface CuratedContent {
  /** What the content is called. */
  title?: string | null;
  /** What the content says — the text its metadata was read from. */
  text?: string | null;
  /** The page the content was erschlossen from, if one is known. */
  url?: string | null;
  /** The collection the content was filed in — what the assistant looks its skill up by. */
  collectionId?: string | null;
  /** The content's own node, where it already has one — what makes the content the subject. */
  nodeId?: string | null;
}

/**
 * A content the panel curates, as a context for the assistant: what it is called, what it says, the node it was
 * saved as, and the collection it was filed in.
 *
 * **The subject is the content, and saying so takes care.** The assistant's backend resolves whichever id it is
 * handed as "the current page" — and handed a collection it describes the collection: its editorial compendium
 * text, how many materials it holds, an invitation to list its contents. The content's own title and text are
 * then never put in front of the model at all, since they are read only where nothing could be resolved. A
 * context that names the collection as the page therefore produces a check of the collection, however plainly
 * the task asks about this one content.
 *
 * So the node leads: with one, `page_kind` is that content and the collection travels beside it as a field of
 * its own. Without one — a content not yet saved, which is what a run with the writes switched off is — no page
 * is named, and the title and text reach the model as the page's own text instead.
 *
 * The collection is stated either way, because it is not an answer to "which page is this": it is what the
 * assistant looks the collection's skills up by, and a check that cannot reach them measures the content
 * against nothing in particular. Only the page identity is withheld where there is no node.
 */
export function contentContextOf(content: CuratedContent): PageContext {
  const collection = content.collectionId?.trim();
  const node = content.nodeId?.trim();
  return {
    page_kind: node ? 'content' : 'other',
    ...addressOf(content.url),
    ...(node ? { node_id: node } : {}),
    ...(collection ? { collection_id: collection } : {}),
    ...contentText(content.title, content.text),
    detection_source: 'panel:content'
  };
}

/** The address fields every http(s) page carries; nothing for an address that is none. */
function addressOf(url: string | null | undefined): Pick<PageContext, 'page_url' | 'page_host'> {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    return { page_url: parsed.href, page_host: parsed.hostname };
  } catch {
    return {};
  }
}

/**
 * A content as the assistant reads it: what it is called, then what it says. The title leads, so it survives
 * where the text is cut off at {@link CONTENT_TEXT_MAX}.
 */
function contentText(
  title: string | null | undefined,
  text: string | null | undefined,
): { page_text?: string } {
  const stated = [title?.trim(), text?.trim()].filter((part): part is string => !!part);
  const joined = stated.join('\n\n').slice(0, CONTENT_TEXT_MAX);
  return joined ? { page_text: joined } : {};
}

/** The title as the page's text, if it is one; nothing to add for a tab that reports none. */
function pageText(title: string | null | undefined): { page_text?: string } {
  const text = title?.trim().slice(0, TEXT_MAX);
  return text ? { page_text: text } : {};
}

/**
 * Whether both contexts are about the same thing — same kind, same ids, same search term. True for a page whose
 * address changed without its subject doing so, which is a context to merge rather than to replace.
 */
export function sameSubject(a: PageContext, b: PageContext): boolean {
  return SUBJECT_FIELDS.every((field) => a[field] === b[field]);
}

/** What the page shows, read off its path and its parameters; `null` where no rule matches. */
function subjectOf(url: URL): PageSubject | null {
  const path = url.pathname.toLowerCase();
  const parameters = url.searchParams;

  const rendered = path.match(/\/components\/render\/([0-9a-f-]{36})(?:\/|$)/i);
  if (rendered && NODE_ID.test(rendered[1])) {
    return { page_kind: 'content', node_id: rendered[1], detection_source: 'url:components/render' };
  }

  if (/\/components\/collections(?:\/|$)/i.test(path)) {
    const id = parameters.get('id');
    if (id && NODE_ID.test(id)) {
      return {
        page_kind: 'collection',
        collection_id: id,
        detection_source: 'url:/components/collections?id',
        // A collection page can be searched inside; the term belongs to the page as much as the collection.
        ...searchQuery(parameters.get('q'))
      };
    }
  }

  if (/\/components\/topic-pages(?:\/|$)/i.test(path)) {
    const id = parameters.get('collectionId');
    if (id && NODE_ID.test(id)) {
      return {
        page_kind: 'topic',
        collection_id: id,
        detection_source: 'url:/components/topic-pages'
      };
    }
  }

  const node = parameters.get('node') ?? parameters.get('node_id') ?? parameters.get('nodeId');
  if (node && NODE_ID.test(node)) {
    return { page_kind: 'content', node_id: node, detection_source: 'url:?node' };
  }

  const collection =
    parameters.get('collection') ?? parameters.get('collection_id') ?? parameters.get('collectionId');
  if (collection && NODE_ID.test(collection)) {
    return { page_kind: 'collection', collection_id: collection, detection_source: 'url:?collection' };
  }

  const topic = path.match(/\/themenseite\/([a-z0-9-]+)(?:\/|$)/i);
  if (topic && SLUG.test(topic[1])) {
    return { page_kind: 'topic', topic_page_slug: topic[1], detection_source: 'url:/themenseite' };
  }

  const subject = path.match(/\/fachportal\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?(?:\/|$)/i);
  if (subject && SLUG.test(subject[1])) {
    // A subject portal can carry a topic page of its own; the deeper page is the more precise source.
    const inside = subject[2] && SLUG.test(subject[2]) ? subject[2] : null;
    return {
      page_kind: 'subject',
      subject_slug: subject[1],
      ...(inside ? { topic_page_slug: inside } : {}),
      detection_source: inside ? 'url:/fachportal/<slug>' : 'url:/fachportal'
    };
  }

  if (/\/components\/search(?:\/|$)/i.test(path)) {
    return {
      page_kind: 'search',
      detection_source: 'url:/components/search',
      ...searchQuery(parameters.get('q'))
    };
  }

  const query = parameters.get('q') ?? parameters.get('search') ?? parameters.get('query');
  const searched = searchQuery(query);
  if (searched.search_query) return { page_kind: 'search', ...searched, detection_source: 'url:?q' };

  return null;
}

/** The search term if it is one worth passing on, else nothing to add. */
function searchQuery(query: string | null): { search_query?: string } {
  return query && query.length >= QUERY_MIN && query.length <= QUERY_MAX
    ? { search_query: query }
    : {};
}
