// The KI quality check as something the assistant can be held to: the criteria of the metadata set as a task
// and a result schema, and its answer back as the properties a criterion is recorded in. The point of going
// through a schema is that the dialogue ends in the same record the structured check produces — a prose answer
// about a content is not a quality check, however good it reads.
//
// The assistant fills the schema with `submit_result`; the schema's `description` texts travel verbatim into
// that tool's parameters and are read by the model as instructions, which is why they are written as such.

import type { MdsDefinition, MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import type { CriteriaProperties } from '../features/quality/quality-criteria/quality-criteria.component';
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
 * The task the check runs on.
 *
 * It says four things, and each of them had to be said.
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
 */
export function instructionOf(
  criteria: readonly QualityCriterion[],
  subject: CheckSubject
): string {
  const { title, url, collection } = subject;
  const text = subject.text.trim();
  const named = title ? `den Inhalt „${title}“` : 'den Inhalt der aktuellen Seite';
  const head = [
    collection
      ? `Prüfe ${named} anhand der Anforderungen der Sammlung „${collection}“.`
      : `Prüfe die Qualität von ${named}.`,
    'Gemeint ist genau dieser eine Inhalt. Beurteile NICHT die übrigen Inhalte der Sammlung und nicht die ' +
      'Sammlung als Ganzes.',
    collection
      ? 'Hol dir zuerst die für die Sammlung freigegebene Anleitung (get_skill_registry, dann get_skill) ' +
        'und halte dich an sie, falls eine dabei ist.'
      : '',
    '',
    'Beurteile jedes dieser Kriterien einzeln:',
    criteria.map((item) => `${item.key}: ${item.caption}`).join('\n'),
    '',
    'Gib das Ergebnis strukturiert zurück — zu jedem Kriterium erfuellt und begruendung. Rate nicht: wo der ' +
      'Inhalt nichts hergibt, ist das Kriterium nicht erfüllt, und die Begründung sagt ausdrücklich, dass es ' +
      'nicht prüfbar war.',
    'Schreibe das Ergebnis AUSSERDEM in deine Antwort im Chat: je Kriterium eine Zeile mit ✓ oder ✗, dem ' +
      'Namen des Kriteriums und dem Grund in einem Satz, darunter ein kurzes Fazit, was der Freigabe im Weg ' +
      'steht. Die Person sieht nur den Chat — was dort nicht steht, erfährt sie nicht.',
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
