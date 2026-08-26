// The content as the "Allgemeines Metadatenprofil für Bildungsressourcen" (AMB,
// https://w3id.org/kim/amb/latest/) describes it, and that description as the nostr event a relay of
// the edufeed network takes: kind 30142, whose tags carry the whole record — the event's `content` is
// only the description again, for clients that show nothing else.
//
// The tag shapes follow the reference converter (edufeed-org/amb-nostr-converter, `src/converters/
// ambToNostr.ts`): a scalar field is one tag of its own name, a nested object is flattened into
// colon-delimited keys (`about:id`, `creator:name`), a localized label carries its language as the last
// segment (`about:prefLabel:de`), and keywords are the nostr-native `t` tags. The relay demands `d` and
// `name` and nothing else (its `validateAMB`), so everything below `name` is written only where the
// content states it.

import { firstString, stringValues } from './mds-values';

/** One nostr tag: the key, then its values. */
export type NostrTag = string[];

/** A nostr event as it goes to be signed — id, pubkey and sig are added by the signature. */
export interface NostrEventTemplate {
  kind: number;
  created_at: number;
  tags: NostrTag[];
  content: string;
}

/** The kind AMB learning resources are published under (NIP-AMB). */
export const AMB_KIND = 30142;

/**
 * A term of a controlled vocabulary: its URI and/or its label per language. AMB states both where it
 * can, since the URI is what a consumer matches on and the label is what it shows.
 */
export interface AmbConcept {
  id?: string;
  prefLabel?: Record<string, string>;
  type?: string;
}

/** Who made or published the resource. */
export interface AmbAgent {
  type: 'Person' | 'Organization';
  name: string;
  id?: string;
}

/** Where the metadata itself comes from — the record about the resource, as opposed to the resource. */
export interface AmbMainEntityOfPage {
  id: string;
  type?: string;
  provider?: { id?: string; name?: string; type?: string };
}

/** The AMB record of one learning resource; only `id` and `name` are required by the profile. */
export interface AmbResource {
  id: string;
  name: string;
  type: string[];
  description?: string;
  keywords?: string[];
  inLanguage?: string[];
  creator?: AmbAgent[];
  publisher?: AmbAgent[];
  license?: { id: string };
  isAccessibleForFree?: boolean;
  about?: AmbConcept[];
  educationalLevel?: AmbConcept[];
  audience?: AmbConcept[];
  learningResourceType?: AmbConcept[];
  teaches?: AmbConcept[];
  datePublished?: string;
  dateCreated?: string;
  image?: string;
  mainEntityOfPage?: AmbMainEntityOfPage[];
}

/**
 * What the mapping was given to work from: the content's properties as the panel holds them, plus the
 * three things that are not properties — where the resource lives, what it looks like, and which node
 * of which repository the record was read off.
 */
export interface AmbSource {
  /** The content's metadata, keyed by the property ids of the WLO metadata set. */
  metadata: Record<string, unknown> | null;
  /** The page the content is; the AMB record is about this address. */
  url: string | null;
  /** What to call it where the metadata states no title of its own. */
  title: string | null;
  /** The content's picture, dropped where it is only a type icon — a type icon is not this content. */
  imageUrl: string | null;
  /** The node the record was read off, as a page of the repository UI. */
  nodeLink: string | null;
  /** The repository that holds that node, as the provider of the record. */
  repositoryUrl: string | null;
}

/**
 * The licence URIs of the Creative Commons keys edu-sharing stores. The families are derived rather
 * than listed — `CC_BY_NC_SA` is `by-nc-sa` at whatever version the node states — so only the two
 * dedications that are not licences need naming.
 */
const LICENSE_URIS: Record<string, string> = {
  CC_0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  PDM: 'https://creativecommons.org/publicdomain/mark/1.0/'
};

/** The default version for a CC key whose node states none; every current CC licence is at 4.0. */
const DEFAULT_CC_VERSION = '4.0';

/** The language a label with no language of its own is stated in — the panel and its metadata set are German. */
const DEFAULT_LANGUAGE = 'de';

/** Whether a value is a URI, and so belongs in an `id` rather than in a label. */
function isUri(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('urn:');
}

/**
 * The licence as a URI: the two public-domain dedications by name, every `CC_*` key as its family at
 * the version the node states. `null` for everything else — a licence this mapping cannot name as a
 * URI is better left off the record than stated wrongly, since `license:id` is what a consumer filters
 * on.
 */
function licenseUri(key: string | null, version: string | null): string | null {
  if (!key) return null;
  const normalized = key.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (LICENSE_URIS[normalized]) return LICENSE_URIS[normalized];
  if (!normalized.startsWith('CC_BY')) return null;
  const family = normalized.slice('CC_'.length).toLowerCase().replace(/_/g, '-');
  return `https://creativecommons.org/licenses/${family}/${version?.trim() || DEFAULT_CC_VERSION}/`;
}

/**
 * A property's values as vocabulary terms. The WLO set stores them as the URIs of the openeduhub
 * vocabularies, which is what AMB wants; a value that is not a URI is kept as the label it evidently
 * is, so a hand-typed term is carried over rather than dropped.
 */
function concepts(value: unknown): AmbConcept[] {
  return stringValues(value).map((entry) =>
    isUri(entry)
      ? { id: entry, type: 'Concept' }
      : { prefLabel: { [DEFAULT_LANGUAGE]: entry }, type: 'Concept' }
  );
}

/** A comma-free list of names as agents of one kind — the free-text author and publisher fields. */
function agents(value: unknown, type: AmbAgent['type']): AmbAgent[] {
  return stringValues(value).map((name) => ({ type, name }));
}

/**
 * The date as AMB states it (`YYYY-MM-DD`), from whatever the property carries — the metadata agent
 * writes a plain date, the repository an ISO timestamp. `undefined` for anything else, so an
 * unparseable value leaves the field off rather than putting a wrong date on the record.
 */
function toDate(value: unknown): string | undefined {
  const stated = firstString(value);
  if (!stated) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(stated.trim());
  return match ? match[1] : undefined;
}

/**
 * The AMB record of the content. `null` where the record would have no subject — AMB identifies a
 * resource by its address, and a record without one can neither be found again nor replaced, since the
 * address is also the event's `d` tag.
 */
export function toAmbResource(source: AmbSource): AmbResource | null {
  const metadata = source.metadata ?? {};
  const id = firstString(metadata['ccm:wwwurl']) ?? source.url ?? source.nodeLink;
  if (!id) return null;

  const name = firstString(metadata['cclom:title']) ?? source.title;
  if (!name) return null;

  const resource: AmbResource = { id, name, type: ['LearningResource'] };

  const description = firstString(metadata['cclom:general_description']);
  if (description) resource.description = description;

  const keywords = stringValues(metadata['cclom:general_keyword']);
  if (keywords.length) resource.keywords = keywords;

  const languages = stringValues(metadata['cclom:general_language']);
  if (languages.length) resource.inLanguage = languages;

  // The people are the free-text author field; the publisher is the combined one the agent fills, which
  // names an institution rather than a person.
  const creators = agents(metadata['ccm:author_freetext'] ?? metadata['cm:author'], 'Person');
  if (creators.length) resource.creator = creators;

  const publishers = agents(metadata['ccm:oeh_publisher_combined'], 'Organization');
  if (publishers.length) resource.publisher = publishers;

  const license = licenseUri(
    firstString(metadata['ccm:commonlicense_key']),
    firstString(metadata['ccm:commonlicense_cc_version'])
  );
  if (license) {
    resource.license = { id: license };
    // Stated only where the licence is: it is a claim about this resource, and without a licence to
    // support it the claim rests on nothing.
    resource.isAccessibleForFree = true;
  }

  const about = concepts(metadata['ccm:taxonid']);
  if (about.length) resource.about = about;

  const levels = concepts(metadata['ccm:educationalcontext']);
  if (levels.length) resource.educationalLevel = levels;

  const audience = concepts(metadata['ccm:educationalintendedenduserrole']);
  if (audience.length) resource.audience = audience;

  // The WLO set moved the resource type from `oeh:new_lrt` to `ccm:oeh_lrt`; a payload may carry
  // either, so both are read and the newer one wins.
  const lrt = concepts(metadata['ccm:oeh_lrt'] ?? metadata['oeh:new_lrt']);
  if (lrt.length) resource.learningResourceType = lrt;

  const teaches = concepts(metadata['ccm:competence']);
  if (teaches.length) resource.teaches = teaches;

  const published = toDate(metadata['schema:datePublished']);
  if (published) resource.datePublished = published;

  const created = toDate(metadata['cm:created']);
  if (created) resource.dateCreated = created;

  if (source.imageUrl) resource.image = source.imageUrl;

  // Where the record itself lives: the node in the repository that describes the resource. It is what
  // makes the event traceable back to this repository, and the mapping also emits it as a plain `r`
  // tag, so a client that reads nothing else still has the link.
  if (source.nodeLink) {
    resource.mainEntityOfPage = [
      {
        id: source.nodeLink,
        type: 'WebPage',
        provider: {
          ...(source.repositoryUrl ? { id: source.repositoryUrl } : {}),
          name: 'edu-sharing',
          type: 'Organization'
        }
      }
    ];
  }

  return resource;
}

/** Flatten one vocabulary term under its field's name — `about:id`, `about:prefLabel:de`, `about:type`. */
function conceptTags(tags: NostrTag[], prefix: string, concept: AmbConcept): void {
  if (concept.id) tags.push([`${prefix}:id`, concept.id]);
  for (const [language, label] of Object.entries(concept.prefLabel ?? {})) {
    tags.push([`${prefix}:prefLabel:${language}`, label]);
  }
  if (concept.type) tags.push([`${prefix}:type`, concept.type]);
}

/** Flatten one agent under its field's name — `creator:name`, `creator:type`, `creator:id`. */
function agentTags(tags: NostrTag[], prefix: string, agent: AmbAgent): void {
  tags.push([`${prefix}:name`, agent.name]);
  tags.push([`${prefix}:type`, agent.type]);
  if (agent.id) tags.push([`${prefix}:id`, agent.id]);
}

/**
 * The AMB record as the tags of a kind-30142 event, in the order the reference converter emits them:
 * the identifier, the type, the name, and the rest of the record behind them.
 */
export function ambToNostrTags(resource: AmbResource): NostrTag[] {
  const tags: NostrTag[] = [];

  // The resource's own address is the event's identifier, which is what makes a later event about the
  // same resource replace this one rather than sit beside it (an addressable event, NIP-01).
  tags.push(['d', resource.id]);
  for (const type of resource.type) tags.push(['type', type]);
  tags.push(['name', resource.name]);
  if (resource.description) tags.push(['description', resource.description]);

  // Keywords go as the nostr-native hashtag, so a relay indexes them the way it indexes every other
  // event's topics; their original case is kept, since AMB keywords are terms rather than hashtags.
  for (const keyword of resource.keywords ?? []) tags.push(['t', keyword]);
  for (const language of resource.inLanguage ?? []) tags.push(['inLanguage', language]);

  for (const creator of resource.creator ?? []) agentTags(tags, 'creator', creator);
  for (const publisher of resource.publisher ?? []) agentTags(tags, 'publisher', publisher);

  if (resource.license) tags.push(['license:id', resource.license.id]);
  if (typeof resource.isAccessibleForFree === 'boolean') {
    tags.push(['isAccessibleForFree', String(resource.isAccessibleForFree)]);
  }

  for (const concept of resource.about ?? []) conceptTags(tags, 'about', concept);
  for (const concept of resource.educationalLevel ?? []) conceptTags(tags, 'educationalLevel', concept);
  for (const concept of resource.audience ?? []) conceptTags(tags, 'audience', concept);
  for (const concept of resource.learningResourceType ?? []) {
    conceptTags(tags, 'learningResourceType', concept);
  }
  for (const concept of resource.teaches ?? []) conceptTags(tags, 'teaches', concept);

  if (resource.datePublished) tags.push(['datePublished', resource.datePublished]);
  if (resource.dateCreated) tags.push(['dateCreated', resource.dateCreated]);
  if (resource.image) tags.push(['image', resource.image]);

  for (const page of resource.mainEntityOfPage ?? []) {
    tags.push(['mainEntityOfPage:id', page.id]);
    if (page.type) tags.push(['mainEntityOfPage:type', page.type]);
    if (page.provider?.id) tags.push(['mainEntityOfPage:provider:id', page.provider.id]);
    if (page.provider?.name) tags.push(['mainEntityOfPage:provider:name', page.provider.name]);
    if (page.provider?.type) tags.push(['mainEntityOfPage:provider:type', page.provider.type]);
    // The same address once more as the nostr-native reference tag.
    tags.push(['r', page.id]);
  }

  return tags;
}

/**
 * The record as an unsigned kind-30142 event. `content` repeats the description because AMB asks for
 * it: a client that only renders `content` — every generic nostr client — would otherwise show an
 * empty note.
 */
export function toAmbEvent(resource: AmbResource, createdAt: number): NostrEventTemplate {
  return {
    kind: AMB_KIND,
    created_at: createdAt,
    tags: ambToNostrTags(resource),
    content: resource.description ?? ''
  };
}
