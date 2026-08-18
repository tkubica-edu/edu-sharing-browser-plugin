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
 * How long the request put to the assistant may be. The content travels inside it, so this is what the quoted
 * text is cut to fit.
 *
 * A bound of our own, not the API's: the instruction is handed over as `host_instruction` in the request's
 * environment (see AiAssistantScreenComponent), and that field is declared without a length limit — the
 * 10 000-character cap the chat endpoint enforces applies to the visible `message`, which here is a few words.
 * What the bound protects is the prompt the model reads: the whole instruction goes into it, beside the page
 * context and the conversation so far.
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

/**
 * The three answers a criterion can get, as the schema states them. Two of them are a judgement; the third is
 * the absence of one, and it is offered on purpose — a check that may only say yes or no answers no wherever
 * the content is silent, which reads as a finding about the content instead of one about the check.
 */
const OUTCOMES = {
  erfolgreich: true,
  probleme: false,
  unklar: null
} as const satisfies Record<string, boolean | null>;

/** The assistant's answer about one criterion. */
export interface CriterionVerdict {
  criterion: QualityCriterion;
  /**
   * Whether the content meets it — `null` where the check could not decide it. Nothing is recorded for such a
   * criterion, and it holds the confirmation back just as an unanswered one does: a value written from a
   * verdict nobody could reach would be a claim the check never made.
   */
  met: boolean | null;
  /** Why, in the assistant's own words; empty where it gave none. */
  reason: string;
}

/** What the assistant answered as a whole — see {@link verdictsOf}. */
export interface QualityCheckResult {
  verdicts: readonly CriterionVerdict[];
  /** Its summary over all criteria, empty where it gave none. */
  summary: string;
  /**
   * Whether it holds the content fit for use in education — its judgement over all criteria together, and
   * the one place where what a collection's instruction checks beyond them can be stated at all. `null`
   * where the turn did not say: a criteria list we do not hold a field for is what this answers, so a
   * missing one must not read as "unfit".
   */
  suitable: boolean | null;
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
 *
 * The verdict is one of three words rather than a yes-or-no, so that a criterion the content does not settle
 * has an answer of its own — see {@link OUTCOMES}. Every criterion is still answered; what changes is that
 * "I cannot tell" is one of the answers instead of being pressed into "not met".
 */
export function resultSchemaOf(criteria: readonly QualityCriterion[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const item of criteria) {
    properties[item.key] = {
      type: 'object',
      description: item.caption,
      properties: {
        ergebnis: {
          type: 'string',
          enum: Object.keys(OUTCOMES),
          description: 'Das Urteil zu diesem Kriterium.'
        },
        begruendung: {
          type: 'string',
          description:
            'Ein bis zwei Sätze, worauf sich das Urteil stützt. Nenne die Stelle im Inhalt, und wo die ' +
            'Anleitung der Sammlung etwas zu diesem Kriterium sagt, beziehe dich darauf.'
        }
      },
      required: ['ergebnis', 'begruendung']
    };
  }
  return {
    type: 'object',
    description: 'Das Ergebnis der Qualitätsprüfung: zu jedem Kriterium ein Urteil mit Begründung.',
    properties: {
      kriterien: {
        type: 'object',
        description:
          'Zu jedem Kriterium genau ein Urteil. Kein Kriterium darf fehlen. Das Urteil ist eines von drei ' +
          'Worten: „erfolgreich“, wenn der Inhalt das Kriterium erfüllt, „probleme“, wenn er es verletzt, ' +
          'und „unklar“, wenn der Inhalt nichts hergibt, woran sich das entscheiden ließe — dann tragen ' +
          'wir zu diesem Kriterium nichts ein. Rate nicht: „unklar“ ist die richtige Antwort, wo du ' +
          'weder das eine noch das andere belegen kannst.',
        properties,
        required: criteria.map((item) => item.key)
      },
      geeignet: {
        type: 'boolean',
        description:
          'Dein Gesamturteil: true, wenn der Inhalt für den Einsatz in Bildung geeignet ist. Über alle ' +
          'Kriterien hinweg und einschließlich dessen, was die Anleitungen der Sammlung sonst noch prüfen ' +
          'und wofür es hier kein eigenes Kriterium gibt.'
      },
      zusammenfassung: {
        type: 'string',
        description:
          'Zwei bis drei Sätze: Was steht der Freigabe im Weg, und was wäre als Nächstes zu tun? Nenne ' +
          'hier auch, was eine Anleitung geprüft hat, wofür es kein eigenes Kriterium gibt.'
      }
    },
    required: ['kriterien', 'geeignet']
  };
}

/**
 * Whose content is being checked, as the opening question answers it. It decides one thing: whether a pass
 * over spelling and wording is worth doing. On one's own content its findings are something the person can go
 * and fix; on someone else's they are a list of complaints about a text nobody here can touch.
 */
export type ContentOrigin = 'eigen' | 'fremd';

/**
 * The shape the opening question is answered in: one word, and expressly not one the assistant works out for
 * itself. Whether a content is the person's own is not a property of its text, and a check that guessed it
 * would send half of them through a step that is not theirs.
 */
export function originSchemaOf(): Record<string, unknown> {
  return {
    type: 'object',
    description: 'Wem der Inhalt gehört — so, wie die Person es beantwortet hat.',
    properties: {
      herkunft: {
        type: 'string',
        enum: ['eigen', 'fremd'],
        description:
          '„eigen“, wenn die Person den Inhalt selbst erstellt hat oder für ihn verantwortlich ist. ' +
          '„fremd“, wenn er von jemand anderem stammt und sie ihn nur einordnet. Trag nur ein, was sie ' +
          'geantwortet hat — rate nicht und leite es nicht aus dem Inhalt ab.'
      },
      vermutung: {
        type: 'string',
        enum: ['eigen', 'fremd'],
        description:
          'Wovon du selbst ausgegangen bist, bevor die Person geantwortet hat. Ihre Antwort steht in ' +
          'herkunft und gilt — auch dann, wenn sie deiner Vermutung widerspricht.'
      }
    },
    required: ['herkunft']
  };
}

/**
 * The check's opening: greet the person, say what is about to happen, and ask the one question the rest of the
 * run turns on — is this their own content, or someone else's?
 *
 * Asked rather than derived, because nothing here knows it for certain. The panel holds who is signed in, where
 * the content came from and whom it names as its author, and those three together are usually enough to see
 * which of the two it is — but only usually: whoever checks a content is routinely neither its author nor its
 * owner, and a content can be one's own without naming one at all. So the three are handed over and the
 * assistant says what it makes of them, and then asks anyway. What the person answers is what counts; the guess
 * is there to save them a decision they mostly only have to nod at, and it is kept beside their answer so the
 * two can be compared.
 *
 * Nothing is judged in this turn. This greeting is the first thing the person sees of the whole check, and a
 * turn that read the content as well would spend its answer on findings nobody has asked for yet — so the task
 * ends at the question, and the answer is the person's to give.
 *
 * Both answers are named word for word, so that both are offered as reply chips: the widget composes those
 * from the answer the assistant just gave, and nothing outside the conversation can set them. A question of
 * two answers is the one place where that matters most — tapping one is the whole turn the person has to
 * take, and a typed answer has to be understood before it can be believed.
 */
export function originInstructionOf(subject: CheckSubject): string {
  // Accusative: it reads "… dass ihr jetzt gemeinsam <named> prüft".
  const named = subject.title ? `den Inhalt „${subject.title}“` : 'diesen Inhalt';
  return [
    `Begrüße die Person und sag ihr, dass ihr jetzt gemeinsam ${named} prüft.`,
    'Sag in einem Satz, was ansteht: erst die Qualitätsprüfung, danach das Anreichern der Metadaten. Bei ' +
      'einem eigenen Inhalt schaust du vorher noch auf Rechtschreibung und Sprache.',
    'Sag ihr dann, wovon du ausgehst, in einem Satz und mit dem Grund. Was dafür bekannt ist:',
    `- Quelle: ${subject.url ?? 'nicht bekannt'}`,
    `- als Urheber genannt: ${subject.author ?? 'niemand'}`,
    `- angemeldet ist: ${subject.signedIn ?? 'unbekannt'}`,
    'Eine fremde Website als Quelle spricht für einen fremden Inhalt; ein Urheber, der der angemeldeten ' +
      'Person entspricht, für einen eigenen. Sag ausdrücklich, dass das deine Vermutung ist.',
    'Stell ihr dann genau eine Frage: Ist das ein eigener Inhalt — von ihr selbst erstellt oder von ihr ' +
      'verantwortet — oder ein fremder, den sie nur einordnet? Ihre Antwort gilt, auch wenn sie deiner ' +
      'Vermutung widerspricht.',
    'Beende deine Nachricht mit dieser Frage und schreib dabei beide Antworten aus, in dieser Reihenfolge, ' +
      'damit sie ihr als Antwortvorschläge angeboten werden: „Inhalt selbst erstellt“ und „Fremder ' +
      'Inhalt“. Das sind Vorschläge, keine Vorgabe — sie darf auch mit eigenen Worten antworten.',
    'Beurteile in diesem Zug nichts und lies den Inhalt nicht. Es geht allein um diese Frage.',
    'Warte ihre Antwort ab. Rufe submit_result ERST auf, wenn sie geantwortet hat — mit herkunft="eigen" ' +
      'oder herkunft="fremd" und deiner Vermutung in vermutung. Setz herkunft nicht auf deine Vermutung.',
    'Ist die Antwort unklar, frag nach, statt dich selbst zu entscheiden.'
  ].join('\n');
}

/** Whose content the opening question established; null where the turn did not say. */
export function originOf(result: unknown): ContentOrigin | null {
  return originIn(asRecord(result)?.['herkunft']);
}

/**
 * What the assistant took the content for before it asked; null where it said nothing. Beside the answer, not
 * in its place: it is kept so the guess can be held against what the person actually said, which is the only
 * way to find out whether it is worth making.
 */
export function originGuessOf(result: unknown): ContentOrigin | null {
  return originIn(asRecord(result)?.['vermutung']);
}

function originIn(stated: unknown): ContentOrigin | null {
  if (typeof stated !== 'string') return null;
  const answer = stated.trim().toLowerCase();
  return answer === 'eigen' || answer === 'fremd' ? answer : null;
}

/** One place the language pass wants changed. */
export interface ProofreadFinding {
  /** The wording as it stands in the content, quoted so it can be found again. */
  passage: string;
  /** What it is to say instead. */
  correction: string;
  /** What is wrong with it — Rechtschreibung, Grammatik, Zeichensetzung, Ausdruck; empty where it said none. */
  kind: string;
}

/** What the language pass answered — see {@link proofreadOf}. */
export interface ProofreadResult {
  findings: readonly ProofreadFinding[];
  /** Its word on the text as a whole, empty where it gave none. */
  summary: string;
}

/**
 * The shape the language pass is answered in: the passages to change, each quoted and each with what it is to
 * say instead. A quoted passage is what makes a finding actionable — the person has to find the place in their
 * own text, and "einige Kommafehler" is not a place.
 *
 * The list may come back empty, and the schema says so twice over: a text with nothing to correct is the good
 * outcome, and it must not read as a step that failed to answer.
 */
export function proofreadSchemaOf(): Record<string, unknown> {
  return {
    type: 'object',
    description: 'Das Ergebnis der sprachlichen Durchsicht: jede Stelle, die zu korrigieren ist.',
    properties: {
      befunde: {
        type: 'array',
        description:
          'Eine Stelle je Eintrag, in der Reihenfolge, in der sie im Text vorkommen. Leere Liste, wenn ' +
          'sprachlich nichts zu beanstanden ist — das ist ein Ergebnis, kein fehlendes.',
        items: {
          type: 'object',
          properties: {
            stelle: {
              type: 'string',
              description: 'Der Wortlaut der Stelle, wörtlich wie im Inhalt, damit sie wiederzufinden ist.'
            },
            korrektur: { type: 'string', description: 'Wie die Stelle stattdessen lauten soll.' },
            art: {
              type: 'string',
              description: 'Was daran zu ändern ist: Rechtschreibung, Grammatik, Zeichensetzung oder Ausdruck.'
            }
          },
          required: ['stelle', 'korrektur', 'art']
        }
      },
      fazit: {
        type: 'string',
        description: 'Ein bis zwei Sätze zum Text als Ganzem: Wie steht es um Sprache und Rechtschreibung?'
      }
    },
    required: ['befunde']
  };
}

/**
 * The step that runs on one's own content and only there: read the text for spelling, grammar, punctuation and
 * wording, and name the places to change.
 *
 * Why it is bound to the answer of the opening question: a correction is worth having only where somebody can
 * carry it out. The author of a content can go and fix what this finds; whoever is filing someone else's
 * content can do nothing with a list of its typos but read it — the text is not theirs to touch, and the step
 * would cost them a turn of the dialogue for nothing.
 *
 * It quotes the content again, although the conversation has been running since the greeting: what it judges
 * is the wording itself, down to the character, and the page context the backend renders is a description of
 * the node rather than its text.
 */
export function proofreadInstructionOf(subject: CheckSubject): string {
  // Genitive: it reads "… die Sprache VON <named> durch".
  const named = subject.title ? `„${subject.title}“` : 'diesem Inhalt';
  const head = [
    `Das ist ein eigener Inhalt. Geh deshalb zuerst die Sprache von ${named} durch: Rechtschreibung, ` +
      'Grammatik, Zeichensetzung und Ausdruck. Der Schritt ist fertig, wenn die Person deine Korrekturen ' +
      'durchgegangen ist und sie bestätigt hat.',
    subject.collection
      ? 'Nutze dafür die Skills der Sammlung, die zu Sprache, Rechtschreibung oder Textqualität etwas sagen: ' +
        'hol dir mit get_skill_registry die Liste und mit get_skill jede Anleitung, die dazu passt, und halte ' +
        'dich an sie. Gibt es dazu keine, korrigiere nach den Regeln der deutschen Rechtschreibung.'
      : '',
    'Zitiere jede beanstandete Stelle wörtlich, wie sie im Text steht, und stell die Korrektur daneben. ' +
      'Erfinde keine Stelle, die dort nicht steht.',
    'Ist sprachlich nichts zu beanstanden, sag das und gib eine leere Liste ab — auch das ist ein Ergebnis.',
    'Beurteile hier noch nicht die Qualität des Inhalts, das ist der nächste Schritt.',
    '',
    'Nenne die Stellen zuerst im Chat, je Stelle eine Zeile mit dem Wortlaut und der Korrektur darunter. ' +
      'Die Person sieht nur den Chat — was dort nicht steht, erfährt sie nicht.',
    'Bitte sie danach ausdrücklich, die Korrekturen durchzugehen und zu bestätigen oder zu verwerfen. Führe ' +
      'sie zu dieser Bestätigung: frag direkt, ob die Korrekturen so stehen bleiben sollen.',
    'Beende deine Nachricht mit dieser Frage und schreib die bestätigende Antwort dabei aus, damit sie ihr ' +
      'als Antwortvorschlag angeboten werden kann: „Ich bestätige die Korrekturen.“ Das ist ein Vorschlag, keine Vorgabe — ' +
      'verlang nicht, dass sie mit genau diesem Satz antwortet.',
    'Rufe submit_result ERST auf, wenn sie bestätigt hat — mit den Stellen, die stehen bleiben. Ohne diesen ' +
      'Aufruf ist das Ergebnis für uns nicht da, auch wenn es im Chat steht.',
    'Sag ihr danach, dass als Nächstes die Qualitätsprüfung folgt.',
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
  return head + contentBlock(subject.text.trim(), subject.url, TASK_MAX - head.length);
}

/**
 * What the language pass found; null where the turn answered something else. The list is what says a pass
 * happened — an empty one is its answer, while no list at all is a turn about a different question. A finding
 * without a passage or without a correction is dropped: it names nothing the person could act on.
 */
export function proofreadOf(result: unknown): ProofreadResult | null {
  const answer = asRecord(result);
  const stated = answer?.['befunde'];
  if (!Array.isArray(stated)) return null;
  const findings: ProofreadFinding[] = [];
  for (const entry of stated) {
    const finding = asRecord(entry);
    const passage = typeof finding?.['stelle'] === 'string' ? finding['stelle'].trim() : '';
    const correction = typeof finding?.['korrektur'] === 'string' ? finding['korrektur'].trim() : '';
    if (!passage || !correction) continue;
    findings.push({
      passage,
      correction,
      kind: typeof finding?.['art'] === 'string' ? finding['art'].trim() : ''
    });
  }
  const summary = answer?.['fazit'];
  return { findings, summary: typeof summary === 'string' ? summary.trim() : '' };
}

/**
 * The vocabulary-valued fields of the enrichment: each is named after the vocabulary it is looked up in — the
 * name `lookup_wlo_vocabulary` is asked with — and carries the German the task and the schema describe it in.
 * Naming the vocabulary in both is what a value has to be looked up for: one formed from memory does not fail
 * loudly, a guessed URI simply matches nothing.
 *
 * Every one of them is a **list**, because every property they are recorded in holds one: a content can be
 * about two subjects, fit two education levels, be an Arbeitsblatt and a Video at once, and be meant for
 * teachers and learners together. `many` is what says so in the field's own terms — asked for one value, a
 * model answers one and the rest is lost before it is ever written.
 */
const VOCABULARY_FIELDS = {
  discipline: {
    what: 'Die Schulfächer, um die es im Inhalt geht',
    many: 'Oft eines, mehrere wo der Inhalt fächerübergreifend ist.'
  },
  educationalContext: {
    what: 'Die Bildungsstufen, für die der Inhalt gedacht ist',
    many: 'Mehrere, wo er über eine Stufe hinaus passt.'
  },
  lrt: {
    what: 'Die Materialtypen, die der Inhalt hat',
    many: 'Mehrere, wo er mehreres davon ist — etwa Arbeitsblatt und Video.'
  },
  intendedEndUserRole: {
    what: 'Die Zielgruppen, für die der Inhalt gedacht ist',
    many: 'Meist mehrere — etwa Lehrende und Lernende zugleich.'
  }
} as const;

/** A field the enrichment answers vocabulary values under; the field name is the vocabulary's own. */
type VocabularyField = keyof typeof VOCABULARY_FIELDS;

/** The vocabulary-valued fields, for the passes that treat all of them alike. */
const VOCABULARY_FIELD_NAMES = Object.keys(VOCABULARY_FIELDS) as readonly VocabularyField[];

/**
 * What the enrichment answered; every list empty where the content did not give it. The fields carry the names
 * of the vocabularies and of the node properties they end up in, not the German of the task.
 */
export interface EnrichedMetadata {
  discipline: readonly VocabularyValue[];
  educationalContext: readonly VocabularyValue[];
  lrt: readonly VocabularyValue[];
  intendedEndUserRole: readonly VocabularyValue[];
  keywords: readonly string[];
}

/** One value from a WLO vocabulary: what it is called, and the URI that is the actual filter value. */
export interface VocabularyValue {
  label: string;
  uri: string;
}

/** The whole of what a check produced: whose the content is, what it is worth, and what it is about. */
export interface CheckOutcome {
  origin: ContentOrigin | null;
  /** What the language pass found; null on someone else's content, where it is not run. */
  proofread: ProofreadResult | null;
  verdicts: readonly CriterionVerdict[];
  summary: string;
  suitable: boolean | null;
  metadata: EnrichedMetadata | null;
}

/**
 * The shape the enrichment is answered in: a list per vocabulary, and the keywords. Every field required, none
 * of them allowed to be invented — a field the content does not give is answered as an empty list, which is a
 * statement, while a missing field would be indistinguishable from one the assistant forgot.
 */
export function enrichmentSchemaOf(): Record<string, unknown> {
  // One entry of a vocabulary list: what it is called, and the URI that is the value itself.
  const entry = (vocabulary: string) => ({
    type: 'object',
    description: `Ein Eintrag aus dem Vokabular „${vocabulary}“.`,
    properties: {
      label: { type: 'string', description: 'Die Bezeichnung, wie sie im Vokabular steht.' },
      uri: { type: 'string', description: 'Die vollständige URI des Eintrags, wie lookup_wlo_vocabulary sie zurückgibt. Niemals selbst gebildet.' }
    },
    required: ['label', 'uri']
  });
  return {
    type: 'object',
    description: 'Die angereicherten Metadaten des Inhalts, jeder Wert aus dem vorgegebenen Vokabular.',
    properties: {
      ...Object.fromEntries(
        Object.entries(VOCABULARY_FIELDS).map(([field, { what, many }]) => [
          field,
          {
            type: 'array',
            description:
              `${what}, aus dem Vokabular „${field}“. ${many} ` +
              'Leere Liste, wenn der Inhalt nichts davon hergibt.',
            items: entry(field)
          }
        ])
      ),
      keywords: {
        type: 'array',
        description: 'Schlagworte, mit denen der Inhalt gefunden werden soll. Fünf bis zehn, aus dem Inhalt selbst.',
        items: { type: 'string' }
      }
    },
    required: [...VOCABULARY_FIELD_NAMES, 'keywords']
  };
}

/**
 * The check's last task, put once the judgement is in: enrich the metadata of the content that was just
 * judged — *Metadaten anreichern*, the step's name in the editorial process this panel serves.
 *
 * A task of its own rather than a second half of the first, because the two ask different things of the run.
 * The judgement reads the content and the collection's instruction; the enrichment looks values up in the
 * WLO vocabularies. Asked together they compete for the same iteration and token caps, and the answer that
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
    `Letzter Schritt: Reichere jetzt die Metadaten von ${named} an — demselben Inhalt, den du gerade ` +
      'geprüft hast. Der Schritt ist fertig, wenn die Person deine Werte bestätigt hat.',
    ...(subject.collection
      ? [
          'Falls die Sammlung für das Anreichern von Metadaten eine Anleitung freigegeben hat, hol sie dir ' +
            '(get_skill_registry, dann get_skill) und halte dich an sie. Gibt es dazu keine, reichere nach ' +
            'den folgenden Vorgaben an.'
        ]
      : []),
    'Hol dir Fach, Bildungsstufe, Materialtyp und Zielgruppe aus den vorgegebenen Vokabularen: ' +
      `lookup_wlo_vocabulary mit vocabulary=${askedVocabularies()}. ` +
      'Gib zu jedem Wert die Bezeichnung UND die vollständige URI an, wie das Vokabular sie zurückgibt.',
    'Jedes dieser vier Felder ist eine Liste: nenne alle zutreffenden Werte, nicht nur den ersten. Ein Fach ' +
      'ist es oft, eine Zielgruppe meist mehrere — etwa Lehrende und Lernende zugleich.',
    'Bilde keine URI selbst — eine geratene trifft still nichts. Gibt der Inhalt zu einem Feld nichts her, ' +
      'lass die Liste leer, statt zu raten.',
    'Nenne dazu fünf bis zehn Schlagworte aus dem Inhalt selbst.',
    '',
    'Nenne die Werte zuerst im Chat, je Wert eine Zeile mit Bezeichnung und URI, darunter die Schlagworte. ' +
      'Die Person sieht nur den Chat.',
    'Bitte sie danach ausdrücklich, die Werte durchzugehen und zu bestätigen oder zu korrigieren. Führe sie ' +
      'zu dieser Bestätigung: frag direkt, ob die Metadaten so übernommen werden sollen.',
    'Beende deine Nachricht mit dieser Frage und schreib die bestätigende Antwort dabei aus, damit sie ihr ' +
      'als Antwortvorschlag angeboten werden kann: „Ich bestätige die Metadaten.“ Das ist ein Vorschlag, keine Vorgabe — ' +
      'verlang nicht, dass sie mit genau diesem Satz antwortet.',
    'Rufe submit_result ERST auf, wenn sie bestätigt hat — mit ihren Korrekturen, falls sie welche hatte. ' +
      'Ohne diesen Aufruf ist das Ergebnis für uns nicht da, auch wenn es im Chat steht.',
    'Sag ihr danach, dass alle Schritte erledigt sind und sie unten im Panel mit „Abschließen und zur ' +
      'Inhaltsübersicht“ fertig wird.'
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

/** The vocabularies to look up, quoted and enumerated for the task's sentence. */
function askedVocabularies(): string {
  const quoted = VOCABULARY_FIELD_NAMES.map((vocabulary) => `"${vocabulary}"`);
  return [quoted.slice(0, -1).join(', '), quoted[quoted.length - 1]].join(' und ');
}

/** What the enrichment answered; null where the turn submitted nothing usable. */
export function enrichmentOf(result: unknown): EnrichedMetadata | null {
  const answer = asRecord(result);
  if (!answer) return null;
  const valueOf = (raw: unknown): VocabularyValue => {
    const entry = asRecord(raw);
    return {
      label: typeof entry?.['label'] === 'string' ? entry['label'].trim() : '',
      uri: typeof entry?.['uri'] === 'string' ? entry['uri'].trim() : ''
    };
  };
  // An entry that states neither a name nor a URI says nothing and is dropped, so an empty one does not
  // read as a value the content was given.
  const list = (field: VocabularyField): VocabularyValue[] => {
    const stated = answer[field];
    return Array.isArray(stated) ? stated.map(valueOf).filter((value) => value.label || value.uri) : [];
  };
  const keywords = Array.isArray(answer['keywords'])
    ? answer['keywords'].filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
    : [];
  const metadata: EnrichedMetadata = {
    discipline: list('discipline'),
    educationalContext: list('educationalContext'),
    lrt: list('lrt'),
    intendedEndUserRole: list('intendedEndUserRole'),
    keywords: keywords.map((entry) => entry.trim())
  };
  // Nothing at all is not an enrichment: an answer about a different question would otherwise be recorded
  // as one whose every field happened to be empty.
  const stated =
    VOCABULARY_FIELD_NAMES.some((field) => metadata[field].length) || metadata.keywords.length;
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
 * a field whose valuespace does not contain it, where the editor shows a blank and no search finds it. That
 * split is why one answered field can feed two properties: the values are handed out by where they came from.
 */
const ENRICHED_PROPERTIES: readonly {
  field: VocabularyField;
  vocabulary: string;
  property: string;
}[] = [
  { field: 'discipline', vocabulary: 'discipline', property: 'ccm:taxonid' },
  { field: 'educationalContext', vocabulary: 'educationalContext', property: 'ccm:educationalcontext' },
  { field: 'lrt', vocabulary: 'new_lrt', property: LRT_FIELD },
  { field: 'lrt', vocabulary: 'new_lrt_aggregated', property: EXTENDED_TYPE_FIELD },
  {
    field: 'intendedEndUserRole',
    vocabulary: 'intendedEndUserRole',
    property: 'ccm:educationalintendedenduserrole'
  }
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
    // A Set, because a repeated lookup can answer the same entry twice and a property holds a value once.
    const uris = new Set(
      metadata[field].map((value) => value.uri).filter((uri) => uri.includes(`/vocabs/${vocabulary}/`))
    );
    if (uris.size) properties[property] = [...uris];
  }
  const kept = new Map<string, string>();
  // Standing first, so a keyword both lists hold stays in the spelling the content already carries.
  for (const keyword of [...asList(recorded?.[KEYWORD_PROPERTY]), ...metadata.keywords]) {
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
  /**
   * Where it came from. Not stated in the task — the page context and the quoted text both carry it — but it
   * decides whether reading the page is worth asking for at all; see {@link contentBlock}.
   */
  url: string | null;
  /** The collection whose requirements it is measured against. */
  collection: string | null;
  /** Who the content names as its author or publisher; null where it names none. */
  author: string | null;
  /** Who is signed in, so the named author has somebody to be compared against. */
  signedIn: string | null;
}

/**
 * The check's judging task: measure the content against the criteria. It follows the opening question, and
 * on one's own content the language pass as well; the enrichment follows it in a task of its own, once this
 * one has answered — see {@link originInstructionOf}, {@link proofreadInstructionOf} and
 * {@link enrichmentInstructionOf}.
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
 * **What to judge it by**: every quality-assurance skill the collection has released, fetched outright and by
 * dimension. The prompt carries the titles of a collection's skills but no ids, and an unspecific task lets
 * the model answer from memory, so the criteria are named as *our* dimensions and the assistant is asked to
 * fetch the instructions that speak to them. What a skill checks beyond them has nowhere to go as a criterion
 * — we hold no field for it — so it is asked for as part of the one overall verdict instead.
 *
 * **Where it is read**: in the chat as well as in the schema. Nothing can put a message into that conversation
 * from outside, so the assistant is asked to write the result there itself — the person sees only the chat.
 *
 * **Who ends the step**: the person, and the assistant is told to bring them to it. The judgement goes into
 * the chat first, then the assistant asks them to go through it and confirm or correct it, and only their
 * confirmation releases `submit_result` — which is what carries the check on to its next step. The assistant
 * is the one thing on this screen that can talk, so leading through the steps is its part. Down to the reply
 * chips: the widget composes those from the answer it just gave, and nothing outside the conversation can set
 * them — so the task has the assistant close on the question and name the confirming answer word for word,
 * which is what puts that answer among the chips for the person to tap.
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
    'Danach folgt noch ein Schritt: das Anreichern der Metadaten. Dieser hier ist fertig, wenn die Person ' +
      'deine Bewertung durchgegangen ist und sie bestätigt hat.',
    '',
    'Das sind unsere Prüfdimensionen. Beurteile jede einzeln:',
    criteria.map((item) => `${item.key}: ${item.caption}`).join('\n'),
    collection
      ? 'Nutze dafür alle zur Sammlung verfügbaren Qualitätssicherungsskills und ihre Prüfdimensionen: hol ' +
        'dir mit get_skill_registry die Liste und mit get_skill jede Anleitung, die zu einer dieser ' +
        'Dimensionen etwas sagt, und urteile danach.'
      : '',
    collection
      ? 'Prüft eine Anleitung etwas, wofür es oben keine Dimension gibt, dann ordne es der nächstliegenden ' +
        'zu, wenn es dorthin gehört. Gehört es nirgends hin, lass es in dein Gesamturteil (geeignet) ' +
        'einfließen und sag es in der Zusammenfassung — als eigenes Kriterium können wir es nicht führen.'
      : '',
    'Zu jedem Kriterium gibt es drei mögliche Ergebnisse: „erfolgreich“, wenn der Inhalt es erfüllt, ' +
      '„probleme“, wenn er es verletzt, und „unklar“, wenn der Inhalt nichts hergibt, woran sich das ' +
      'entscheiden ließe.',
    'Rate nicht: sag „unklar“, statt dich für eine der beiden Seiten zu entscheiden. Bei „unklar“ tragen wir ' +
      'zu diesem Kriterium nichts ein — die Begründung sagt dann, was zum Prüfen gefehlt hat.',
    'Sag am Ende außerdem, ob der Inhalt für den Einsatz in Bildung geeignet ist — dein Gesamturteil über ' +
      'alle Dimensionen und alles, was die Anleitungen sonst noch prüfen.',
    '',
    'Schreib dein Urteil zuerst in den Chat: je Kriterium eine Zeile mit ✓ (erfolgreich), ✗ (Probleme ' +
      'gefunden) oder ? (unklar), dem Namen des Kriteriums und dem Grund in einem Satz, darunter dein ' +
      'Gesamturteil, ob der Inhalt für Bildung geeignet ist, und ' +
      'ein kurzes Fazit, was einer Freigabe im Weg steht. Die Person sieht nur den Chat — was dort nicht ' +
      'steht, erfährt sie nicht.',
    'Bitte sie danach ausdrücklich, dein Urteil durchzugehen und zu bestätigen oder zu korrigieren. Führe sie ' +
      'zu dieser Bestätigung: frag direkt, ob es so stehen bleiben soll, und geh auf ihre Einwände ein.',
    'Beende deine Nachricht mit dieser Frage und schreib die bestätigende Antwort dabei aus, damit sie ihr ' +
      'als Antwortvorschlag angeboten werden kann: „Ich bestätige die Bewertung.“ Das ist ein Vorschlag, keine Vorgabe — ' +
      'verlang nicht, dass sie mit genau diesem Satz antwortet.',
    'Rufe submit_result ERST auf, wenn sie bestätigt hat — vorher nicht, auch wenn dein Urteil längst fertig ' +
      'ist.',
    'Sobald sie bestätigt: Rufe submit_result in genau diesem Zug auf, mit ihren Korrekturen, falls sie welche ' +
      'hatte, und zu jedem Kriterium ergebnis und begruendung. Eine Bestätigung im Chat allein reicht nicht — ' +
      'ohne diesen Werkzeugaufruf ist das Ergebnis für uns nicht da und es geht nicht weiter. Sag ihr dann, ' +
      'dass als Nächstes die Metadaten angereichert werden.',
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
  return head + contentBlock(text, url, TASK_MAX - head.length);
}

/**
 * The content itself, appended to the task and cut to what is left of the request's length.
 *
 * The page's address is deliberately NOT stated here: the assistant is given it in the page context, and the
 * text quoted below carries it in its own header (the extraction opens with `URL:` and `Canonical URL:`). A
 * third copy in the task only spends the budget the text needs. `url` therefore decides what is worth
 * ASKING for — reading the page is only an instruction where there is a page to read.
 */
function contentBlock(text: string, url: string | null, room: number): string {
  if (!text) {
    return (
      '\nDer Volltext dieses Inhalts liegt hier nicht vor.' +
      (url
        ? '\nHol ihn dir mit get_url_text von der Adresse der Seite, bevor du urteilst. Erst wenn auch das ' +
          'nichts hergibt, gilt ein Kriterium mangels Text als nicht prüfbar.'
        : '\nBeurteile, was der Seitenkontext hergibt, und sag bei jedem Kriterium ausdrücklich, wenn es ' +
          'mangels Text nicht prüfbar war.')
    );
  }
  const opening = '\nHier ist der Inhalt im Wortlaut:\n---\n';
  // The closing fence only where something follows it — it is there to say where the quoted text ends, and
  // where the text runs to the end of the task there is nothing for it to separate.
  const closing = '\n---';
  const budget = room - opening.length - closing.length - 200;
  const fits = text.length <= budget;
  const quoted = fits ? text : text.slice(0, Math.max(budget, 0));
  if (fits) return opening + quoted;
  return (
    opening +
    quoted +
    closing +
    '\nDieser Wortlaut ist abgeschnitten.' +
    (url ? ' Den vollständigen Text bekommst du mit get_url_text von der Adresse der Seite.' : '')
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
    const stated = entry?.['ergebnis'];
    // Anything but one of the three answers is no answer: the criterion stays as it stood, which is what
    // an assistant that skipped it left behind.
    if (typeof stated !== 'string' || !(stated.trim().toLowerCase() in OUTCOMES)) continue;
    const met = OUTCOMES[stated.trim().toLowerCase() as keyof typeof OUTCOMES];
    const reason = entry?.['begruendung'];
    verdicts.push({ criterion, met, reason: typeof reason === 'string' ? reason.trim() : '' });
  }
  const summary = answer?.['zusammenfassung'];
  const suitable = answer?.['geeignet'];
  return {
    verdicts,
    summary: typeof summary === 'string' ? summary.trim() : '',
    suitable: typeof suitable === 'boolean' ? suitable : null
  };
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
    // Undecided is not a verdict to record: on a knock-out property it would have to become one of the two
    // values the vocabulary holds, and on the editorial list the criterion's presence or absence says met or
    // not met — either way the record would state something firmer than the check found.
    if (met === null) continue;
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
 * A criterion the assistant did not answer holds it back, and so does one it answered as undecided — the
 * confirmation states that the criteria were looked at and found met, which neither of the two is.
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
