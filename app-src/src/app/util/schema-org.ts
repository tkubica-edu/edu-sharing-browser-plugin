// The JSON-LD a page carries about itself, read as claims about *one* resource.
//
// The hard part is not the vocabulary, it is choosing which entity the page is about. A page's `ld+json`
// typically holds an Organization, a BreadcrumbList and a WebSite before it holds anything about the
// content — take the first entity and the publisher becomes the author, the breadcrumb becomes the subject.
// So the entity is chosen by address first and by kind second, and everything after that is plain reading.

import { toDurationMs, toIsoDate } from './dates';

/** One JSON-LD entity, flattened out of whatever nesting the page wrapped it in. */
export type SchemaEntity = Record<string, unknown>;

/** The kinds that describe the page's surroundings rather than its content. */
const SURROUNDING_TYPES: readonly string[] = [
  'organization', 'website', 'webpage', 'breadcrumblist', 'collectionpage', 'searchresultspage',
  'itemlist', 'sitenavigationelement', 'person', 'imageobject', 'listitem'
];

/**
 * Every entity of the page's JSON-LD blocks, in document order: each block, its `@graph`, and any array
 * nested in either. A block that is not an object contributes nothing.
 */
export function schemaEntitiesOf(structuredData: readonly unknown[] | null | undefined): SchemaEntity[] {
  const entities: SchemaEntity[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || !value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const entity = value as SchemaEntity;
    if (entity['@graph']) visit(entity['@graph'], depth + 1);
    if (typeof entity['@type'] === 'string' || Array.isArray(entity['@type'])) entities.push(entity);
    // A `mainEntity`/`mainEntityOfPage` names the thing the page is about, which is exactly what is wanted.
    visit(entity['mainEntity'], depth + 1);
    visit(entity['mainEntityOfPage'], depth + 1);
  };
  visit(structuredData ?? [], 0);
  return entities;
}

/**
 * The entity the page is about: the one whose own address is the page's, else the first that describes a
 * resource rather than the site around it. `null` where the page's JSON-LD only describes its surroundings —
 * which is the common case and no failure.
 */
export function primaryEntity(
  entities: readonly SchemaEntity[],
  url: string | null | undefined,
): SchemaEntity | null {
  const addressed = entities.filter((entity) => !isSurrounding(entity));
  const here = (url ?? '').trim().replace(/#.*$/, '').replace(/\/$/, '');
  if (here) {
    const own = addressed.find((entity) =>
      [firstText(entity['url']), firstText(entity['@id'])].some(
        (address) => address && address.replace(/#.*$/, '').replace(/\/$/, '') === here,
      ),
    );
    if (own) return own;
  }
  return addressed[0] ?? null;
}

/** What the page's JSON-LD and LRMI tags claim about the resource, in the panel's own terms. */
export interface SchemaClaims {
  description: string | null;
  keywords: string[];
  author: string | null;
  publisher: string | null;
  published: string | null;
  language: string | null;
  licenseUrl: string | null;
  identifier: string | null;
  learningTimeMs: number | null;
  /** Whether the page states it is *not* free to access — `null` where it states nothing. */
  freeToAccess: boolean | null;
  /** The kinds the entity declares (`videoobject`, `quiz`), lowercased. */
  types: string[];
  /** Free labels for the vocabulary-bound fields, to be matched against a metadata set (never used raw). */
  learningResourceTypes: string[];
  educationalLevels: string[];
  educationalRoles: string[];
  subjects: string[];
}

/** The claims of one entity, with the LRMI meta tags beside it — both state the same kinds of thing. */
export function schemaClaimsOf(
  entity: SchemaEntity | null | undefined,
  lrmi?: {
    educationalUse?: string | null;
    educationalLevel?: string | null;
    learningResourceType?: string | null;
    timeRequired?: string | null;
  } | null,
): SchemaClaims {
  const from = entity ?? {};
  return {
    description: firstText(from['description']),
    keywords: [
      ...textList(from['keywords']),
      ...namedList(from['about']),
      ...textList(from['teaches'])
    ],
    author: nameOf(from['author']),
    publisher: nameOf(from['publisher']) ?? nameOf(from['provider']) ?? nameOf(from['sourceOrganization']),
    published:
      toIsoDate(firstText(from['datePublished'])) ??
      toIsoDate(firstText(from['dateCreated'])) ??
      toIsoDate(firstText(from['uploadDate'])),
    language: firstText(from['inLanguage']) ?? nameOf(from['inLanguage']),
    licenseUrl: urlOf(from['license']) ?? urlOf(from['usageInfo']),
    identifier: identifierOf(from),
    // Only what this entity states. The LRMI tag says the same thing under another vocabulary, and the
    // caller reads it itself — folding it in here would report it as a schema.org claim.
    learningTimeMs:
      toDurationMs(firstText(from['timeRequired'])) ??
      toDurationMs(firstText(from['totalTime'])) ??
      toDurationMs(firstText(from['duration'])),
    freeToAccess: typeof from['isAccessibleForFree'] === 'boolean'
      ? (from['isAccessibleForFree'] as boolean)
      : null,
    types: typeList(from['@type']),
    learningResourceTypes: [
      ...namedList(from['learningResourceType']),
      ...textList(lrmi?.learningResourceType)
    ],
    educationalLevels: [
      ...namedList(from['educationalLevel']),
      ...namedList(audienceField(from, 'educationalLevel')),
      ...textList(lrmi?.educationalLevel)
    ],
    educationalRoles: [
      ...namedList(audienceField(from, 'educationalRole')),
      ...namedList(from['educationalRole']),
      ...textList(lrmi?.educationalUse)
    ],
    subjects: alignmentNames(from['educationalAlignment'], ['educationalsubject', 'subject'])
  };
}

/** Whether an entity describes the site around the content rather than the content. */
function isSurrounding(entity: SchemaEntity): boolean {
  const types = typeList(entity['@type']);
  return types.length > 0 && types.every((type) => SURROUNDING_TYPES.includes(type));
}

/** An entity's kinds, lowercased; `@type` is a string or a list of them. */
function typeList(value: unknown): string[] {
  return textList(value).map((type) => type.replace(/^.*[/#]/, '').toLowerCase());
}

/** A value's strings: the value itself, or every string of a list. Blanks dropped. */
function textList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

/** The first string of a value, or `null`. */
function firstText(value: unknown): string | null {
  return textList(value)[0] ?? null;
}

/**
 * The names of a value that may be a string, an object with a `name`, or a list of either — which is how
 * schema.org states an author, a publisher and a `DefinedTerm` alike.
 */
function namedList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const entry of values) {
    if (typeof entry === 'string' && entry.trim()) names.push(entry.trim());
    else if (entry && typeof entry === 'object') {
      const named = entry as SchemaEntity;
      const name = firstText(named['name']) ?? firstText(named['termCode']) ?? firstText(named['alternateName']);
      if (name) names.push(name);
    }
  }
  return names;
}

/** One name out of such a value — an author or a publisher, several of them joined as the field holds them. */
function nameOf(value: unknown): string | null {
  const names = namedList(value);
  return names.length ? names.join(', ') : null;
}

/** The address a value names, whether it is one or carries one under `url`/`@id`. */
function urlOf(value: unknown): string | null {
  const direct = firstText(value);
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  if (value && typeof value === 'object') {
    const entity = value as SchemaEntity;
    return firstText(entity['url']) ?? firstText(entity['@id']);
  }
  return null;
}

/** A DOI, ISBN or other stated identifier — the ones that identify the work rather than the page. */
function identifierOf(entity: SchemaEntity): string | null {
  const doi = firstText(entity['doi']);
  if (doi) return doi.startsWith('http') ? doi : `doi:${doi}`;
  const isbn = firstText(entity['isbn']);
  if (isbn) return `isbn:${isbn}`;
  const stated = entity['identifier'];
  const direct = firstText(stated);
  if (direct) return direct;
  if (stated && typeof stated === 'object') {
    const value = firstText((stated as SchemaEntity)['value']);
    if (value) return value;
  }
  return null;
}

/** A field of the entity's audience, whichever of the two spellings the page used. */
function audienceField(entity: SchemaEntity, field: string): unknown {
  const audiences = Array.isArray(entity['audience']) ? entity['audience'] : [entity['audience']];
  const values: unknown[] = [];
  for (const audience of audiences) {
    if (audience && typeof audience === 'object') values.push((audience as SchemaEntity)[field]);
  }
  return values;
}

/**
 * The target names of the alignments of the given kinds. An `educationalAlignment` is the one place a page
 * states its subject outright — and the kind matters: the same structure also carries competencies and
 * teaching methods, which are not the subject.
 */
function alignmentNames(value: unknown, kinds: readonly string[]): string[] {
  const alignments = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const alignment of alignments) {
    if (!alignment || typeof alignment !== 'object') continue;
    const entity = alignment as SchemaEntity;
    const kind = (firstText(entity['alignmentType']) ?? '').toLowerCase();
    if (!kinds.includes(kind)) continue;
    const name = firstText(entity['targetName']);
    if (name) names.push(name);
  }
  return names;
}
