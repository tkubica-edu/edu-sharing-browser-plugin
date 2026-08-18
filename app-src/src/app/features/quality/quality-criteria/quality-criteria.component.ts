import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT, HOME_REPOSITORY, MdsDefinition, MdsService, MdsValue, MdsWidget
} from 'ngx-edu-sharing-api';

import { IconDirective } from '../../../directives/icon.directive';
// Type-only: the answers are fetched by the service, this view only reads what came back.
import type { ContentJudgeEvaluation } from '../../../services/content-judge.service';
import type { MetalookupEvaluation } from '../../../services/metalookup.service';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import {
  CRITERION_MET, CRITERION_VIOLATED, EDITORIAL_CRITERIA_PROPERTY, KNOCKOUT_CRITERIA_WIDGET, autoMetValue,
  valueFor, widgetOf
} from '../../../util/quality-criteria-values';
import {
  CriterionJudgement, CriterionViolation, judgementsForCriteria
} from '../../../util/quality-schemes';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import {
  CheckState, QualityCheckAlertComponent
} from '../quality-check-alert/quality-check-alert.component';

/** Every property as `string[]` — the shape the repository and the MDS editor both expect. */
export type CriteriaProperties = Record<string, string[]>;

/**
 * How a person answered a machine's objection — read off the criterion's box, which is where it is
 * answered: a ticked box dismisses it, an empty one confirms it.
 */
export type ViolationDecision = 'confirmed' | 'dismissed';

/** Log prefix for what this view finds out about the content, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';

/**
 * The editorial criteria: one multi-value property whose widget's values are the criteria. One is met
 * while its id is among the values — the opposite of the knock-out ones, where a value is the objection.
 */
const EDITORIAL_PROPERTY = EDITORIAL_CRITERIA_PROPERTY;

/** Coerce a property value of unknown shape to the `string[]` everything here works in. */
function asList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry));
}

/**
 * "Fachliche Qualitätskriterien": the two lists of criteria a content is judged by, plus whether they allow the
 * confirmation. Self-contained — properties in, changes out, nothing written here, which is what lets it judge a
 * content that has no node yet. The machines' judgement ticks what they found and puts their objections to the user.
 */
@Component({
  selector: 'es-quality-criteria',
  imports: [IconDirective, QualityCheckAlertComponent, SpinnerComponent],
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
   * What the judges answered per criterion id, several answers where several checks bear on one. Empty
   * until every check is back, so the criteria show a whole result rather than a growing one; a ticked
   * criterion keeps its finding here.
   */
  private readonly judgements = signal<Record<string, CriterionJudgement[]>>({});

  /**
   * What a person decided about each objection, keyed by criterion id. Per criterion rather than per
   * finding: two checks objecting to one criterion are two arguments about the same question.
   */
  private readonly decisions = signal<Record<string, ViolationDecision>>({});

  /** The criteria whose objection has been answered — what moves the alert on to the next open one. */
  protected readonly decidedIds = computed(() => Object.keys(this.decisions()));

  constructor() {
    // The criteria belong to the set, so they are re-read whenever it (or the repository) changes.
    effect(() => void this.load(this.metadataSet(), this.repository()));

    // Take the judgements over once every check is back and the criteria to map them onto are there: a
    // criterion the faster judge found in order can still be objected to by the slower one. All four
    // signals are read before the first return, so the run after the last check happens.
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
    () => this.widget(KNOCKOUT_CRITERIA_WIDGET)?.values ?? []
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
   * How far the machines got. The wait covers the metadata set: until the criteria are there nothing can
   * be said to have been found. `unavailable` where not one judge got through, so nothing is claimed
   * either way; one answer is enough for `done`.
   */
  protected readonly checkState = computed<CheckState>(() => {
    if (this.checking() || this.loading()) return 'running';
    if (this.violations().length) return 'violations';
    if (!this.judgeStatuses().some((status) => status.state === 'done')) return 'unavailable';
    return 'done';
  });

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
   * none. Only these gate the confirmation. False while the set is still being read, so the gate never
   * opens just because nothing has loaded yet.
   */
  private readonly knockoutSatisfied = computed(
    () => !this.loading() && (this.knockoutCriteria().length === 0 || this.allKnockoutMet()),
  );

  /**
   * Whether a knock-out criterion is met: the value a person's confirmation writes, or the one a
   * machine's all-clear writes. Everything else counts as not met, so a tick is always something that
   * was established — the confirmation hangs off these boxes.
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
    if (this.confirmed()) return;
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
    if (this.confirmed()) return;
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
    if (this.confirmed()) return;
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
    if (this.confirmed()) return;
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

  /**
   * Note that an objection has been answered — on the criterion's own box, by the same click that records
   * the value. The alert then moves on to what is still open, since answering one question is what asks
   * the next.
   */
  private decide(criterion: string, met: boolean): void {
    if (!this.hasObjection(criterion)) return;
    this.decisions.update((decisions) => ({
      ...decisions,
      [criterion]: met ? 'dismissed' : 'confirmed'
    }));
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
   * Tick every criterion the checks found in order, as the machine's answer where the valuespace can say
   * so. Every check must agree: one failure leaves the criterion open. Only where nothing is recorded
   * yet — the answers arrive later, so the user may have answered in the meantime.
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

  /** The widget of a criterion's property, from the loaded set. */
  private widget(id: string): MdsWidget | undefined {
    return widgetOf(this.mds()?.widgets, id);
  }

  /** {@link valueFor} for a property of the loaded set. */
  private valueFor(property: string, vocabularyId: string): string | undefined {
    return valueFor(this.widget(property), vocabularyId);
  }

  /** {@link autoMetValue} for a property of the loaded set. */
  private autoMetValue(property: string): string | undefined {
    return autoMetValue(this.widget(property));
  }

  /** A property as it stands: what was changed here, else what was handed in. */
  private valueOfProperty(property: string): string[] {
    const changed = this.changes()[property];
    return changed ?? asList(this.properties()?.[property]);
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
