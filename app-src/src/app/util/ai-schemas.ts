// The shapes the KI quality check asks its answers in: one schema per step, as the `result_schema` that
// travels with the task. The assistant fills them with `submit_result`; every `description` in them reaches
// that tool's parameters verbatim and is read by the model as an instruction, which is why they are written
// as such — a schema is the second place the check states its rules, beside the tasks in `util/ai-prompts.ts`,
// and a rule that changes is usually due in both files.
//
// What is not a shape stays in `util/quality-check-request.ts`: the tasks, the readers that take an answer
// apart, and the node properties it is recorded in. Two vocabularies go the other way — `OUTCOMES` and the
// vocabulary fields are declared here because the schema states them to the model, and read back there
// because an answer arrives in their words.

import type { QualityCriterion } from './quality-check-request';

/**
 * How much of a schema the backend accepts (`result-schema`, 10 000 characters); beyond it the request is
 * refused outright rather than half applied. Ours is far below it — this is what says so, and what makes an
 * unexpectedly long list of criteria a reported problem instead of a chat that silently answers nothing.
 */
const SCHEMA_MAX = 10_000;

/** Whether a schema fits what the backend accepts — see {@link SCHEMA_MAX}. */
export function schemaFits(schema: Record<string, unknown>): boolean {
  return JSON.stringify(schema).length <= SCHEMA_MAX;
}

/**
 * The three answers a criterion can get, as the schema states them. Two of them are a judgement; the third is
 * the absence of one, and it is offered on purpose — a check that may only say yes or no answers no wherever
 * the content is silent, which reads as a finding about the content instead of one about the check.
 */
export const OUTCOMES = {
  met: true,
  violated: false,
  unclear: null
} as const satisfies Record<string, boolean | null>;

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
        outcome: {
          type: 'string',
          enum: Object.keys(OUTCOMES),
          description: 'Das Urteil zu diesem Kriterium.'
        },
        reason: {
          type: 'string',
          description:
            'Ein bis zwei Sätze, worauf sich das Urteil stützt. Nenne die Stelle im Inhalt, und wo die ' +
            'Anleitung der Sammlung etwas zu diesem Kriterium sagt, beziehe dich darauf.'
        }
      },
      required: ['outcome', 'reason']
    };
  }
  return {
    type: 'object',
    description: 'Das Ergebnis der Qualitätsprüfung: zu jedem Kriterium ein Urteil mit Begründung.',
    properties: {
      criteria: {
        type: 'object',
        description:
          'Zu jedem Kriterium genau ein Urteil. Kein Kriterium darf fehlen. Das Urteil ist eines von drei ' +
          'Worten: „met“, wenn der Inhalt das Kriterium erfüllt, „violated“, wenn er es verletzt, ' +
          'und „unclear“, wenn der Inhalt nichts hergibt, woran sich das entscheiden ließe — dann tragen ' +
          'wir zu diesem Kriterium nichts ein. Rate nicht: „unclear“ ist die richtige Antwort, wo du ' +
          'weder das eine noch das andere belegen kannst.',
        properties,
        required: criteria.map((item) => item.key)
      },
      suitable: {
        type: 'boolean',
        description:
          'Dein Gesamturteil: true, wenn der Inhalt für den Einsatz in Bildung geeignet ist. Über alle ' +
          'Kriterien hinweg und einschließlich dessen, was die Anleitungen der Sammlung sonst noch prüfen ' +
          'und wofür es hier kein eigenes Kriterium gibt.'
      },
      summary: {
        type: 'string',
        description:
          'Zwei bis drei Sätze: Was steht der Freigabe im Weg, und was wäre als Nächstes zu tun? Nenne ' +
          'hier auch, was eine Anleitung geprüft hat, wofür es kein eigenes Kriterium gibt.'
      },
      confirmed: {
        type: 'boolean',
        description:
          'Nur true, wenn die Person deine Bewertung im Chat durchgegangen ist und ihr zugestimmt hat. ' +
          'Solange sie nicht geantwortet hat: false — dann gilt der Schritt als offen und es geht nicht weiter.'
      }
    },
    required: ['criteria', 'suitable', 'confirmed', 'summary']
  };
}

/**
 * The field every schema carries so that a turn has something a person can READ.
 *
 * Two engines answer these schemas and they differ in exactly this: over the backend the prose is the
 * chat message and the schema is a second pass beside it, while a model on the device answers the
 * schema *as* the turn — its JSON is all there is. Without this field such a turn shows a placeholder
 * („Meine Antwort steht im Ergebnis dieses Schrittes"), which is what the KI check did on the device
 * until 2026-08-27. Named `message` because `visibleText` in the widget looks for it.
 */
const MESSAGE_FIELD = {
  message: {
    type: 'string',
    description:
      'Was du der Person dazu im Chat sagst — dieselben Sätze, die du ohnehin schreiben würdest. '
      + 'Zwei bis vier Sätze, auf Deutsch, und wo dieser Schritt eine Frage stellt, endet es mit ihr.'
  }
} as const;

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
      origin: {
        type: 'string',
        enum: ['own', 'external'],
        description:
          '„own“, wenn die Person den Inhalt selbst erstellt hat oder für ihn verantwortlich ist. ' +
          '„external“, wenn er von jemand anderem stammt und sie ihn nur einordnet. Trag nur ein, was sie ' +
          'geantwortet hat — rate nicht und leite es nicht aus dem Inhalt ab.'
      },
      guess: {
        type: 'string',
        enum: ['own', 'external'],
        description:
          'Wovon du selbst ausgegangen bist, bevor die Person geantwortet hat. Ihre Antwort steht in ' +
          'origin und gilt — auch dann, wenn sie deiner Vermutung widerspricht.'
      },
      ...MESSAGE_FIELD
    },
    required: ['origin', 'message']
  };
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
      findings: {
        type: 'array',
        description:
          'Eine Stelle je Eintrag, in der Reihenfolge, in der sie im Text vorkommen. Leere Liste, wenn ' +
          'sprachlich nichts zu beanstanden ist — das ist ein Ergebnis, kein fehlendes.',
        items: {
          type: 'object',
          properties: {
            passage: {
              type: 'string',
              description: 'Der Wortlaut der Stelle, wörtlich wie im Inhalt, damit sie wiederzufinden ist.'
            },
            correction: { type: 'string', description: 'Wie die Stelle stattdessen lauten soll.' },
            kind: {
              type: 'string',
              // Closed on purpose: these three are the whole of what this step looks at, and a finding
              // that fits none of them is one about the subject matter — which the criteria judge, not
              // this pass (see {@link proofreadInstructionOf}).
              enum: ['spelling', 'grammar', 'punctuation'],
              description:
                'Was daran zu ändern ist: „spelling“ für die Rechtschreibung, „grammar“ für die ' +
                'Grammatik, „punctuation“ für die Zeichensetzung.'
            }
          },
          required: ['passage', 'correction', 'kind']
        }
      },
      summary: {
        type: 'string',
        description: 'Ein bis zwei Sätze zum Text als Ganzem: Wie steht es um Sprache und Rechtschreibung?'
      },
      decision: {
        type: 'string',
        enum: ['open', 'accepted', 'skipped'],
        description:
          'Was die Person entschieden hat: „accepted“, wenn sie die Korrekturen annimmt und selbst in ' +
          'ihren Text einträgt, „skipped“, wenn der Text vorerst so bleiben soll. Solange sie nicht ' +
          'geantwortet hat: „open“ — dann gilt der Schritt als offen und es geht nicht weiter. Du selbst ' +
          'änderst den Text nicht und gibst die Korrekturen auch nirgends weiter; beide Antworten sind ' +
          'nur ihre Entscheidung, was sie damit vorhat.'
      }
    },
    required: ['findings', 'decision', 'summary']
  };
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
export type VocabularyField = keyof typeof VOCABULARY_FIELDS;

/** The vocabulary-valued fields, for the passes that treat all of them alike. */
export const VOCABULARY_FIELD_NAMES = Object.keys(VOCABULARY_FIELDS) as readonly VocabularyField[];

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
      },
      confirmed: {
        type: 'boolean',
        description:
          'Nur true, wenn die Person die Werte im Chat durchgegangen ist und ihnen zugestimmt hat. Solange ' +
          'sie nicht geantwortet hat: false — dann gilt der Schritt als offen und der Vorschlag steht noch aus.'
      },
      ...MESSAGE_FIELD
    },
    required: [...VOCABULARY_FIELD_NAMES, 'keywords', 'confirmed', 'message']
  };
}
