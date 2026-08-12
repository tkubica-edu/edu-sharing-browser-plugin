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
 * What became of a machine's objection once a person looked at it: they saw the violation too
 * (`confirmed`), or they did not (`dismissed`). Only the latter answers the criterion — a confirmed
 * violation leaves its box exactly as empty as it was.
 */
export type ViolationDecision = 'confirmed' | 'dismissed';

/** One criterion the checks objected to, as the alert above the lists shows it — one at a time. */
interface CriterionViolation {
  /** The criterion the objection is about, as the metadata set lists it. */
  criterion: MdsValue;
  /** Which of the two lists it belongs to — the answer is recorded differently in each. */
  editorial: boolean;
  /** What the checks found; more than one where several of them bear on this criterion. */
  findings: readonly CriterionJudgement[];
}

/**
 * How far the machines got with the content — the state the block above the lists shows. Two of them are
 * not about the machines but about what is left to show: `handled`, where every objection has been
 * answered and the block folds into one line, and `unavailable`, where no check got through at all and
 * the block is not there. A service that is down is nothing to tell the user about — they can neither
 * do anything about it nor read anything into it, and the criteria are theirs to answer either way.
 */
type CheckState = 'running' | 'violations' | 'handled' | 'unavailable' | 'done';

/** Log prefix for what this view finds out about the content, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';

/**
 * The valuespace ids a criterion's value carries in `alternativeIds` — from the quality vocabulary
 * (https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/quality). A criterion is *met* only while
 * the property holds the value that maps to MET: a content nothing is recorded for is unjudged, and
 * unjudged is not the same as in order.
 */
const CRITERION_MET = '3';
const CRITERION_VIOLATED = '0';

/**
 * The same two answers on a criterion whose valuespace carries no `alternativeIds` at all — a plain
 * yes/no widget, whose value *ids* are the answer ("geeignet für eure Zielgruppe" is one: `1` = Ja,
 * `0` = Nein). Only consulted for such a widget: where a vocabulary is mapped, an unmapped value is
 * one the vocabulary deliberately does not offer, not one to guess at.
 */
const PLAIN_MET = '1';
const PLAIN_VIOLATED = '0';

/**
 * The vocabulary term a machine's all-clear is recorded as, where the criterion's valuespace states one
 * ("keine Auffälligkeiten gefunden (Maschine)"). Four of the knock-out criteria use that findings
 * vocabulary; the others are a 0–5 rating (Neutralität, Datenschutz) or a plain yes/no, and there a
 * machine's answer cannot be told from a person's — see {@link autoMetValue}.
 *
 * Matched by the term at the end of the value's URI rather than through `alternativeIds`, because on a
 * rating scale those mean the rating: `2` there is two stars, not "no machine findings".
 */
const AUTO_MET_TERM = 'no_auto_findings';

/** A valuespace id's own term — the last segment of the vocabulary URI, or the bare id. */
function termOf(id: string): string {
  return id.split('/').pop() || id;
}

/**
 * The widget listing the knock-out criteria. Its *values* are the criteria, and each value's id is
 * itself the node property that criterion is recorded in — the widget is a table of contents, not a
 * property of its own.
 */
const KNOCKOUT_WIDGET = 'virtual:unmetLegalCriteria';

/**
 * The editorial criteria: one multi-value property, whose widget's values are the criteria. A
 * criterion is met while its id is among the property's values — the plain opposite of the
 * knock-out ones, where a recorded value is the objection.
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
 * Deliberately self-contained, so it can be built as a custom element of its own later. It takes the
 * content's properties in and reports the changed ones back out — it writes nothing itself and knows
 * nothing of the flow it currently sits in. The only thing it fetches is the metadata set, because
 * the criteria are *defined* there: which they are, what they are called, and which valuespace entry
 * means met.
 *
 * Reporting rather than writing is also what lets it judge a content that does not exist yet: in the
 * panel the criteria are collected with the rest of the metadata and written by the single save at
 * the end of the flow, which is where a curated content gets its node in the first place.
 *
 * The content is also judged by machine, and this view is where that judgement lands: what the check
 * found in order is reported as an answer to that criterion, like a click on its box would be, and what
 * it objected to is put in front of the user — one objection at a time, each to be dismissed or
 * confirmed. The checking itself happens elsewhere and much earlier (QualityJudgeService,
 * started as soon as the content is erschlossen), so by the time this view opens the answer is usually
 * already there — and where it is not, the wait is the tail of it.
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
   * Whether the knock-out criteria stand in the way of nothing any more — see
   * {@link knockoutSatisfied}. Reported because the confirmation that hangs off it is the host's: it
   * offers it wherever its own actions live (in the panel, the footer's "Qualität bestätigen"), and
   * this view is what knows when it may be given.
   */
  readonly knockoutSatisfiedChange = output<boolean>();

  /** The metadata set's definition; null until it is loaded. */
  private readonly mds = signal<MdsDefinition | null>(null);

  /**
   * The changes made here, over the properties handed in. Kept because a host is not obliged to feed
   * the reported values back: one that stores them re-supplies them and this agrees with it, one
   * that does not still gets a view that answers to its own clicks.
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
   * The criteria whose answer the check put there rather than a person — what is drawn in the machine's
   * colour, so nobody takes a filled-in box for someone's decision.
   *
   * A criterion the user answers themselves drops out of it again (see {@link takeOver}): the mark says
   * where the value came from, and from then on it comes from somewhere else.
   */
  private readonly aiAnswered = signal<readonly string[]>([]);

  /** Whether anything on screen carries a machine's answer — for the footnote that explains the star. */
  protected readonly hasAiAnswers = computed(() => this.aiAnswered().length > 0);

  /** The answers already taken over, so the same state is not applied twice; see the constructor. */
  private takenJudgement: ContentJudgeEvaluation | null = null;
  private takenMeasurement: MetalookupEvaluation | null = null;

  /**
   * What the judges answered per criterion, keyed by criterion id — several answers where several
   * checks bear on one criterion. Empty until every check is back, which is what makes the criteria
   * show a whole result rather than a growing one (see the constructor).
   *
   * A criterion they *all* found in order is ticked (see {@link tickJudged}); one they objected to is
   * marked as such and argued about in the alert above the lists. Kept as its own state rather than
   * derived from the record, because the record only holds the answer — the finding behind it is here.
   */
  private readonly judgements = signal<Record<string, CriterionJudgement[]>>({});

  /**
   * What a person decided about each objection, keyed by criterion id — empty until they decided
   * anything. Kept per criterion rather than per finding: two checks objecting to the same criterion
   * are two arguments about one question, and the answer is to the question.
   */
  private readonly decisions = signal<Record<string, ViolationDecision>>({});

  constructor() {
    // The criteria belong to the set, so they are re-read whenever it (or the repository) changes.
    effect(() => void this.load(this.metadataSet(), this.repository()));

    // Take the judgements over once every check is back and the criteria to map them onto are there.
    //
    // Not before: the two judges answer at their own pace, and a criterion the faster one found in
    // order can still be objected to by the slower. Ticking it in the meantime would show an answer
    // that is then taken back a moment later — with the box already ticked in the machine's colour, and
    // the user's eyes on the list while it happens.
    //
    // All four signals are read before the first return, so the run that follows the last check coming
    // in actually happens. Each state of the answers is then applied once (see takenJudgement), so a
    // judge that answers late still adds to what the other one said.
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
   * Every criterion the checks objected to, both lists in the order they are shown — what the alert
   * above them leads through.
   *
   * An objection is a finding of `met === false`: a check that answered nothing about a criterion
   * (`null`) objects to nothing, and neither does one that found it in order.
   */
  protected readonly violations = computed<readonly CriterionViolation[]>(() => [
    ...this.violationsIn(this.knockoutCriteria(), false),
    ...this.violationsIn(this.editorialCriteria(), true)
  ]);

  /**
   * How far the machines got, as the block above the lists reports it. The wait covers the metadata set
   * as well: until the criteria are there, nothing can be said to have been found — and an all-clear
   * that is taken back a moment later is worse than one that comes late.
   *
   * `unavailable` where not one judge got through — every one of them unreachable, or with nothing on
   * this content it could check. There is no judgement then, not even an empty one, so nothing is
   * claimed: neither that the content was checked nor that a service is broken.
   *
   * One judge answering is enough for `done`, whatever became of the other: what came back is a result,
   * and the alert would carry it if it held an objection.
   */
  protected readonly checkState = computed<CheckState>(() => {
    if (this.checking() || this.loading()) return 'running';
    if (this.violations().length) return this.alertOpen() ? 'violations' : 'handled';
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
   * Whether the objections are on screen. They are while any of them is unanswered, and once they are
   * all answered only if the user asked for them back — the alert is a question, and an answered
   * question should not keep the criteria pushed down the sheet.
   */
  private readonly alertOpen = computed(() => !this.allDecided() || this.reopened());

  /** Whether the user asked the answered objections back on screen — see {@link alertOpen}. */
  private readonly reopened = signal(false);

  /** Put the answered objections back on screen, to look at them again or to answer differently. */
  protected openAlert(): void {
    this.reopened.set(true);
  }

  /** Fold them away again. Only ever offered while they are all answered (see the template). */
  protected closeAlert(): void {
    this.reopened.set(false);
  }

  /**
   * Which objection the alert shows. Clamped to what is there, since the findings arrive while the view
   * is open: an index into a list of two is nonsense the moment that list holds one.
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
  protected decisionOf(criterion: string): ViolationDecision | null {
    return this.decisions()[criterion] ?? null;
  }

  /**
   * What the objection to this criterion is called in its row: the finding while it stands on the
   * machine's word alone, and the person's own verdict once they have given it. `null` where nothing
   * objected — which is most rows.
   */
  protected violationLabel(criterion: MdsValue): string | null {
    if (!this.judgementsOf(criterion).some((judged) => judged.met === false)) return null;
    switch (this.decisionOf(criterion.id)) {
      case 'confirmed':
        return 'Verstoß bestätigt';
      case 'dismissed':
        return 'Verstoß nicht bestätigt';
      default:
        return 'Verstoß entdeckt';
    }
  }

  /**
   * Whether the objection to this criterion is still one: nobody has answered it yet, or somebody
   * confirmed it. That is what the row is drawn in the alarm colour for.
   *
   * A dismissed objection is not. The finding stays on record — a person disagreeing with a check does
   * not unmake what it found — but the criterion is answered and in order, and a row that keeps
   * shouting after that would send the user looking for a problem that has been dealt with.
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

  /** "kein Verstoß erkennbar": the person looked and did not see it, so the criterion is met. */
  protected dismissViolation(): void {
    this.answerViolation(true, 'dismissed');
  }

  /** "Verstoß bestätigen": the person saw it too, so the criterion is not met and its box comes off. */
  protected confirmViolation(): void {
    this.answerViolation(false, 'confirmed');
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
   * Whether the knock-out criteria hold the content back no longer: every one of them is met, or the
   * set defines none at all — criteria that do not exist cannot be answered, and a content would
   * otherwise be stuck behind a list nobody can tick. Only these gate it: the editorial criteria
   * describe the content's quality, they do not stand in the way of publishing it.
   *
   * False while the set is still being read: what it will demand is not known yet, and a gate that
   * opens for a moment because nothing has loaded is worse than one that opens late.
   */
  private readonly knockoutSatisfied = computed(
    () => !this.loading() && (this.knockoutCriteria().length === 0 || this.allKnockoutMet()),
  );

  /**
   * Whether a knock-out criterion is met: the record holds a value that says so — the one a person's
   * confirmation writes, or the one a machine's all-clear writes. Everything else counts as not met:
   * nothing recorded at all, the vocabulary's own "Ungeprüft", and any kind of finding.
   *
   * So every box starts empty, and a tick is something that was actually established. The confirmation
   * hangs off these boxes (see the template), which is why nothing here may be assumed.
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
  private judgementsOf(criterion: MdsValue): readonly CriterionJudgement[] {
    return this.judgements()[criterion.id] ?? [];
  }

  /** Whether this criterion's answer is the machine's — see {@link aiAnswered}. */
  protected isAiAnswered(criterion: MdsValue): boolean {
    return this.aiAnswered().includes(criterion.id);
  }

  /**
   * Record a knock-out criterion as met or as violated — one property each. Reports whether it was
   * recorded: the vocabulary may hold no value for what the click means, and then nothing was answered.
   */
  protected setCriterion(criterion: MdsValue, met: boolean): boolean {
    const value = this.valueFor(criterion.id, met ? CRITERION_MET : CRITERION_VIOLATED);
    if (!value) {
      // The vocabulary does not offer the value this click means. Saying so beats recording
      // something else: the criterion decides whether the content may be published.
      this.error.set(`Für „${this.captionOf(criterion)}“ ist kein passender Wert hinterlegt.`);
      return false;
    }
    this.takeOver([criterion.id]);
    this.report({ [criterion.id]: [value] });
    return true;
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
  }

  /** Fulfil every editorial criterion at once: the property holds all of their ids. */
  protected setAllEditorial(): void {
    const criteria = this.editorialCriteria().map((criterion) => criterion.id);
    this.takeOver(criteria);
    this.report({ [EDITORIAL_PROPERTY]: criteria });
  }

  /** Both lists at once. */
  protected setAll(): void {
    this.setAllKnockout();
    this.setAllEditorial();
  }

  /** What is wrong right now: this view's own complaint, else whatever the host reports. */
  protected readonly problemShown = computed(() => this.error() ?? this.problem());

  /** The objections among these criteria — see {@link violations}. */
  private violationsIn(
    criteria: readonly MdsValue[],
    editorial: boolean
  ): readonly CriterionViolation[] {
    return criteria
      .map((criterion) => ({
        criterion,
        editorial,
        findings: this.judgementsOf(criterion).filter((judged) => judged.met === false)
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
   * Answer the objection on screen, and move on to the next one nobody has answered yet — the alert is
   * a queue of questions, and answering one is what asks the following one.
   *
   * Both answers are answers to the criterion, and each writes the value it means: the person did not
   * see the violation, so the criterion is met; or they did, so it is violated. That is exactly what
   * the vocabulary's "(Mensch)" values are for, and it is the same thing a click on the row's own box
   * would record.
   *
   * The step forward happens either way, even where the value could not be recorded (see
   * {@link setCriterion}) — the button has to do something visible. What is *not* recorded then is the
   * decision: the objection stays in the queue, the row keeps reading as found, and the error says why.
   */
  private answerViolation(met: boolean, decision: ViolationDecision): void {
    const violation = this.current();
    if (!violation) return;
    if (this.recordCriterion(violation, met)) {
      this.decisions.update((decisions) => ({ ...decisions, [violation.criterion.id]: decision }));
    }
    this.advance();
  }

  /**
   * Record the criterion behind an objection, in whichever of the two lists it stands. Reports whether
   * it was recorded; the editorial ones always are — their property simply takes the change.
   */
  private recordCriterion(violation: CriterionViolation, met: boolean): boolean {
    if (!violation.editorial) return this.setCriterion(violation.criterion, met);
    this.setEditorialCriterion(violation.criterion, met);
    return true;
  }

  /**
   * Move on to the next objection nobody has answered yet, searching forwards from the one on screen
   * and wrapping around — and where they are all answered, simply to the next one, so that an answer
   * given always moves the alert on.
   *
   * That last case is the alert opened again to go over the decisions: on the way through it for the
   * first time there is always an unanswered one left, and answering the final one folds the alert away
   * (see {@link alertOpen}) rather than showing whatever this picked.
   */
  private advance(): void {
    const violations = this.violations();
    if (violations.length < 2) return;
    const from = this.shown();
    for (let step = 1; step <= violations.length; step++) {
      const index = (from + step) % violations.length;
      if (!this.decisionOf(violations[index].criterion.id)) {
        this.shown.set(index);
        return;
      }
    }
    this.step(1);
  }

  /**
   * Take both answers apart per criterion, so every box can say what the machines made of it — the same
   * maps that chose the checks decide which result belongs to which criterion.
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
   * Tick every criterion the checks found in order, and record it as the machine's answer where the
   * valuespace can say so.
   *
   * *Every* check: where two of them bear on one criterion, one failure is enough to leave it open — a
   * content whose security headers are missing is not confirmed by an LLM finding its prose harmless.
   *
   * Only where nothing is recorded yet. The answers arrive about a minute after the content was
   * erschlossen, so the user may have answered in the meantime — and their answer is the one that
   * counts. The same goes for a content that already carries one, an "Ungeprüft" included: what is there
   * is not overwritten.
   *
   * A failed check ticks nothing and records nothing: the box already reads as unanswered, and the
   * verdict beside it says what was found.
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
   * Take these criteria over as the user's own: whatever the machine answered for them, the answer is
   * now theirs, so it stops being drawn as the machine's — see {@link aiAnswered}. The judgement itself
   * stays beside the criterion; it is a finding, and a person disagreeing with it does not unmake it.
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
   * The value id that means MET / VIOLATED on this criterion's property.
   *
   * Normally the value mapped to that entry of the quality vocabulary. A widget that maps *nothing*
   * is a plain yes/no one, whose value ids are the answer themselves — see {@link PLAIN_MET}. The
   * distinction matters: a mapped vocabulary that simply lacks the entry has no answer to give, and
   * falling through to a bare id would then pick an unrelated value out of a rating scale.
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
