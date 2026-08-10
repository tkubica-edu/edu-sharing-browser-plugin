import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT, HOME_REPOSITORY, MdsDefinition, MdsService, MdsValue, MdsWidget
} from 'ngx-edu-sharing-api';

import { ContentJudgeEvaluation, ContentJudgeService } from '../services/content-judge.service';
import { MetalookupResource, MetalookupService } from '../services/metalookup.service';
import {
  CriterionJudgement, judgementsForCriteria, schemesForCriteria
} from '../util/quality-schemes';

/** Every property as `string[]` — the shape the repository and the MDS editor both expect. */
export type CriteriaProperties = Record<string, string[]>;

/** Log prefix for what this view finds out about the content, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';
const LOG_METALOOKUP = '[edu-sharing][metalookup]';
const LOG_CONTENT_JUDGE = '[edu-sharing][contentjudge]';

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
 * "Fachliche Qualitätskriterien": the two lists of criteria a content is judged by, and the
 * confirmation that follows from them.
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
 * It also has two services judge the content on its own, because the criteria are what they are asked
 * about: MetalookUp measures the resource itself, and ContentJudge assesses its text against the
 * schemes the criteria map to (see `schemesForCriteria`). What ContentJudge finds in order is reported
 * as an answer to that criterion, like a click on its box would be; the rest is shown beside it.
 * The content they judge comes in as {@link pageUrl} / {@link pageText} / {@link nodeId} rather than
 * being read here — reading the open page is the extension's business, and staying out of it is what
 * keeps this component shippable on its own.
 */
@Component({
  selector: 'es-quality-criteria',
  templateUrl: './quality-criteria.component.html',
  styleUrl: './quality-criteria.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCriteriaComponent {
  private readonly mdsService = inject(MdsService);
  private readonly metalookup = inject(MetalookupService);
  private readonly contentJudge = inject(ContentJudgeService);

  /** What the content records right now — its node properties, or the metadata standing in for them. */
  readonly properties = input<Record<string, unknown> | null>(null);

  /** The address of the content being judged; empty while none is known. */
  readonly pageUrl = input('');

  /**
   * The content's text as ContentJudge should judge it — already picked and cut to the length the API
   * accepts (see `judgeableText`, which the host applies to the page it read). Empty means the page
   * yielded nothing to judge, which is an outcome rather than an error.
   */
  readonly pageText = input('');

  /** The repository's id for the content, where it already has one; empty otherwise. */
  readonly nodeId = input('');

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

  /** Raised when the quality is confirmed. What that records is the host's to decide. */
  readonly confirm = output<void>();

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

  /**
   * Whether a check is still running. Read off the services rather than tracked here: each of them
   * already knows, and they finish at their own pace — the spinner is gone once the slower one is.
   */
  protected readonly checking = computed(
    () => this.metalookup.running() || this.contentJudge.running()
  );

  /**
   * The criteria whose answer the check put there rather than a person — what is drawn in the machine's
   * colour, so nobody takes a filled-in box for someone's decision.
   *
   * A criterion the user answers themselves drops out of it again (see {@link takeOver}): the mark says
   * where the value came from, and from then on it comes from somewhere else.
   */
  private readonly aiAnswered = signal<readonly string[]>([]);

  /** Whether anything on screen carries a machine's answer — for the legend that explains the colour. */
  protected readonly hasAiAnswers = computed(() => this.aiAnswered().length > 0);

  /** Whether the two services have been asked about this content; see {@link judge}. */
  private judged = false;

  /**
   * What ContentJudge answered per criterion, keyed by criterion id — empty until it answered.
   *
   * Shown beside every criterion, whichever way it went; a criterion it found in order is also ticked
   * (see {@link tickJudged}). Kept as its own state rather than derived from the record, because the
   * record only holds the answer — the score behind it, and the wording the scheme gave it, are here.
   */
  private readonly judgements = signal<Record<string, CriterionJudgement>>({});

  constructor() {
    // The criteria belong to the set, so they are re-read whenever it (or the repository) changes.
    effect(() => void this.load(this.metadataSet(), this.repository()));

    // Judge once, as soon as there is both something to ask about and something to ask with: the
    // criteria decide which schemes ContentJudge is given, the content is what both services judge.
    // Once per mounting of this view — a re-judgement on every change of the record would ask the same
    // question of the same content again.
    effect(() => {
      const criteria = this.criterionIds();
      const resource = { url: this.pageUrl(), nodeId: this.nodeId() };
      const text = this.pageText();
      if (this.judged || !criteria.length) return;
      if (!resource.url && !resource.nodeId && !text) return;
      this.judged = true;
      void this.judge(criteria, resource, text);
    });
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

  /** What the machine made of this criterion; null while nothing judged it — see {@link judgements}. */
  protected judgementOf(criterion: MdsValue): CriterionJudgement | null {
    return this.judgements()[criterion.id] ?? null;
  }

  /** Whether this criterion's answer is the machine's — see {@link aiAnswered}. */
  protected isAiAnswered(criterion: MdsValue): boolean {
    return this.aiAnswered().includes(criterion.id);
  }

  /**
   * The verdict in one line: the scheme's own wording, and the number behind it. Cut to two decimals —
   * the rubrics answer with a weighted average, and its third decimal says nothing.
   */
  protected judgementText(judgement: CriterionJudgement): string {
    const value = judgement.value === null ? '–' : String(Math.round(judgement.value * 100) / 100);
    return judgement.label ? `${judgement.label} (${value})` : value;
  }

  /** Which scheme said it, and how sure it was — for the row's tooltip. */
  protected judgementTitle(judgement: CriterionJudgement): string {
    const confidence =
      judgement.confidence === null ? '' : `, Konfidenz ${Math.round(judgement.confidence * 100)} %`;
    return `ContentJudge: ${judgement.scheme}${confidence}`;
  }

  /** Record a knock-out criterion as met or as violated — one property each. */
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

  protected onConfirm(): void {
    this.confirm.emit();
  }

  /** What is wrong right now: this view's own complaint, else whatever the host reports. */
  protected readonly problemShown = computed(() => this.error() ?? this.problem());

  /**
   * Have both services judge the content, side by side. `allSettled`, so one that fails — a service
   * that is down, a credential that is missing — leaves the other's answer standing.
   *
   * Nothing of what comes back is applied to the criteria yet; it is logged, and what to make of it is
   * the next question.
   */
  private async judge(
    criteria: readonly string[],
    resource: MetalookupResource,
    text: string
  ): Promise<void> {
    console.log(`${LOG_QUALITY} criteria`, {
      legal: this.knockoutCriteria().map((criterion) => ({
        id: criterion.id,
        caption: this.captionOf(criterion),
        met: this.isMet(criterion)
      })),
      editorial: this.editorialCriteria().map((criterion) => ({
        id: criterion.id,
        caption: this.captionOf(criterion),
        met: this.isEditorialMet(criterion)
      }))
    });
    const schemes = schemesForCriteria(criteria);
    console.log(`${LOG_QUALITY} schemes`, schemes);
    await Promise.allSettled([
      this.runMetalookup(resource),
      this.runContentJudge(criteria, text, schemes.schemes)
    ]);
  }

  /**
   * MetalookUp retrieves the resource itself, so it is given what identifies it: the address, and the
   * node id for a content the repository already holds. It takes either, and with both it can choose.
   */
  private async runMetalookup(resource: MetalookupResource): Promise<void> {
    if (!resource.url && !resource.nodeId) {
      console.log(`${LOG_METALOOKUP} skipped — the content has neither an address nor a node`);
      return;
    }
    try {
      // Built here only to log what goes out; the call assembles its own, from the same pure method.
      console.log(`${LOG_METALOOKUP} → request`, this.metalookup.requestBody(resource));
      console.log(`${LOG_METALOOKUP} ← response`, await this.metalookup.evaluate(resource));
    } catch (cause: unknown) {
      console.warn(`${LOG_METALOOKUP} evaluation failed`, cause);
    }
  }

  /** ContentJudge judges the content's text against one scheme per criterion that has one. */
  private async runContentJudge(
    criteria: readonly string[],
    text: string,
    schemes: readonly string[]
  ): Promise<void> {
    if (!schemes.length) {
      console.log(`${LOG_CONTENT_JUDGE} skipped — no criterion maps to a scheme`);
      return;
    }
    if (!text) {
      console.log(`${LOG_CONTENT_JUDGE} skipped — the content yielded too little text to judge`);
      return;
    }
    try {
      // The schemes and how much text they get — not the text itself, which is up to 50000 characters
      // and would bury the answer it is logged next to.
      console.log(`${LOG_CONTENT_JUDGE} → request`, { schemes, textLength: text.length });
      const evaluation = await this.contentJudge.evaluate(text, schemes);
      console.log(`${LOG_CONTENT_JUDGE} ← response`, evaluation);
      this.takeJudgements(criteria, evaluation);
    } catch (cause: unknown) {
      console.warn(`${LOG_CONTENT_JUDGE} evaluation failed`, cause);
    }
  }

  /**
   * Take the answer apart per criterion, so every box can say what the machine made of it — the same
   * map that chose the schemes decides which result belongs to which criterion.
   */
  private takeJudgements(criteria: readonly string[], evaluation: ContentJudgeEvaluation): void {
    const judgements = judgementsForCriteria(criteria, evaluation);
    this.judgements.set(judgements);
    console.log(
      `${LOG_QUALITY} judgement`,
      Object.values(judgements).map((judgement) => ({
        caption: this.captionById(judgement.criterion),
        ...judgement
      }))
    );
    this.tickJudged(judgements);
  }

  /**
   * Tick every criterion the check found in order, and record it as the machine's answer where the
   * valuespace can say so.
   *
   * Only where nothing is recorded yet. The judgement arrives about a minute after the view opened, so
   * the user may have answered in the meantime — and their answer is the one that counts. The same goes
   * for a content that already carries one, an "Ungeprüft" included: what is there is not overwritten.
   *
   * A failed check ticks nothing and records nothing: the box already reads as unanswered, and the
   * verdict beside it says what was found.
   */
  private tickJudged(judgements: Record<string, CriterionJudgement>): void {
    const values: CriteriaProperties = {};
    const editorial = [...this.valueOfProperty(EDITORIAL_PROPERTY)];
    // Coarse on purpose: the editorial criteria share one property, so a single click of the user's
    // makes the whole list theirs — there is no telling which of its entries they decided about.
    const editorialAnswered = !!this.changes()[EDITORIAL_PROPERTY];
    const ticked: string[] = [];
    const left: Record<string, string> = {};

    for (const judgement of Object.values(judgements)) {
      const criterion = judgement.criterion;
      if (judgement.met !== true) continue;
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
