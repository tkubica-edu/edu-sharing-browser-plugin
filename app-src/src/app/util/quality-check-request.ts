// The KI quality check as something the assistant can be held to: the criteria of the metadata set as a task
// and a result schema, and its answer back as the properties a criterion is recorded in. The point of going
// through a schema is that the dialogue ends in the same record the structured check produces — a prose answer
// about a content is not a quality check, however good it reads.
//
// The shapes those answers are asked in stand in `util/ai-schemas.ts`, the texts of the tasks that carry them
// in `util/ai-prompts.ts`; what is here is the way between them and the record — the tasks as they are built,
// the readers that take an answer apart, and the node properties each part is written to.

import type { MdsDefinition, MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import type { CriteriaProperties } from '../features/quality/quality-criteria/quality-criteria.component';
import { LRT_AGGREGATED_FIELD, LRT_FIELD } from './agent-payload';
import { AI_PROMPTS } from './ai-prompts';
import { OUTCOMES, VOCABULARY_FIELD_NAMES } from './ai-schemas';
import type { VocabularyField } from './ai-schemas';
import type { MdsValues } from './mds-values';
import { CONTENT_TEXT_MAX, contentTextRoom } from './page-context';
import {
  CRITERION_MET, CRITERION_VIOLATED, EDITORIAL_CRITERIA_PROPERTY, KNOCKOUT_CRITERIA_WIDGET, autoMetValue,
  valueFor, widgetOf
} from './quality-criteria-values';

/** Log prefix of what the request says about itself, as everywhere else in the check. */
const LOG = '[edu-sharing][quality]';

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
  /**
   * Whether the person went through the verdicts and let them stand. What carries the check on to the
   * enrichment: a judgement submitted in the same turn as it was proposed is the assistant's word on the
   * content, not a step the person is done with.
   */
  confirmed: boolean;
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
 * Whose content is being checked, as the opening question answers it. It decides one thing: whether a pass
 * over spelling and wording is worth doing. On one's own content its findings are something the person can go
 * and fix; on someone else's they are a list of complaints about a text nobody here can touch.
 */
export type ContentOrigin = 'own' | 'external';

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
 * The two answers the person may tap are not this task's business: the panel hands them to the widget for the
 * whole step (see the check screen's STEP_REPLIES), which is what makes them dependable — composed from the
 * answer by the widget's own generator, they came back as offers about the collection instead. What the task
 * still owes them is a message that ends on the question they answer, and nothing after it.
 */
export function originInstructionOf(subject: CheckSubject): string {
  return AI_PROMPTS.origin(subject).join('\n');
}

/** Whose content the opening question established; null where the turn did not say. */
export function originOf(result: unknown): ContentOrigin | null {
  return originIn(asRecord(result)?.['origin']);
}

/**
 * What the assistant took the content for before it asked; null where it said nothing. Beside the answer, not
 * in its place: it is kept so the guess can be held against what the person actually said, which is the only
 * way to find out whether it is worth making.
 */
export function originGuessOf(result: unknown): ContentOrigin | null {
  return originIn(asRecord(result)?.['guess']);
}

function originIn(stated: unknown): ContentOrigin | null {
  if (typeof stated !== 'string') return null;
  const answer = stated.trim().toLowerCase();
  return answer === 'own' || answer === 'external' ? answer : null;
}

/** One place the language pass wants changed. */
export interface ProofreadFinding {
  /** The wording as it stands in the content, quoted so it can be found again. */
  passage: string;
  /** What it is to say instead. */
  correction: string;
  /** What is wrong with it — spelling, grammar or punctuation; empty where it said none. */
  kind: string;
}

/** What the language pass answered — see {@link proofreadOf}. */
export interface ProofreadResult {
  findings: readonly ProofreadFinding[];
  /** Its word on the text as a whole, empty where it gave none. */
  summary: string;
  /**
   * What the person decided about the places: to take them on, or to leave the text as it stands for now.
   * `null` while they have not answered, which is what holds the check at this step — a pass submitted
   * before they said anything is an answer about the text, not a step somebody is done with.
   *
   * Both ways out end the step, and neither of them changes the content: nothing here writes a correction
   * anywhere, so what is settled is what the person intends to do, not what happened to the text.
   */
  decision: ProofreadDecision | null;
}

/** What the person did with the places the pass named. */
export type ProofreadDecision = 'accepted' | 'skipped';

/**
 * The step that runs on one's own content and only there: read the text for spelling, grammar and punctuation,
 * and name the places to change.
 *
 * Language and nothing else. Whether the content is correct in its subject matter, complete, or fit for its
 * audience is judged by the criteria two steps on ({@link qualityInstructionOf}) — a pass that answered that
 * here would put the same content up for judgement twice, in one place against the collection's quality-assurance
 * skills and in the other against nothing in particular, and the person would have to reconcile the two.
 *
 * Nothing it finds is applied. There is no property on the content that holds a correction and the panel writes
 * none: the places are a list the person carries over into their own text, in their own time. So the step ends
 * on what they intend — to take the places on, or to leave the text as it stands for now (see
 * {@link ProofreadResult.decision}) — and both ends it. Left to itself the assistant narrates the confirmation
 * as an act ("die Korrekturen sind übernommen"), which tells the person their text was changed when it was not,
 * hence the task says outright that it changes nothing and must not claim otherwise.
 *
 * Why it is bound to the answer of the opening question: a correction is worth having only where somebody can
 * carry it out. The author of a content can go and fix what this finds; whoever is filing someone else's
 * content can do nothing with a list of its typos but read it — the text is not theirs to touch, and the step
 * would cost them a turn of the dialogue for nothing.
 *
 * What it judges is the wording itself, down to the character, and that wording reaches it as the page's own
 * text in the turn's context. The task points at it rather than quoting it — see {@link contentSource}.
 */
export function proofreadInstructionOf(subject: CheckSubject): string {
  const head = AI_PROMPTS.proofread(subject)
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
  return head + contentSource(subject) + PROOFREAD_REMINDER;
}

/**
 * The rules of the language pass again, at the very end of the task. What stands closest to the answer is what
 * a run holds to, and the content it reads argues its own case in between — a text riddled with subject-matter
 * errors turns the pass into a list of factual corrections, in one turn and without the closing question
 * (measured on a physics page full of wrong figures). Repeated here, the rules are what the run reads last.
 */
const PROOFREAD_REMINDER = AI_PROMPTS.proofreadReminder.join('\n');

/**
 * What the language pass found; null where the turn answered something else. The list is what says a pass
 * happened — an empty one is its answer, while no list at all is a turn about a different question. A finding
 * without a passage or without a correction is dropped: it names nothing the person could act on.
 */
export function proofreadOf(result: unknown): ProofreadResult | null {
  const answer = asRecord(result);
  const stated = answer?.['findings'];
  if (!Array.isArray(stated)) return null;
  const findings: ProofreadFinding[] = [];
  for (const entry of stated) {
    const finding = asRecord(entry);
    const passage = typeof finding?.['passage'] === 'string' ? finding['passage'].trim() : '';
    const correction = typeof finding?.['correction'] === 'string' ? finding['correction'].trim() : '';
    if (!passage || !correction) continue;
    findings.push({
      passage,
      correction,
      kind: typeof finding?.['kind'] === 'string' ? finding['kind'].trim() : ''
    });
  }
  const summary = answer?.['summary'];
  const decision = answer?.['decision'];
  return {
    findings,
    summary: typeof summary === 'string' ? summary.trim() : '',
    decision:
      decision === 'accepted' || decision === 'skipped' ? decision : null
  };
}

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
  /**
   * Whether the person went through the values and let them stand. What ends the check: values submitted in
   * the same turn as they were proposed are the assistant's suggestion, not metadata anybody agreed to.
   */
  confirmed: boolean;
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
 * and on the question, with nothing after it. That the check is through is said in a turn of its own, once
 * the confirmation has actually arrived; see {@link closingInstructionOf}.
 */
export function enrichmentInstructionOf(subject: CheckSubject): string {
  return AI_PROMPTS.enrichment(subject, VOCABULARY_FIELD_NAMES)
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

/**
 * The closing word, put once every step of the check has answered: congratulate the person, name what is
 * done, and point at the way on — the panel's footer, which is where the check is closed and the flow's next
 * step begins.
 *
 * A task of its own rather than a sentence appended to the enrichment, for two reasons. The enrichment's
 * message has to end on its question, because the chips are shown beneath it and a message closing on
 * something else leaves them answering nothing. And "everything is done" is only true once the confirmation
 * has actually arrived — said in the turn that asks for it, it would be said to a person who has not yet
 * confirmed anything.
 *
 * It asks for nothing and records nothing: no question, no further values, and expressly no
 * `submit_result` — the schema of the previous step still stands, and a run that fills it in again would
 * write the same values a second time over an answer that is already taken over.
 */
export function closingInstructionOf(subject: CheckSubject): string {
  return AI_PROMPTS.closing(subject).join('\n');
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
    keywords: keywords.map((entry) => entry.trim()),
    confirmed: answer['confirmed'] === true
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
 *
 * Every property here holds a **list**. `ccm:oeh_extendedType` is emphatically not one of them: it says what
 * kind of thing the content is, out of the `contentTypes` vocabulary and as a single value — a material type
 * written there is refused by the metadata set („Multiple values given for a non-multivalue widget") and would
 * be the wrong statement even if it were not (see EXTENDED_TYPE_FIELD).
 */
const ENRICHED_PROPERTIES: readonly {
  field: VocabularyField;
  vocabulary: string;
  property: string;
}[] = [
  { field: 'discipline', vocabulary: 'discipline', property: 'ccm:taxonid' },
  { field: 'educationalContext', vocabulary: 'educationalContext', property: 'ccm:educationalcontext' },
  { field: 'lrt', vocabulary: 'new_lrt', property: LRT_FIELD },
  { field: 'lrt', vocabulary: 'new_lrt_aggregated', property: LRT_AGGREGATED_FIELD },
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

/** The content a check is about, as the task has to describe it. */
export interface CheckSubject {
  /** What the content is called. */
  title: string | null;
  /**
   * What it says — the text the panel holds for it; empty where it holds none. Not put into the task: it
   * travels in the page context, and what it decides here is which line the task carries about it — that the
   * wording stands in the context, that it is cut short there, or that there is none.
   */
  text: string;
  /**
   * Where it came from. Not stated in the task — the page context and the text it carries both name it — but
   * it decides whether reading the page is worth asking for at all; see {@link contentSource}.
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
 * **Where its text stands**: in the turn's page context, as the page's own text, and not in the task — the
 * task names it and no more, so a content the size of a page travels once per turn rather than twice (see
 * {@link contentSource} and `page-context.ts`).
 *
 * **How to get the rest**: the address, where that text is missing or had to be cut. Reading it is something
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
  const head = AI_PROMPTS.quality(criteria, subject)
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
  return head + contentSource(subject) + QUALITY_REMINDER;
}

/**
 * The rules of the judgement again, at the very end of the task — for the same reason the language pass
 * repeats its own ({@link PROOFREAD_REMINDER}): what stands closest to the answer is what the run holds to,
 * and the content it reads in between is longer than anything the task says. The two rules worth the
 * repetition are the ones a run that is done judging drops first: end on the question, and submit only once
 * it has been answered.
 */
const QUALITY_REMINDER = AI_PROMPTS.qualityReminder.join('\n');

/**
 * Where the content's own text stands, appended to the task ahead of its reminder.
 *
 * The text itself is not in the task. It travels in the turn's page context as the page's own text, capped at
 * {@link CONTENT_TEXT_MAX} — one copy per turn instead of two, and the same copy every step of the check reads.
 * What is added here is the line that points at it, so a run does not answer from the node's description while
 * the wording sits unread beside it.
 *
 * The page's address is deliberately NOT stated: the assistant is given it in the page context, and the text it
 * points at carries it in its own header (the extraction opens with `URL:` and `Canonical URL:`). What `url`
 * decides is what is worth ASKING for — reading the page is only an instruction where there is a page to read.
 */
function contentSource(subject: CheckSubject): string {
  const text = subject.text.trim();
  const url = subject.url;
  if (!text) {
    console.log(
      `${LOG} the panel holds no text for this content, so the context carries none` +
        (url ? ' — the assistant is asked to fetch it' : ' and there is no address to fetch it from'),
    );
    return (
      AI_PROMPTS.content.missing +
      (url ? AI_PROMPTS.content.missingFetch : AI_PROMPTS.content.missingNoFetch)
    );
  }
  // What is left for the text beside the title, both of which the context carries under CONTENT_TEXT_MAX.
  const room = contentTextRoom(subject.title);
  const cut = text.length > room;
  // How much of the page reaches the model. A cut text is the one thing that makes a criterion unanswerable
  // for a reason nobody can see in the answer: the assistant then judges an excerpt and says so per criterion,
  // which reads as a finding about the content.
  console.log(
    `${LOG} the page has ${text.length} characters and the context carries ${room} of them beside the title ` +
      `(${CONTENT_TEXT_MAX} for both together) — ` +
      (cut ? `cut, ${text.length - room} characters do not reach the assistant` : 'it reaches the assistant whole'),
  );
  if (!cut) return AI_PROMPTS.content.inContext;
  return (
    AI_PROMPTS.content.inContext +
    AI_PROMPTS.content.truncated +
    (url ? AI_PROMPTS.content.truncatedFetch : '')
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
  const answered = asRecord(answer?.['criteria']);
  const verdicts: CriterionVerdict[] = [];
  for (const criterion of criteria) {
    const entry = asRecord(answered?.[criterion.key]);
    const stated = entry?.['outcome'];
    // Anything but one of the three answers is no answer: the criterion stays as it stood, which is what
    // an assistant that skipped it left behind.
    if (typeof stated !== 'string' || !(stated.trim().toLowerCase() in OUTCOMES)) continue;
    const met = OUTCOMES[stated.trim().toLowerCase() as keyof typeof OUTCOMES];
    const reason = entry?.['reason'];
    verdicts.push({ criterion, met, reason: typeof reason === 'string' ? reason.trim() : '' });
  }
  const summary = answer?.['summary'];
  const suitable = answer?.['suitable'];
  return {
    verdicts,
    summary: typeof summary === 'string' ? summary.trim() : '',
    suitable: typeof suitable === 'boolean' ? suitable : null,
    confirmed: answer?.['confirmed'] === true
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
