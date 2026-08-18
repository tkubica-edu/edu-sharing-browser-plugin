// The KI quality check as something the assistant can be held to: the criteria of the metadata set as a task
// and a result schema, and its answer back as the properties a criterion is recorded in. The point of going
// through a schema is that the dialogue ends in the same record the structured check produces — a prose answer
// about a content is not a quality check, however good it reads.
//
// The assistant fills the schema with `submit_result`; the schema's `description` texts travel verbatim into
// that tool's parameters and are read by the model as instructions, which is why they are written as such.

import type { MdsDefinition, MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import type { CriteriaProperties } from '../features/quality/quality-criteria/quality-criteria.component';
import { EXTENDED_TYPE_FIELD, LRT_FIELD } from './agent-payload';
import type { MdsValues } from './mds-values';
import {
  CRITERION_MET, CRITERION_VIOLATED, EDITORIAL_CRITERIA_PROPERTY, KNOCKOUT_CRITERIA_WIDGET, autoMetValue,
  valueFor, widgetOf
} from './quality-criteria-values';

/**
 * How much of a schema the backend accepts (`result-schema`, 10 000 characters); beyond it the request is
 * refused outright rather than half applied. Ours is far below it — this is what says so, and what makes an
 * unexpectedly long list of criteria a reported problem instead of a chat that silently answers nothing.
 */
const SCHEMA_MAX = 10_000;

/**
 * How long the request put to the assistant may be (`ChatRequest.message`, 10 000 characters). The content
 * travels inside it, so this is what the quoted text is cut to fit.
 */
const TASK_MAX = 10_000;

/** One criterion the assistant is to judge, as the metadata set defines it. */
export interface QualityCriterion {
  /**
   * What the criterion is called in the schema — `k1`, `k2`, … The criteria's own ids are node properties and
   * vocabulary URIs; as schema keys they would spend the budget on addresses the model has no use for, and the
   * answer is mapped back by this key anyway.
   */
  key: string;
  /** The id the answer is recorded under: the node property (knock-out) or the vocabulary value (editorial). */
  id: string;
  /** What the criterion is called on screen — the whole of what the assistant judges by. */
  caption: string;
  /**
   * Which list it belongs to. Only the knock-out ones gate the confirmation, and the two are recorded in
   * opposite ways — one property each against one shared property of met ids.
   */
  kind: 'knockout' | 'editorial';
}

/** The assistant's answer about one criterion. */
export interface CriterionVerdict {
  criterion: QualityCriterion;
  met: boolean;
  /** Why, in the assistant's own words; empty where it gave none. */
  reason: string;
}

/** What the assistant answered as a whole — see {@link verdictsOf}. */
export interface QualityCheckResult {
  verdicts: readonly CriterionVerdict[];
  /** Its summary over all criteria, empty where it gave none. */
  summary: string;
}

/** The criteria of a metadata set, knock-out ones first, in the order the set lists them. */
export function criteriaOf(mds: MdsDefinition | null | undefined): readonly QualityCriterion[] {
  const knockout = valuesOf(mds, KNOCKOUT_CRITERIA_WIDGET);
  const editorial = valuesOf(mds, EDITORIAL_CRITERIA_PROPERTY);
  return [
    ...knockout.map((value, index) => criterion(value, index, 'knockout')),
    ...editorial.map((value, index) => criterion(value, knockout.length + index, 'editorial'))
  ];
}

/**
 * The shape the assistant has to answer in: one entry per criterion, each a verdict with its reasoning. An
 * object with every key required rather than a list, because a list invites an answer about the criteria that
 * were easy to judge — and a check that quietly skipped half of them reads exactly like a complete one.
 */
export function resultSchemaOf(criteria: readonly QualityCriterion[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const item of criteria) {
    properties[item.key] = {
      type: 'object',
      description: item.caption,
      properties: {
        erfuellt: {
          type: 'boolean',
          description:
            'true, wenn der Inhalt dieses Kriterium erfüllt. Im Zweifel false — ein Kriterium gilt als ' +
            'erfüllt nur, wenn der Inhalt es belegt.'
        },
        begruendung: {
          type: 'string',
          description:
            'Ein bis zwei Sätze, worauf sich das Urteil stützt. Nenne die Stelle im Inhalt, und wo die ' +
            'Anleitung der Sammlung etwas zu diesem Kriterium sagt, beziehe dich darauf.'
        }
      },
      required: ['erfuellt', 'begruendung']
    };
  }
  return {
    type: 'object',
    description: 'Das Ergebnis der Qualitätsprüfung: zu jedem Kriterium ein Urteil mit Begründung.',
    properties: {
      kriterien: {
        type: 'object',
        description: 'Zu jedem Kriterium genau ein Urteil. Kein Kriterium darf fehlen.',
        properties,
        required: criteria.map((item) => item.key)
      },
      zusammenfassung: {
        type: 'string',
        description: 'Zwei bis drei Sätze: Was steht der Freigabe im Weg, und was wäre als Nächstes zu tun?'
      }
    },
    required: ['kriterien']
  };
}

/**
 * The three vocabularies a value is looked up in, by what they classify. Named in the task and in the schema
 * alike: a value formed from memory does not fail loudly — a guessed URI simply matches nothing.
 */
const VOCABULARIES = {
  fach: 'discipline',
  bildungsstufe: 'educationalContext',
  materialtyp: 'lrt'
} as const;

/** What the enrichment answered; every field empty where the content did not give it. */
export interface EnrichedMetadata {
  fach: VocabularyValue;
  bildungsstufe: VocabularyValue;
  materialtyp: VocabularyValue;
  schlagworte: readonly string[];
}

/** One value from a WLO vocabulary: what it is called, and the URI that is the actual filter value. */
export interface VocabularyValue {
  label: string;
  uri: string;
}

/** The whole of what a check produced: what the content is worth, and what it is about. */
export interface CheckOutcome {
  verdicts: readonly CriterionVerdict[];
  summary: string;
  metadata: EnrichedMetadata | null;
}

/**
 * The shape the enrichment is answered in. Every field required, none of them allowed to be invented: a
 * field the content does not give is answered empty, which is a statement, while a missing field would be
 * indistinguishable from one the assistant forgot.
 */
export function enrichmentSchemaOf(): Record<string, unknown> {
  const value = (what: string, vocabulary: string) => ({
    type: 'object',
    description: `${what}, aus dem Vokabular „${vocabulary}“.`,
    properties: {
      label: { type: 'string', description: `Die Bezeichnung, wie sie im Vokabular steht. Leer, wenn der Inhalt ${what.toLowerCase()} nicht hergibt.` },
      uri: { type: 'string', description: 'Die vollständige URI des Eintrags, wie lookup_wlo_vocabulary sie zurückgibt. Niemals selbst gebildet — leer, wenn keine nachgeschlagen wurde.' }
    },
    required: ['label', 'uri']
  });
  return {
    type: 'object',
    description: 'Die angereicherten Metadaten des Inhalts, jeder Wert aus dem vorgegebenen Vokabular.',
    properties: {
      fach: value('Das Schulfach', VOCABULARIES.fach),
      bildungsstufe: value('Die Bildungsstufe', VOCABULARIES.bildungsstufe),
      materialtyp: value('Der Materialtyp', VOCABULARIES.materialtyp),
      schlagworte: {
        type: 'array',
        description: 'Schlagworte, mit denen der Inhalt gefunden werden soll. Fünf bis zehn, aus dem Inhalt selbst.',
        items: { type: 'string' }
      }
    },
    required: ['fach', 'bildungsstufe', 'materialtyp', 'schlagworte']
  };
}

/**
 * The check's second task, put once the first has answered: enrich the metadata of the content that was just
 * judged — *Metadaten anreichern*, the step's name in the editorial process this panel serves.
 *
 * A task of its own rather than a second half of the first, because the two ask different things of the run.
 * The judgement reads the content and the collection's instruction; the enrichment looks values up in three
 * vocabularies. Asked together they compete for the same iteration and token caps, and the answer that
 * suffers is whichever the model reaches last. Asked in turn, each gets its own run, its own schema, and the
 * enrichment starts from a content whose quality is already established.
 *
 * It asks for the collection's instruction again, and softly: a skill for the enrichment may or may not be
 * released, and one that is not there yet must not read as a step that failed. Where one appears it takes
 * precedence over everything the model would do on its own, so asking costs nothing and gains the whole
 * editorial convention the day it exists.
 *
 * It does not repeat the content: the conversation is the same one, and what was quoted in the first task is
 * still in it.
 *
 * It ends the way the first task does — proposed in the chat, confirmed by the person, submitted only then —
 * and with the one sentence that says the check is through: both steps are done, and the panel's footer is
 * where it is closed.
 */
export function enrichmentInstructionOf(subject: CheckSubject): string {
  // Dative: it reads "… die Metadaten VON <named> an".
  const named = subject.title ? `„${subject.title}“` : 'diesem Inhalt';
  return [
    `Zweiter Schritt: Reichere jetzt die Metadaten von ${named} an — demselben Inhalt, den du gerade ` +
      'geprüft hast. Der Schritt ist fertig, wenn die Person deine Werte bestätigt hat.',
    ...(subject.collection
      ? [
          'Falls die Sammlung für das Anreichern von Metadaten eine Anleitung freigegeben hat, hol sie dir ' +
            '(get_skill_registry, dann get_skill) und halte dich an sie. Gibt es dazu keine, reichere nach ' +
            'den folgenden Vorgaben an.'
        ]
      : []),
    `Hol dir Fach, Bildungsstufe und Materialtyp aus den vorgegebenen Vokabularen: lookup_wlo_vocabulary mit ` +
      `vocabulary="${VOCABULARIES.fach}", "${VOCABULARIES.bildungsstufe}" und "${VOCABULARIES.materialtyp}". ` +
      'Gib zu jedem Wert die Bezeichnung UND die vollständige URI an, wie das Vokabular sie zurückgibt.',
    'Bilde keine URI selbst — eine geratene trifft still nichts. Gibt der Inhalt einen Wert nicht her, lass ' +
      'ihn leer, statt zu raten.',
    'Nenne dazu fünf bis zehn Schlagworte aus dem Inhalt selbst.',
    '',
    'Nenne die Werte zuerst im Chat, je Wert eine Zeile mit Bezeichnung und URI, darunter die Schlagworte. ' +
      'Die Person sieht nur den Chat.',
    'Bitte sie danach ausdrücklich, die Werte durchzugehen und zu bestätigen oder zu korrigieren. Führe sie ' +
      'zu dieser Bestätigung: frag direkt, ob die Metadaten so übernommen werden sollen.',
    'Rufe submit_result ERST auf, wenn sie bestätigt hat — mit ihren Korrekturen, falls sie welche hatte. ' +
      'Ohne diesen Aufruf ist das Ergebnis für uns nicht da, auch wenn es im Chat steht.',
    'Sag ihr danach, dass beide Schritte erledigt sind und sie unten im Panel mit „Abschließen und zur ' +
      'Inhaltsübersicht“ fertig wird.'
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

/** What the enrichment answered; null where the turn submitted nothing usable. */
export function enrichmentOf(result: unknown): EnrichedMetadata | null {
  const answer = asRecord(result);
  if (!answer) return null;
  const value = (key: string): VocabularyValue => {
    const entry = asRecord(answer[key]);
    return {
      label: typeof entry?.['label'] === 'string' ? entry['label'].trim() : '',
      uri: typeof entry?.['uri'] === 'string' ? entry['uri'].trim() : ''
    };
  };
  const keywords = Array.isArray(answer['schlagworte'])
    ? answer['schlagworte'].filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
    : [];
  const metadata: EnrichedMetadata = {
    fach: value('fach'),
    bildungsstufe: value('bildungsstufe'),
    materialtyp: value('materialtyp'),
    schlagworte: keywords.map((entry) => entry.trim())
  };
  // Nothing at all is not an enrichment: an answer about a different question would otherwise be recorded
  // as one whose every field happened to be empty.
  const stated =
    metadata.fach.label ||
    metadata.bildungsstufe.label ||
    metadata.materialtyp.label ||
    metadata.schlagworte.length;
  return stated ? metadata : null;
}

/** The property a content's keywords are held in — plain words, not values of a vocabulary. */
const KEYWORD_PROPERTY = 'cclom:general_keyword';

/**
 * Where an enriched value is recorded, and what it has to be to go there. Each of these properties holds the
 * values of exactly one WLO vocabulary, so it is the vocabulary the URI came out of that decides the property
 * — not the field it was answered under. *Materialtyp* is the case that makes the difference: asked for `lrt`,
 * `lookup_wlo_vocabulary` answers out of `new_lrt` or out of the aggregated `new_lrt_aggregated`, and on the
 * node those are two separate fields. A URI from any other vocabulary is not recorded at all: it would sit in
 * a field whose valuespace does not contain it, where the editor shows a blank and no search finds it.
 */
const ENRICHED_PROPERTIES: readonly {
  field: 'fach' | 'bildungsstufe' | 'materialtyp';
  vocabulary: string;
  property: string;
}[] = [
  { field: 'fach', vocabulary: 'discipline', property: 'ccm:taxonid' },
  { field: 'bildungsstufe', vocabulary: 'educationalContext', property: 'ccm:educationalcontext' },
  { field: 'materialtyp', vocabulary: 'new_lrt', property: LRT_FIELD },
  { field: 'materialtyp', vocabulary: 'new_lrt_aggregated', property: EXTENDED_TYPE_FIELD }
];

/**
 * The enriched metadata as the node properties it is written to, so what the person confirmed in the chat
 * reaches the content instead of the console. Recorded, not saved: they travel with the next write, which is
 * the confirmation this step ends in.
 *
 * The vocabulary values are stated as the URI alone, since that *is* the value a vocabulary property holds —
 * a label is what the editor renders from it. Only a URI that came out of the expected vocabulary is taken;
 * one the assistant formed itself does not fail loudly, it simply matches nothing.
 *
 * The keywords are added to those already on the content rather than put in their place. They come from the
 * same reading of the same text as the ones the extraction proposed, and the two lists overlap without being
 * the same; replacing would drop the difference, which is what a second pair of eyes was for.
 */
export function enrichmentPropertiesOf(
  metadata: EnrichedMetadata,
  recorded: Record<string, unknown> | null
): MdsValues {
  const properties: MdsValues = {};
  for (const { field, vocabulary, property } of ENRICHED_PROPERTIES) {
    const uri = metadata[field].uri;
    if (uri.includes(`/vocabs/${vocabulary}/`)) properties[property] = [uri];
  }
  const kept = new Map<string, string>();
  // Standing first, so a keyword both lists hold stays in the spelling the content already carries.
  for (const keyword of [...asList(recorded?.[KEYWORD_PROPERTY]), ...metadata.schlagworte]) {
    const word = keyword.trim();
    if (word && !kept.has(word.toLowerCase())) kept.set(word.toLowerCase(), word);
  }
  if (kept.size) properties[KEYWORD_PROPERTY] = [...kept.values()];
  return properties;
}

/** Whether a schema fits what the backend accepts — see {@link SCHEMA_MAX}. */
export function schemaFits(schema: Record<string, unknown>): boolean {
  return JSON.stringify(schema).length <= SCHEMA_MAX;
}

/** The content a check is about, as the task has to describe it. */
export interface CheckSubject {
  /** What the content is called. */
  title: string | null;
  /** What it says — the text the panel holds for it; empty where it holds none. */
  text: string;
  /** Where it came from, so the assistant can read the rest itself. */
  url: string | null;
  /** The collection whose requirements it is measured against. */
  collection: string | null;
}

/**
 * The first of the check's two tasks: judge the content against the criteria. The enrichment follows in a
 * task of its own, once this one has answered — see {@link enrichmentInstructionOf}.
 *
 * Six things it says, each of which had to be said.
 *
 * **What is being judged**: the one content, and expressly not the other contents of its collection — a
 * collection in the context invites exactly that confusion, and the assistant then reports on a stock nobody
 * asked about.
 *
 * **What it says**: the content's own text, quoted in full inside the task. This is not redundant with the
 * page context. The assistant's backend renders the page context from whatever it could resolve about the
 * node, and the block that would carry the text the panel holds is read **only where nothing resolved at
 * all** — so the better the node resolves, the more surely the text is dropped. The result is a check that
 * knows the content's title, licence and thumbnail, and answers every single criterion with "der vollständige
 * Text war nicht abrufbar". The request itself is the one channel that always reaches the model.
 *
 * **How to get the rest**: the address, where the text is missing or had to be cut. Reading it is something
 * the assistant can do, and doing it beats declaring twelve criteria unprovable.
 *
 * **What to judge it by**: the collection's released instruction, fetched outright, because the prompt carries
 * the titles of a collection's skills but no ids and an unspecific task lets the model answer from memory.
 *
 * **Where it is read**: in the chat as well as in the schema. Nothing can put a message into that conversation
 * from outside, so the assistant is asked to write the result there itself — the person sees only the chat.
 *
 * **Who ends the step**: the person, and the assistant is told to bring them to it. The judgement goes into
 * the chat first, then the assistant asks them to go through it and confirm or correct it, and only their
 * confirmation releases `submit_result` — which is what carries the check on to its second step. The
 * assistant is the one thing on this screen that can talk, so leading through the two steps is its part.
 */
export function qualityInstructionOf(
  criteria: readonly QualityCriterion[],
  subject: CheckSubject
): string {
  const { title, url, collection } = subject;
  const text = subject.text.trim();
  // Dative: the one place it is used reads "… bei der Erschließung VON <named>".
  const named = title ? `dem Inhalt „${title}“` : 'dem Inhalt der aktuellen Seite';
  const forCollection = collection ? ` für die Sammlung „${collection}“` : '';
  const head = [
    `Bewerte die Qualität von ${named}${forCollection}.`,
    'Gemeint ist genau dieser eine Inhalt. Beurteile NICHT die übrigen Inhalte der Sammlung und nicht die ' +
      'Sammlung als Ganzes.',
    'Das ist der erste von zwei Schritten; der zweite ist das Anreichern der Metadaten. Der Schritt ist ' +
      'fertig, wenn die Person deine Bewertung durchgegangen ist und sie bestätigt hat.',
    collection
      ? 'Hol dir dazu zuerst die für die Sammlung freigegebene Anleitung (get_skill_registry, dann ' +
        'get_skill) und halte dich an sie, falls eine dabei ist.'
      : '',
    '',
    'Beurteile jedes dieser Kriterien einzeln:',
    criteria.map((item) => `${item.key}: ${item.caption}`).join('\n'),
    'Rate nicht: wo der Inhalt nichts hergibt, ist das Kriterium nicht erfüllt, und die Begründung sagt ' +
      'ausdrücklich, dass es nicht prüfbar war.',
    '',
    'Schreib dein Urteil zuerst in den Chat: je Kriterium eine Zeile mit ✓ oder ✗, dem Namen des Kriteriums ' +
      'und dem Grund in einem Satz, darunter ein kurzes Fazit, was einer Freigabe im Weg steht. Die Person ' +
      'sieht nur den Chat — was dort nicht steht, erfährt sie nicht.',
    'Bitte sie danach ausdrücklich, dein Urteil durchzugehen und zu bestätigen oder zu korrigieren. Führe sie ' +
      'zu dieser Bestätigung: frag direkt, ob es so stehen bleiben soll, und geh auf ihre Einwände ein.',
    'Rufe submit_result ERST auf, wenn sie bestätigt hat — vorher nicht, auch wenn dein Urteil längst fertig ' +
      'ist.',
    'Sobald sie bestätigt: Rufe submit_result in genau diesem Zug auf, mit ihren Korrekturen, falls sie welche ' +
      'hatte, und zu jedem Kriterium erfuellt und begruendung. Eine Bestätigung im Chat allein reicht nicht — ' +
      'ohne diesen Werkzeugaufruf ist das Ergebnis für uns nicht da und es geht nicht weiter. Sag ihr dann, ' +
      'dass der zweite Schritt folgt: die Metadaten anreichern.',
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
  return head + contentBlock(text, url, TASK_MAX - head.length);
}

/**
 * The content itself, appended to the task and cut to what is left of the request's length. Where there is no
 * text — a node this session did not erschließen states none — the address stands in its place, since the
 * assistant can read it and a check made on a title alone is worthless.
 */
function contentBlock(text: string, url: string | null, room: number): string {
  const source = url ? `\nDie Seite dazu: ${url}` : '';
  if (!text) {
    return (
      '\nDer Volltext dieses Inhalts liegt hier nicht vor.' +
      source +
      (url
        ? '\nHol ihn dir mit get_url_text von dieser Adresse, bevor du urteilst. Erst wenn auch das nichts ' +
          'hergibt, gilt ein Kriterium mangels Text als nicht prüfbar.'
        : '\nBeurteile, was der Seitenkontext hergibt, und sag bei jedem Kriterium ausdrücklich, wenn es ' +
          'mangels Text nicht prüfbar war.')
    );
  }
  const opening = '\nHier ist der Inhalt im Wortlaut:\n---\n';
  const closing = '\n---';
  const budget = room - opening.length - closing.length - source.length - 200;
  const fits = text.length <= budget;
  const quoted = fits ? text : text.slice(0, Math.max(budget, 0));
  return (
    opening +
    quoted +
    closing +
    source +
    (fits
      ? ''
      : '\nDieser Wortlaut ist abgeschnitten.' +
        (url ? ' Den vollständigen Text bekommst du mit get_url_text von der Adresse oben.' : ''))
  );
}

/**
 * What the assistant answered, read out of the result it submitted. Defensive throughout: `result` comes from
 * another project through a schema that constrains but does not guarantee, and an entry without a boolean
 * verdict states nothing — it is dropped rather than read as "not met", which would record an objection
 * nobody raised.
 */
export function verdictsOf(
  result: unknown,
  criteria: readonly QualityCriterion[]
): QualityCheckResult {
  const answer = asRecord(result);
  const answered = asRecord(answer?.['kriterien']);
  const verdicts: CriterionVerdict[] = [];
  for (const criterion of criteria) {
    const entry = asRecord(answered?.[criterion.key]);
    const met = entry?.['erfuellt'];
    if (typeof met !== 'boolean') continue;
    const reason = entry?.['begruendung'];
    verdicts.push({ criterion, met, reason: typeof reason === 'string' ? reason.trim() : '' });
  }
  const summary = answer?.['zusammenfassung'];
  return { verdicts, summary: typeof summary === 'string' ? summary.trim() : '' };
}

/**
 * The verdicts as the properties they are recorded in — the same record the structured check writes, so a
 * content checked either way carries its answers in the same place.
 *
 * A met knock-out criterion is recorded as the machine's all-clear where its valuespace states one, exactly as
 * a judge's finding is: the assistant is a machine, and a box that claimed a person's confirmation would say
 * more than happened. Where the vocabulary holds no value for what a verdict means, nothing is recorded for
 * that criterion — an unanswered criterion is the honest result, and it holds the confirmation back.
 */
export function criteriaPropertiesOf(
  verdicts: readonly CriterionVerdict[],
  widgets: readonly MdsWidget[] | undefined,
  recorded: Record<string, unknown> | null
): CriteriaProperties {
  const properties: CriteriaProperties = {};
  const editorial = new Set(asList(recorded?.[EDITORIAL_CRITERIA_PROPERTY]));
  let editorialTouched = false;
  for (const { criterion, met } of verdicts) {
    if (criterion.kind === 'editorial') {
      editorialTouched = true;
      if (met) editorial.add(criterion.id);
      else editorial.delete(criterion.id);
      continue;
    }
    const widget = widgetOf(widgets, criterion.id);
    const value = met
      ? autoMetValue(widget) ?? valueFor(widget, CRITERION_MET)
      : valueFor(widget, CRITERION_VIOLATED);
    if (value) properties[criterion.id] = [value];
  }
  if (editorialTouched) properties[EDITORIAL_CRITERIA_PROPERTY] = [...editorial];
  return properties;
}

/**
 * Whether the verdicts clear the way for the confirmation: every knock-out criterion judged, and judged met.
 * A criterion the assistant did not answer holds it back — the confirmation states that the criteria were
 * looked at, and an unanswered one was not.
 */
export function knockoutSatisfied(
  verdicts: readonly CriterionVerdict[],
  criteria: readonly QualityCriterion[]
): boolean {
  const knockout = criteria.filter((criterion) => criterion.kind === 'knockout');
  if (!knockout.length) return false;
  return knockout.every((criterion) =>
    verdicts.some((verdict) => verdict.criterion.id === criterion.id && verdict.met)
  );
}

/** The values of a set's widget — the criteria of one of the two lists. */
function valuesOf(mds: MdsDefinition | null | undefined, widget: string): readonly MdsValue[] {
  return widgetOf(mds?.widgets, widget)?.values ?? [];
}

function criterion(value: MdsValue, index: number, kind: QualityCriterion['kind']): QualityCriterion {
  return { key: `k${index + 1}`, id: value.id, caption: value.caption || value.id, kind };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A property value of unknown shape as the `string[]` the criteria are recorded in. */
function asList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry));
}
