import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT, HOME_REPOSITORY, MdsDefinition, MdsService, MdsValue, MdsWidget
} from 'ngx-edu-sharing-api';

/** Every property as `string[]` — the shape the repository and the MDS editor both expect. */
export type CriteriaProperties = Record<string, string[]>;

/**
 * The valuespace ids a criterion's value carries in `alternativeIds` — from the quality vocabulary
 * (https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/quality). A criterion is *met* when the
 * property holds the value that maps to MET, or holds nothing at all: nothing recorded means nothing
 * objected to, which is how a content that was never judged starts out.
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
 */
@Component({
  selector: 'es-quality-criteria',
  templateUrl: './quality-criteria.component.html',
  styleUrl: './quality-criteria.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCriteriaComponent {
  private readonly mdsService = inject(MdsService);

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

  /** Raised when the quality is confirmed. What that records is the host's to decide. */
  readonly confirm = output<void>();

  /** The metadata set's definition; null until it is loaded. */
  private readonly mds = signal<MdsDefinition | null>(null);

  /**
   * The changes made here, over the properties handed in. Kept because the input is not written back
   * synchronously — a host that stores the reported values re-supplies them, and one that does not
   * still gets a view that answers to its own clicks.
   */
  private readonly changes = signal<CriteriaProperties>({});

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // The criteria belong to the set, so they are re-read whenever it (or the repository) changes.
    effect(() => void this.load(this.metadataSet(), this.repository()));

    // A different content is a different record: what was changed here is about the previous one.
    effect(() => {
      this.properties();
      this.changes.set({});
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
   * Whether a knock-out criterion is met: the record holds exactly the value that means met, or
   * holds nothing for it. Everything else counts as not met — including the vocabulary's own
   * "Ungeprüft" and its machine-checked answers, which are findings rather than a confirmation.
   */
  protected isMet(criterion: MdsValue): boolean {
    const recorded = this.valueOfProperty(criterion.id)[0];
    return !recorded || recorded === this.valueFor(criterion.id, CRITERION_MET);
  }

  /** Whether an editorial criterion is met: its id is among the property's values. */
  protected isEditorialMet(criterion: MdsValue): boolean {
    return this.valueOfProperty(EDITORIAL_PROPERTY).includes(criterion.id);
  }

  /** What the row is labelled: the criterion's own caption, falling back to its bare id. */
  protected captionOf(criterion: MdsValue): string {
    return criterion.caption || criterion.id;
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
    this.report({ [criterion.id]: [value] });
  }

  /** Record an editorial criterion by adding it to the property's values, or taking it out. */
  protected setEditorialCriterion(criterion: MdsValue, met: boolean): void {
    const current = this.valueOfProperty(EDITORIAL_PROPERTY);
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
    this.report(met);
  }

  /** Fulfil every editorial criterion at once: the property holds all of their ids. */
  protected setAllEditorial(): void {
    this.report({
      [EDITORIAL_PROPERTY]: this.editorialCriteria().map((criterion) => criterion.id)
    });
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
