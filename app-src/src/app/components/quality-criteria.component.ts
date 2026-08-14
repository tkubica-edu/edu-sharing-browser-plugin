import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, output, signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT, HOME_REPOSITORY, MdsDefinition, MdsService, MdsValue, MdsWidget
} from 'ngx-edu-sharing-api';

import { IconDirective } from '../directives/icon.directive';
// Type-only: the answers are fetched by the service, this view only reads what came back.
import type { ContentJudgeEvaluation } from '../services/content-judge.service';
import type { MetalookupEvaluation } from '../services/metalookup.service';
import { QualityJudgeService } from '../services/quality-judge.service';
import { CriterionJudgement, judgementsForCriteria } from '../util/quality-schemes';
import { SpinnerComponent } from './spinner.component';

/** Every property as `string[]` — the shape the repository and the MDS editor both expect. */
export type CriteriaProperties = Record<string, string[]>;

/**
 * How a person answered a machine's objection — read off the criterion's box, which is where it is
 * answered: a ticked box dismisses it, an empty one confirms it.
 */
export type ViolationDecision = 'confirmed' | 'dismissed';

/** One criterion the checks objected to, as the alert above the lists shows it — one at a time. */
interface CriterionViolation {
  /** The criterion the objection is about, as the metadata set lists it. */
  criterion: MdsValue;
  /** What the checks found; more than one where several of them bear on this criterion. */
  findings: readonly CriterionJudgement[];
}

/**
 * What the block above the lists shows. Two states are about what is left to show rather than about the
 * machines: `handled`, the one line left where the user folded the answered objections away, and
 * `unavailable`, where no check got through at all — a service that is down is nothing the user can act
 * on or read anything into, so nothing is said about it.
 */
type CheckState = 'running' | 'violations' | 'handled' | 'unavailable' | 'done';

/** Log prefix for what this view finds out about the content, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';

/**
 * The quality vocabulary's ids, as a criterion's values carry them in `alternativeIds`
 * (https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/quality). Met only while the property holds
 * the value mapped to MET: a content nothing is recorded for is unjudged, which is not "in order".
 */
const CRITERION_MET = '3';
const CRITERION_VIOLATED = '0';

/**
 * The same two answers on a widget whose valuespace maps nothing, where the value *ids* are the answer
 * ("geeignet für eure Zielgruppe": `1` = Ja, `0` = Nein). Only consulted for such a widget — under a
 * mapped vocabulary an unmapped value is one it deliberately does not offer, not one to guess at.
 */
const PLAIN_MET = '1';
const PLAIN_VIOLATED = '0';

/**
 * How a machine's all-clear is recorded, where the criterion's valuespace states a term for it
 * ("keine Auffälligkeiten gefunden (Maschine)"); the rating and yes/no criteria state none, and there a
 * machine's answer cannot be told from a person's — see {@link autoMetValue}.
 *
 * Matched by the term at the end of the URI rather than through `alternativeIds`, because on a rating
 * scale those mean the rating: `2` is two stars, not "no machine findings".
 */
const AUTO_MET_TERM = 'no_auto_findings';

/** A valuespace id's own term — the last segment of the vocabulary URI, or the bare id. */
function termOf(id: string): string {
  return id.split('/').pop() || id;
}

/**
 * The widget listing the knock-out criteria — a table of contents, not a property of its own: its values
 * are the criteria, and each value's id is the node property that criterion is recorded in.
 */
const KNOCKOUT_WIDGET = 'virtual:unmetLegalCriteria';

/**
 * The editorial criteria: one multi-value property whose widget's values are the criteria. One is met
 * while its id is among the values — the opposite of the knock-out ones, where a value is the objection.
 */
const EDITORIAL_PROPERTY = 'ccm:oeh_buffet_criteria';

/** Coerce a property value of unknown shape to the `string[]` everything here works in. */
function asList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry));
}

/**
 * "Fachliche Qualitätskriterien": the two lists of criteria a content is judged by, and — reported
 * rather than asked for here — whether they allow the confirmation that follows from them.
 *
 * Deliberately self-contained, so it can be built as a custom element of its own later: properties in,
 * changed properties out, and it writes nothing itself. Only the metadata set is fetched, because the
 * criteria are *defined* there. Reporting rather than writing is also what lets it judge a content that
 * has no node yet — the panel collects everything and saves it once, at the end of the flow.
 *
 * The machines' judgement lands here too (QualityJudgeService checks much earlier, so it is usually
 * already in): what they found in order answers its criterion like a click on the box would, and what
 * they objected to is put in front of the user, one at a time, to be answered on that same box.
 */
@Component({
  selector: 'es-quality-criteria',
  imports: [IconDirective, SpinnerComponent],
  templateUrl: './quality-criteria.component.html',
  styleUrl: './quality-criteria.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCriteriaComponent {
  private readonly mdsService = inject(MdsService);
  private readonly qualityJudge = inject(QualityJudgeService);

  /** What the content records right now — its node properties, or the metadata standing in for them. */
  readonly properties = input<Record<string, unknown> | null>(null);

  /** The metadata set the criteria are defined in; the repository's primary one unless given. */
  readonly metadataSet = input(DEFAULT);

  /** The repository whose metadata set is read — the home one unless embedded against another. */
  readonly repository = input(HOME_REPOSITORY);

  /** Whether the quality has already been confirmed — the host's answer, since it records it. */
  readonly confirmed = input(false);

  /** A problem the host ran into with this view's report, shown where its own errors are. */
  readonly problem = input<string | null>(null);

  /** The properties this view changed, each one whole. The host decides when they are written. */
  readonly propertiesChange = output<CriteriaProperties>();

  /**
   * Whether the knock-out criteria stand in the way of nothing any more — see {@link knockoutSatisfied}.
   * Reported because the confirmation hanging off it is the host's (in the panel, the footer's "Qualität
   * bestätigen"), while this view is what knows when it may be given.
   */
  readonly knockoutSatisfiedChange = output<boolean>();

  /** The metadata set's definition; null until it is loaded. */
  private readonly mds = signal<MdsDefinition | null>(null);

  /**
   * The changes made here, over the properties handed in — kept because a host is not obliged to feed the
   * reported values back, and the view still has to answer to its own clicks.
   */
  private readonly changes = signal<CriteriaProperties>({});

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Whether a check is still out — the wait is over once the slower of the two judges is back. */
  private readonly checking = this.qualityJudge.running;

  /** What each judge did, so an empty result is not mistaken for "nothing found". */
  private readonly judgeStatuses = this.qualityJudge.statuses;

  /** Whether anything was asked at all; before that there is nothing to report. */
  protected readonly judgesAsked = this.qualityJudge.asked;

  /**
   * The criteria whose answer a check put there rather than a person — drawn in the machine's colour, so
   * nobody takes a filled-in box for someone's decision. A criterion the user answers themselves drops
   * out again (see {@link takeOver}): the mark says where the value came from.
   */
  private readonly aiAnswered = signal<readonly string[]>([]);

  /** Whether anything on screen carries a machine's answer — for the footnote that explains the star. */
  protected readonly hasAiAnswers = computed(() => this.aiAnswered().length > 0);

  /** The answers already taken over, so the same state is not applied twice; see the constructor. */
  private takenJudgement: ContentJudgeEvaluation | null = null;
  private takenMeasurement: MetalookupEvaluation | null = null;

  /**
   * What the judges answered per criterion id — several answers where several checks bear on one.
   * Empty until every check is back (see the constructor), so the criteria show a whole result rather
   * than a growing one. Kept as its own state because the record holds only the answer: a criterion
   * they all found in order is ticked (see {@link tickJudged}), and the finding behind it is here.
   */
  private readonly judgements = signal<Record<string, CriterionJudgement[]>>({});

  /**
   * What a person decided about each objection, keyed by criterion id. Per criterion rather than per
   * finding: two checks objecting to one criterion are two arguments about the same question.
   */
  private readonly decisions = signal<Record<string, ViolationDecision>>({});

  constructor() {
    // The criteria belong to the set, so they are re-read whenever it (or the repository) changes.
    effect(() => void this.load(this.metadataSet(), this.repository()));

    // Take the judgements over once every check is back and the criteria to map them onto are there.
    // Not before: a criterion the faster judge found in order can still be objected to by the slower, and
    // the tick would be taken back a moment later, with the user's eyes on the list.
    //
    // All four signals are read before the first return, so the run that follows the last check actually
    // happens. Each state of the answers is applied once (see takenJudgement), so a late judge still adds
    // to what the other one said.
    effect(() => {
      const checking = this.checking();
      const criteria = this.criterionIds();
      const judgement = this.qualityJudge.evaluation();
      const measurement = this.qualityJudge.measured();
      if (checking) return;
      if (!criteria.length || (!judgement && !measurement)) return;
      if (judgement === this.takenJudgement && measurement === this.takenMeasurement) return;
      this.takenJudgement = judgement;
      this.takenMeasurement = measurement;
      this.takeJudgements(criteria, judgement, measurement);
    });

    // Report the gate whenever it moves — on the first read of the set, and on every click that
    // changes what the criteria answer.
    effect(() => this.knockoutSatisfiedChange.emit(this.knockoutSatisfied()));
  }

  /** The knock-out criteria, in the order the metadata set lists them. */
  protected readonly knockoutCriteria = computed<readonly MdsValue[]>(
    () => this.widget(KNOCKOUT_WIDGET)?.values ?? []
  );

  /** The editorial criteria, likewise. */
  protected readonly editorialCriteria = computed<readonly MdsValue[]>(
    () => this.widget(EDITORIAL_PROPERTY)?.values ?? []
  );

  /**
   * Every criterion the content is judged by, both lists in the order they are shown. The ids are what
   * a scheme is looked up by — see {@link schemesForCriteria}.
   */
  private readonly criterionIds = computed<readonly string[]>(() =>
    [...this.knockoutCriteria(), ...this.editorialCriteria()].map((criterion) => criterion.id)
  );

  /** Whether there is anything to show — a set was loaded and it defines criteria. */
  protected readonly hasCriteria = computed(
    () => this.knockoutCriteria().length > 0 || this.editorialCriteria().length > 0
  );

  /**
   * Every criterion the checks objected to, both lists in the order they are shown — what the alert above
   * them leads through. An objection is a finding of `met === false`: a check that answered nothing about
   * a criterion (`null`) objects to nothing, and neither does one that found it in order.
   */
  protected readonly violations = computed<readonly CriterionViolation[]>(() => [
    ...this.violationsIn(this.knockoutCriteria()),
    ...this.violationsIn(this.editorialCriteria())
  ]);

  /**
   * How far the machines got. The wait covers the metadata set as well: until the criteria are there,
   * nothing can be said to have been found, and an all-clear taken back a moment later is worse than one
   * that comes late.
   *
   * `unavailable` where not one judge got through: there is no judgement then, not even an empty one, so
   * nothing is claimed either way. One judge answering is enough for `done` — what came back is a result,
   * and an objection in it would show as one.
   */
  protected readonly checkState = computed<CheckState>(() => {
    if (this.checking() || this.loading()) return 'running';
    if (this.violations().length) return this.folded() ? 'handled' : 'violations';
    if (!this.judgeStatuses().some((status) => status.state === 'done')) return 'unavailable';
    return 'done';
  });

  /** Whether every objection has been answered — nothing is asked of the user any more. */
  protected readonly allDecided = computed(
    () =>
      this.violations().length > 0 &&
      this.violations().every((violation) => !!this.decisionOf(violation.criterion.id))
  );

  /**
   * Whether the user folded the objections away — they stay on screen until they do. What a check found
   * belongs beside the criteria it is about, and answering it is no reason to take the argument away.
   */
  private readonly folded = signal(false);

  /** Put them back on screen, to look at them again or to answer differently. */
  protected openAlert(): void {
    this.folded.set(false);
  }

  /** Fold them away. Only ever offered while they are all answered (see the template). */
  protected closeAlert(): void {
    this.folded.set(true);
  }

  /**
   * Which objection the alert shows, clamped to what is there: the findings arrive while the view is
   * open, and an index into a list of two is nonsense the moment that list holds one.
   */
  protected readonly shown = linkedSignal<readonly CriterionViolation[], number>({
    source: this.violations,
    computation: (violations, previous) =>
      Math.min(previous?.value ?? 0, Math.max(violations.length - 1, 0))
  });

  /** The objection on screen; null while there is none. */
  protected readonly current = computed<CriterionViolation | null>(
    () => this.violations()[this.shown()] ?? null
  );

  /** What a person decided about this criterion's objection; null while they decided nothing. */
  private decisionOf(criterion: string): ViolationDecision | null {
    return this.decisions()[criterion] ?? null;
  }

  /**
   * What the objection to this criterion is called in its row: an open question while it stands on the
   * machine's word alone, settled once a person has looked at it — whichever way they decided, since the
   * box beside it says what came of it. `null` where nothing objected, which is most rows.
   */
  protected violationLabel(criterion: MdsValue): string | null {
    if (!this.hasObjection(criterion.id)) return null;
    return this.decisionOf(criterion.id) ? 'geprüft' : 'mögliche Auffälligkeit';
  }

  /**
   * Whether the objection to this criterion is still one — unanswered, or confirmed. That is what the row
   * is drawn in the alarm colour for. A dismissed one is not: the finding stays on record, but the
   * criterion is in order, and a row that kept shouting would send the user after a settled problem.
   */
  protected isViolated(criterion: MdsValue): boolean {
    return !!this.violationLabel(criterion) && this.decisionOf(criterion.id) !== 'dismissed';
  }

  /** Whether a person put this criterion's objection aside — see {@link isViolated}. */
  protected isDismissed(criterion: MdsValue): boolean {
    return this.decisionOf(criterion.id) === 'dismissed';
  }

  /** What a check found, in its own words — its reasoning, else the bare verdict it gave. */
  protected findingText(finding: CriterionJudgement): string {
    if (finding.reasoning) return finding.reasoning;
    const value = finding.value === null ? '–' : String(Math.round(finding.value * 100) / 100);
    return `${finding.scheme}: ${finding.label ?? value}`;
  }

  /** Show the objection before this one, wrapping around; nothing to do while there is only one. */
  protected showPrevious(): void {
    this.step(-1);
  }

  protected showNext(): void {
    this.step(1);
  }

  protected readonly allKnockoutMet = computed(
    () =>
      this.knockoutCriteria().length > 0 &&
      this.knockoutCriteria().every((criterion) => this.isMet(criterion))
  );

  protected readonly allEditorialMet = computed(
    () =>
      this.editorialCriteria().length > 0 &&
      this.editorialCriteria().every((criterion) => this.isEditorialMet(criterion))
  );

  /**
   * Whether the knock-out criteria hold the content back no longer: every one met, or the set defines
   * none at all — otherwise a content would be stuck behind a list nobody can tick. Only these gate it;
   * the editorial criteria describe quality without standing in the way of publishing.
   *
   * False while the set is still being read, so the gate never opens for a moment just because nothing
   * has loaded yet.
   */
  private readonly knockoutSatisfied = computed(
    () => !this.loading() && (this.knockoutCriteria().length === 0 || this.allKnockoutMet()),
  );

  /**
   * Whether a knock-out criterion is met: the record holds the value a person's confirmation writes, or
   * the one a machine's all-clear writes. Everything else counts as not met — nothing recorded, the
   * vocabulary's own "Ungeprüft", any kind of finding — so a tick is always something that was
   * established. The confirmation hangs off these boxes, which is why nothing here may be assumed.
   */
  protected isMet(criterion: MdsValue): boolean {
    const recorded = this.valueOfProperty(criterion.id)[0];
    if (!recorded) return false;
    return (
      recorded === this.valueFor(criterion.id, CRITERION_MET) ||
      recorded === this.autoMetValue(criterion.id)
    );
  }

  /** Whether an editorial criterion is met: its id is among the property's values. */
  protected isEditorialMet(criterion: MdsValue): boolean {
    return this.valueOfProperty(EDITORIAL_PROPERTY).includes(criterion.id);
  }

  /** What the row is labelled: the criterion's own caption, falling back to its bare id. */
  protected captionOf(criterion: MdsValue): string {
    return criterion.caption || criterion.id;
  }

  /** What the machines made of this criterion; empty while nothing judged it — see {@link judgements}. */
  private judgementsOf(criterion: string): readonly CriterionJudgement[] {
    return this.judgements()[criterion] ?? [];
  }

  /** Whether any check objected to this criterion — whether, that is, there is a hint to answer. */
  private hasObjection(criterion: string): boolean {
    return this.judgementsOf(criterion).some((judged) => judged.met === false);
  }

  /** Whether this criterion's answer is the machine's — see {@link aiAnswered}. */
  protected isAiAnswered(criterion: MdsValue): boolean {
    return this.aiAnswered().includes(criterion.id);
  }

  /**
   * Record a knock-out criterion as met or as violated — one property each. Records nothing where the
   * vocabulary holds no value for what the click means, and says so instead; an objection to that
   * criterion then stays unanswered too.
   */
  protected setCriterion(criterion: MdsValue, met: boolean): void {
    const value = this.valueFor(criterion.id, met ? CRITERION_MET : CRITERION_VIOLATED);
    if (!value) {
      // The vocabulary does not offer the value this click means. Saying so beats recording
      // something else: the criterion decides whether the content may be published.
      this.error.set(`Für „${this.captionOf(criterion)}“ ist kein passender Wert hinterlegt.`);
      return;
    }
    this.takeOver([criterion.id]);
    this.report({ [criterion.id]: [value] });
    this.decide(criterion.id, met);
  }

  /** Record an editorial criterion by adding it to the property's values, or taking it out. */
  protected setEditorialCriterion(criterion: MdsValue, met: boolean): void {
    const current = this.valueOfProperty(EDITORIAL_PROPERTY);
    this.takeOver([criterion.id]);
    this.report({
      [EDITORIAL_PROPERTY]: met
        ? [...current.filter((id) => id !== criterion.id), criterion.id]
        : current.filter((id) => id !== criterion.id)
    });
    this.decide(criterion.id, met);
  }

  /** Fulfil every knock-out criterion at once. */
  protected setAllKnockout(): void {
    const met: CriteriaProperties = {};
    for (const criterion of this.knockoutCriteria()) {
      const value = this.valueFor(criterion.id, CRITERION_MET);
      if (value) met[criterion.id] = [value];
    }
    this.takeOver(Object.keys(met));
    this.report(met);
    for (const criterion of Object.keys(met)) this.decide(criterion, true);
  }

  /** Fulfil every editorial criterion at once: the property holds all of their ids. */
  protected setAllEditorial(): void {
    const criteria = this.editorialCriteria().map((criterion) => criterion.id);
    this.takeOver(criteria);
    this.report({ [EDITORIAL_PROPERTY]: criteria });
    for (const criterion of criteria) this.decide(criterion, true);
  }

  /** Both lists at once. */
  protected setAll(): void {
    this.setAllKnockout();
    this.setAllEditorial();
  }

  /** What is wrong right now: this view's own complaint, else whatever the host reports. */
  protected readonly problemShown = computed(() => this.error() ?? this.problem());

  /** The objections among these criteria — see {@link violations}. */
  private violationsIn(criteria: readonly MdsValue[]): readonly CriterionViolation[] {
    return criteria
      .map((criterion) => ({
        criterion,
        findings: this.judgementsOf(criterion.id).filter((judged) => judged.met === false)
      }))
      .filter((violation) => violation.findings.length > 0);
  }

  /** Move through the objections, wrapping at either end. */
  private step(by: number): void {
    const count = this.violations().length;
    if (count < 2) return;
    this.shown.update((index) => (index + by + count) % count);
  }

  /**
   * Note that an objection has been answered — it is answered on the criterion's own box, by the same
   * click that records the value: ticked, so the person did not see what the check saw; empty, so they
   * did. A criterion nothing objected to has nothing to decide. The alert then moves on to what is still
   * open, since it is a queue of questions and answering one is what asks the next.
   */
  private decide(criterion: string, met: boolean): void {
    if (!this.hasObjection(criterion)) return;
    this.decisions.update((decisions) => ({
      ...decisions,
      [criterion]: met ? 'dismissed' : 'confirmed'
    }));
    this.showOpen();
  }

  /**
   * Show the first objection nobody has answered yet. Where they are all answered the alert stays where
   * it is: nothing is left to ask, and what stands there is the record of the decision just taken.
   */
  private showOpen(): void {
    const index = this.violations().findIndex(
      (violation) => !this.decisionOf(violation.criterion.id)
    );
    if (index >= 0) this.shown.set(index);
  }

  /**
   * Take both answers apart per criterion, so every box can say what the machines made of it — by the
   * same maps that chose the checks in the first place.
   */
  private takeJudgements(
    criteria: readonly string[],
    judgement: ContentJudgeEvaluation | null,
    measurement: MetalookupEvaluation | null
  ): void {
    const judgements = judgementsForCriteria(criteria, judgement, measurement);
    this.judgements.set(judgements);
    console.log(
      `${LOG_QUALITY} judgement`,
      Object.values(judgements)
        .flat()
        .map((found) => ({ caption: this.captionById(found.criterion), ...found }))
    );
    this.tickJudged(judgements);
  }

  /**
   * Tick every criterion the checks found in order, recorded as the machine's answer where the valuespace
   * can say so. *Every* check: where two bear on one criterion, one failure leaves it open — missing
   * security headers are not made good by an LLM finding the prose harmless.
   *
   * Only where nothing is recorded yet. The answers arrive about a minute after the content was
   * erschlossen, so the user may have answered in the meantime, and what is already there — an
   * "Ungeprüft" included — stands. A failed check ticks nothing: the box already reads as unanswered,
   * and the verdict beside it says what was found.
   */
  private tickJudged(judgements: Record<string, CriterionJudgement[]>): void {
    const values: CriteriaProperties = {};
    const editorial = [...this.valueOfProperty(EDITORIAL_PROPERTY)];
    // Coarse on purpose: the editorial criteria share one property, so a single click of the user's
    // makes the whole list theirs — there is no telling which of its entries they decided about.
    const editorialAnswered = !!this.changes()[EDITORIAL_PROPERTY];
    const ticked: string[] = [];
    const left: Record<string, string> = {};

    for (const [criterion, found] of Object.entries(judgements)) {
      if (!found.every((judgement) => judgement.met === true)) continue;
      if (this.isEditorial(criterion)) {
        if (editorialAnswered || editorial.includes(criterion)) {
          left[criterion] = 'already answered';
          continue;
        }
        editorial.push(criterion);
        ticked.push(criterion);
        continue;
      }
      if (this.valueOfProperty(criterion).length) {
        left[criterion] = 'already answered';
        continue;
      }
      const met = this.autoMetValue(criterion) ?? this.valueFor(criterion, CRITERION_MET);
      if (!met) {
        left[criterion] = 'the valuespace states no value for met';
        continue;
      }
      values[criterion] = [met];
      ticked.push(criterion);
    }

    if (editorial.length > this.valueOfProperty(EDITORIAL_PROPERTY).length) {
      values[EDITORIAL_PROPERTY] = editorial;
    }
    if (Object.keys(values).length) this.report(values);
    // Marked as the machine's before anything else can happen to them, so the boxes it just filled in
    // are never briefly indistinguishable from the user's own.
    this.aiAnswered.set(ticked);
    console.log(`${LOG_QUALITY} ticked`, { ticked, left });
  }

  /** Whether a criterion belongs to the editorial list rather than to the knock-out one. */
  private isEditorial(criterion: string): boolean {
    return this.editorialCriteria().some((candidate) => candidate.id === criterion);
  }

  /** A criterion's caption by its id, from whichever of the two lists holds it. */
  private captionById(criterion: string): string {
    const found = [...this.knockoutCriteria(), ...this.editorialCriteria()].find(
      (candidate) => candidate.id === criterion
    );
    return found ? this.captionOf(found) : criterion;
  }

  /**
   * Take these criteria over as the user's own, so they stop being drawn as the machine's (see
   * {@link aiAnswered}). The judgement stays beside them: disagreeing with a finding does not unmake it.
   */
  private takeOver(criteria: readonly string[]): void {
    this.aiAnswered.update((answered) => answered.filter((id) => !criteria.includes(id)));
  }

  /** Remember a change and hand it on, so the two never disagree. */
  private report(values: CriteriaProperties): void {
    this.error.set(null);
    this.changes.update((changes) => ({ ...changes, ...values }));
    this.propertiesChange.emit(values);
  }

  /** A property as it stands: what was changed here, else what was handed in. */
  private valueOfProperty(property: string): string[] {
    const changed = this.changes()[property];
    return changed ?? asList(this.properties()?.[property]);
  }

  /** The widget with this id, from the loaded set. */
  private widget(id: string): MdsWidget | undefined {
    return this.mds()?.widgets?.find((widget: MdsWidget) => widget.id === id);
  }

  /**
   * The value id that records a MACHINE's all-clear on this criterion, where its valuespace offers one;
   * `undefined` where it does not — see {@link AUTO_MET_TERM}.
   */
  private autoMetValue(property: string): string | undefined {
    return this.widget(property)?.values?.find((value) => termOf(value.id) === AUTO_MET_TERM)?.id;
  }

  /**
   * The value id that means MET / VIOLATED on this criterion's property: the value mapped to that entry
   * of the quality vocabulary, or — where the widget maps *nothing* — the plain yes/no id (see
   * {@link PLAIN_MET}). The distinction matters: a mapped vocabulary that lacks the entry has no answer
   * to give, and falling through would pick an unrelated value out of a rating scale.
   */
  private valueFor(property: string, vocabularyId: string): string | undefined {
    const values = this.widget(property)?.values ?? [];
    const mapped = values.find((value: MdsValue) => value.alternativeIds?.includes(vocabularyId));
    if (mapped) return mapped.id;
    if (values.some((value: MdsValue) => value.alternativeIds?.length)) return undefined;
    const plain = vocabularyId === CRITERION_MET ? PLAIN_MET : PLAIN_VIOLATED;
    return values.find((value: MdsValue) => value.id === plain)?.id;
  }

  /** Load the set the criteria are defined in. */
  private async load(metadataSet: string, repository: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.mds.set(await firstValueFrom(this.mdsService.getMetadataSet({ repository, metadataSet })));
    } catch {
      this.error.set('Die Qualitätskriterien konnten nicht geladen werden.');
    } finally {
      this.loading.set(false);
    }
  }

}
