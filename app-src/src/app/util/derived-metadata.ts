// The page's statements as metadata fields: which property each one goes into, and whether it enters the
// form as a decided value or as a proposal still to be accepted.
//
// The split is the whole point of this module. What the page *declares* about itself — its description, its
// licence link, its author, its language — is as much a fact as its title, and a form that shows it as a
// value states nothing that was not already stated. What is *derived* from the page — a description taken
// from its first paragraph, keywords counted out of its text — is a machine's proposal and is offered as
// one.
//
// One property can only have one standing. A widget offers a suggestion only while its own value is empty,
// and the editor withholds every proposed property from the node to make that so (`withoutAiFields`), so a
// property cannot hold a stated value and a proposal at once: where the page states something, the
// derivations for that property are dropped rather than mixed in, and the report says so.

import { LICENSE_KEY } from './agent-fields';
import { PageStatements, PageTerms, StatementSource } from './page-statements';

/** The properties the licence is stated in — the key and its version; the rest is filled by mapAgentFields. */
const LICENSE_VERSION_FIELD = 'ccm:commonlicense_cc_version';

/** Where the panel carries the page's own vocabulary words until a metadata set can resolve them. */
export const PAGE_TERMS_KEY = '_page_terms';

/**
 * How a field came to hold its value. Beyond the places on the page itself (see {@link StatementSource})
 * there are the two the panel adds: what the repository read off the same address, and what was resolved
 * against a metadata set's valuespace.
 */
export type DerivationSource = StatementSource | 'website-info' | 'valuespace';

/**
 * One derived field. `stated` becomes a value in the form, `inferred` a pending proposal — nothing in
 * between reaches a widget.
 */
export interface DerivedField {
  property: string;
  values: string[];
  source: DerivationSource;
  standing: 'stated' | 'inferred';
  /** One German sentence naming the evidence — what a person is shown and can check. */
  evidence: string;
}

/** A field that was found and not taken over, with the reason — the other half of an honest report. */
export interface RejectedField {
  property: string;
  values: string[];
  reason: string;
}

/** What a derivation produced, for the log and for a view that wants to show the provenance. */
export interface DerivationReport {
  fields: DerivedField[];
  rejected: RejectedField[];
}

/** The payload contribution of a derivation: the values, the origins of the proposals, and the report. */
export interface DerivedPayload {
  values: Record<string, unknown>;
  origins: Record<string, 'page'>;
  report: DerivationReport;
}

/**
 * The fields the page's statements amount to. In the order they are preferred, since {@link mergeDerived}
 * keeps the first entry per property — a caller that has another source (the repository's own reading of
 * the address, say) puts it before or after these accordingly.
 */
export function statedFields(statements: PageStatements): DerivedField[] {
  const fields: DerivedField[] = [];
  const add = (
    property: string,
    values: (string | null | undefined)[],
    source: DerivationSource,
    standing: DerivedField['standing'],
    evidence: string,
  ): void => {
    const kept = values.map((value) => (value ?? '').trim()).filter(Boolean);
    if (kept.length) fields.push({ property, values: kept, source, standing, evidence });
  };

  if (statements.title) {
    add('cclom:title', [statements.title.value], statements.title.source, 'stated',
      `Titel der Seite (${sourceLabel(statements.title.source)})`);
  }
  add('ccm:wwwurl', [statements.url], 'url', 'stated', 'Adresse der Seite');
  if (statements.description) {
    add('cclom:general_description', [statements.description.value], statements.description.source,
      'stated', `Beschreibung, die die Seite über sich angibt (${sourceLabel(statements.description.source)})`);
  }
  const stated = statements.keywords.filter((keyword) => keyword.source !== 'nav');
  if (stated.length) {
    add('cclom:general_keyword', stated.map((keyword) => keyword.value), stated[0].source, 'stated',
      `${stated.length} Schlagworte, mit denen die Seite sich selbst auszeichnet`);
  }
  if (statements.language) {
    add('cclom:general_language', [statements.language.value], statements.language.source, 'stated',
      `Sprache, die die Seite angibt (${sourceLabel(statements.language.source)})`);
  }
  if (statements.author) {
    add('ccm:author_freetext', [statements.author.value], statements.author.source, 'stated',
      `Autor:in, die die Seite nennt (${sourceLabel(statements.author.source)})`);
  }
  if (statements.publisher) {
    add('ccm:oeh_publisher_combined', [statements.publisher.value], statements.publisher.source, 'stated',
      `Herausgeber, den die Seite nennt (${sourceLabel(statements.publisher.source)})`);
  }
  if (statements.published) {
    add('schema:datePublished', [statements.published.value], statements.published.source, 'stated',
      `Veröffentlichungsdatum, das die Seite angibt (${sourceLabel(statements.published.source)})`);
  }
  if (statements.identifier) {
    add('ccm:general_identifier', [statements.identifier.value], statements.identifier.source, 'stated',
      'Kennung, die die Seite für den Inhalt nennt');
  }
  if (statements.learningTimeMs) {
    const minutes = Math.round(statements.learningTimeMs.value / 60000);
    add('cclom:typicallearningtime', [String(statements.learningTimeMs.value)],
      statements.learningTimeMs.source, 'stated',
      `Bearbeitungsdauer, die die Seite angibt (${minutes} Minuten)`);
  }
  // Only a licence the page declares for itself. One found in the running text may be another resource's,
  // and a wrongly recorded licence is the most damaging thing this derivation could do — it is reported as
  // found instead (see rejectedFields).
  if (statements.license?.declared) {
    add(LICENSE_KEY, [statements.license.key], 'license', 'stated',
      `Lizenz, die die Seite auszeichnet (${statements.license.source})`);
    add(LICENSE_VERSION_FIELD, [statements.license.version], 'license', 'stated',
      'Lizenzversion aus derselben Auszeichnung');
  }
  return fields;
}

/**
 * The fields derived *from* the page rather than stated by it — offered as proposals. Only for properties
 * the page states nothing for: `settled` names those, and a derivation for one of them is dropped, because
 * a property cannot be a value and a proposal at once (see the module comment).
 */
export function inferredFields(
  statements: PageStatements,
  settled: readonly string[],
  keywords: readonly string[] = [],
): DerivedField[] {
  const fields: DerivedField[] = [];
  const held = new Set(settled);

  if (!held.has('cclom:general_keyword')) {
    const fromNav = statements.keywords
      .filter((keyword) => keyword.source === 'nav')
      .map((keyword) => keyword.value);
    const proposed = [...fromNav, ...keywords].filter(
      (value, index, all) => all.indexOf(value) === index,
    );
    if (proposed.length) {
      fields.push({
        property: 'cclom:general_keyword',
        values: proposed,
        source: fromNav.length ? 'nav' : 'text',
        standing: 'inferred',
        evidence: fromNav.length
          ? 'Aus der Einordnung der Seite und ihrem Text gewonnen'
          : 'Aus dem Text der Seite gewonnen'
      });
    }
  }

  if (!held.has('cclom:general_description')) {
    const paragraph = firstParagraph(statements.contentText);
    if (paragraph) {
      fields.push({
        property: 'cclom:general_description',
        values: [paragraph],
        source: 'text',
        standing: 'inferred',
        evidence: 'Erster Absatz der Seite — die Seite gibt selbst keine Beschreibung an'
      });
    }
  }

  return fields;
}

/** What was found on the page and deliberately not written, with the reason. */
export function rejectedFields(statements: PageStatements): RejectedField[] {
  const rejected: RejectedField[] = [];
  if (statements.license && !statements.license.declared) {
    rejected.push({
      property: LICENSE_KEY,
      values: [statements.license.key],
      reason: `nur im Seitentext belegt (${statements.license.source}), nicht als Lizenz der Seite ausgezeichnet`
    });
  }
  return rejected;
}

/**
 * The fields with one entry per property: the first mention wins, and a later one of the same property is
 * dropped. That is what makes the order the caller assembles them in the whole precedence rule.
 */
export function mergeDerived(fields: readonly DerivedField[]): DerivedField[] {
  const merged: DerivedField[] = [];
  const held = new Set<string>();
  for (const field of fields) {
    if (held.has(field.property)) continue;
    held.add(field.property);
    merged.push(field);
  }
  return merged;
}

/**
 * The merged fields as a payload contribution. `stated` fields become plain values and carry no origin —
 * `fieldOrigins` then marks them as decided, which is what a declared licence or description is. `inferred`
 * fields are marked `'page'`, which is what turns them into pending proposals in the widgets: they are
 * written to the repository's suggestion store like a model's (`proposedFieldsOf` →
 * `aiSuggestionRequests`), and `aiSuggestionsFor` builds the same offer in memory for a store that
 * answers nothing.
 *
 * `capable` says whether a property's widget can show a proposal at all. One that cannot would swallow the
 * offer silently, so the field is dropped and reported rather than quietly promoted to a value: a proposal
 * that does not render is inert, a value that was never proposed is a claim.
 */
export function derivedPayload(
  fields: readonly DerivedField[],
  rejected: readonly RejectedField[] = [],
  capable: (property: string) => boolean = () => true,
): DerivedPayload {
  const values: Record<string, unknown> = {};
  const origins: Record<string, 'page'> = {};
  const kept: DerivedField[] = [];
  const refused = [...rejected];
  for (const field of mergeDerived(fields)) {
    if (field.standing === 'inferred' && !capable(field.property)) {
      refused.push({
        property: field.property,
        values: field.values,
        reason: 'im Formular nicht als Vorschlag anzeigbar'
      });
      continue;
    }
    values[field.property] = field.values;
    if (field.standing === 'inferred') origins[field.property] = 'page';
    kept.push(field);
  }
  return { values, origins, report: { fields: kept, rejected: refused } };
}

/**
 * The properties where the page's own declaration outranks a generated value. The licence is the case
 * that matters: a `link[rel=license]` naming a Creative Commons address *is* the licence, while a model
 * reading the page can only infer one — and a wrong licence is the most damaging field on a node. The
 * page's statement only reaches this list where it was declared for the page itself (see `statedFields`),
 * so a licence merely mentioned in the running text never displaces a generated one.
 */
const PAGE_OUTRANKS_GENERATED: readonly string[] = [LICENSE_KEY, LICENSE_VERSION_FIELD];

/**
 * A generated payload with the page's own statements underneath it: the model's answer stands wherever it
 * answered, and what the page declares fills every field it left empty.
 *
 * That order is the point. A generated description is written for a metadata set — the length, the
 * structure, the register — while `meta[description]` is written for a search engine, so replacing the
 * former with the latter would be a downgrade. But the page states a good deal no model produces at all
 * (its publication date, an identifier, a learning time, the fields the run left to a person), and that
 * was being thrown away. {@link PAGE_OUTRANKS_GENERATED} names the few the other way round.
 *
 * `_origins` is merged along with the values, each field keeping the provenance of whichever side supplied
 * it, so the form goes on showing a generated field as a proposal and a declared one as decided.
 */
export function withPageStatements(
  generated: Record<string, unknown> | null | undefined,
  page: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const fromRun = generated ?? {};
  const fromPage = page ?? {};
  const merged: Record<string, unknown> = { ...fromPage };
  const origins: Record<string, unknown> = { ...((fromPage['_origins'] ?? {}) as object) };
  const runOrigins = (fromRun['_origins'] ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(fromRun)) {
    if (key === '_origins') continue;
    if (!hasValue(value)) continue;
    if (PAGE_OUTRANKS_GENERATED.includes(key) && hasValue(fromPage[key])) continue;
    merged[key] = value;
    // The provenance travels with the value it is about, and only with it: a field the page supplied
    // must not carry the run's marking, or a declared licence would read as a machine's proposal.
    if (runOrigins[key] !== undefined) origins[key] = runOrigins[key];
    else delete origins[key];
  }
  if (Object.keys(origins).length) merged['_origins'] = origins;
  return merged;
}

/** Whether a property value says anything — an empty list and a blank string do not. */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => hasValue(entry));
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * The page's own vocabulary words, as they travel until a metadata set can resolve them. An envelope key,
 * so it is neither rendered as a metadata field nor able to reach a widget — `toMdsEditorValues` keeps only
 * namespaced keys.
 */
export function pageTermsEnvelope(terms: PageTerms): Record<string, unknown> {
  const stated = Object.entries(terms).filter(([, values]) => values.length);
  return stated.length ? { [PAGE_TERMS_KEY]: Object.fromEntries(stated) } : {};
}

/** The page terms out of a payload, in the shape {@link pageTermsEnvelope} put them in. */
export function pageTermsOf(payload: Record<string, unknown> | null | undefined): Partial<PageTerms> {
  const stated = payload?.[PAGE_TERMS_KEY];
  return stated && typeof stated === 'object' ? (stated as Partial<PageTerms>) : {};
}

/** How long a paragraph has to be to describe anything, and how much of one is a description. */
const PARAGRAPH_MIN = 80;
const PARAGRAPH_MAX = 600;

/**
 * The first block of the page's text that reads like prose: long enough to say something, and with a
 * sentence in it. Everything shorter is a menu, a caption or a breadcrumb, of which a page has many before
 * its content starts.
 */
function firstParagraph(text: string): string | null {
  for (const block of (text ?? '').split(/\n\s*\n|\n/)) {
    const line = block.replace(/\s+/g, ' ').trim();
    if (line.length < PARAGRAPH_MIN || !/[.!?]/.test(line)) continue;
    return line.length > PARAGRAPH_MAX ? `${line.slice(0, PARAGRAPH_MAX).trimEnd()}…` : line;
  }
  return null;
}

/** How a source is named where a person reads it. */
function sourceLabel(source: DerivationSource): string {
  switch (source) {
    case 'meta': return 'Meta-Tags';
    case 'og': return 'Open Graph';
    case 'twitter': return 'Twitter-Card';
    case 'dc': return 'Dublin Core';
    case 'lrmi': return 'LRMI';
    case 'jsonld': return 'schema.org';
    case 'license': return 'Lizenzangabe';
    case 'semantic': return 'Seitenauszeichnung';
    case 'nav': return 'Einordnung der Seite';
    case 'url': return 'Adresse';
    case 'text': return 'Seitentext';
    case 'website-info': return 'Lesung des Repositories';
    case 'valuespace': return 'Vokabular des Metadatensatzes';
  }
}
