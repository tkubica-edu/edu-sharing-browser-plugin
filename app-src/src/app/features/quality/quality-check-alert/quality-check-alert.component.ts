import {
  ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal
} from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { CriterionJudgement, CriterionViolation } from '../../../util/quality-schemes';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';

/**
 * How far the machines got with this content, as the alert reports it. `unavailable` means no check got
 * through at all — nothing the user can act on, so nothing is said about it.
 */
export type CheckState = 'running' | 'violations' | 'unavailable' | 'done';

/**
 * What the machines made of the content, above the criteria they judged: the wait, their all-clear, or the
 * objections one at a time. Display only — an objection is answered on the criterion's own box below, which
 * is the question it asks anyway, so this reports rather than collects.
 */
@Component({
  selector: 'es-quality-check-alert',
  imports: [IconDirective, SpinnerComponent],
  templateUrl: './quality-check-alert.component.html',
  styleUrl: './quality-check-alert.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckAlertComponent {
  /** How far the checks got; the fold below is this component's own business. */
  readonly state = input.required<CheckState>();

  /** The criteria the checks objected to, in the order the lists show them. */
  readonly violations = input.required<readonly CriterionViolation[]>();

  /** The criteria whose objection a person has answered, by criterion id. */
  readonly decidedIds = input<readonly string[]>([]);

  /**
   * Whether the user folded the objections away. They stay on screen until then: what a check found belongs
   * beside the criteria it is about, and answering it is no reason to take the argument away.
   */
  private readonly folded = signal(false);

  /** What is on screen: the fold turns the objections into the one line that leads back to them. */
  protected readonly shownState = computed<CheckState | 'handled'>(() => {
    const state = this.state();
    return state === 'violations' && this.folded() ? 'handled' : state;
  });

  /**
   * Which objection is shown. Clamped to what is there, since findings arrive while the view is open, and
   * moved on to the first unanswered one whenever a decision is taken — answering one question is what asks
   * the next.
   */
  protected readonly shown = linkedSignal<
    { violations: readonly CriterionViolation[]; decided: readonly string[] },
    number
  >({
    source: () => ({ violations: this.violations(), decided: this.decidedIds() }),
    computation: ({ violations, decided }, previous) => {
      const index = Math.min(previous?.value ?? 0, Math.max(violations.length - 1, 0));
      if (!decided.includes(violations[index]?.criterion.id ?? '')) return index;
      const open = violations.findIndex((violation) => !decided.includes(violation.criterion.id));
      return open >= 0 ? open : index;
    }
  });

  /** The objection on screen; null while there is none. */
  protected readonly current = computed<CriterionViolation | null>(
    () => this.violations()[this.shown()] ?? null
  );

  /** Whether every objection has been answered — only then may the alert be folded away. */
  protected readonly allDecided = computed(
    () =>
      this.violations().length > 0 &&
      this.violations().every((violation) => this.decidedIds().includes(violation.criterion.id))
  );

  /** What the row is labelled: the criterion's own caption, falling back to its bare id. */
  protected captionOf(violation: CriterionViolation): string {
    return violation.criterion.caption || violation.criterion.id;
  }

  /** What a check found, in its own words — its reasoning, else the bare verdict it gave. */
  protected findingText(finding: CriterionJudgement): string {
    if (finding.reasoning) return finding.reasoning;
    const measured = finding.value === null ? '–' : String(Math.round(finding.value * 100) / 100);
    return `${finding.scheme}: ${finding.label ?? measured}`;
  }

  protected openAlert(): void {
    this.folded.set(false);
  }

  protected closeAlert(): void {
    this.folded.set(true);
  }

  protected showPrevious(): void {
    this.step(-1);
  }

  protected showNext(): void {
    this.step(1);
  }

  /** Move through the objections, wrapping at either end. */
  private step(by: number): void {
    const count = this.violations().length;
    if (count < 2) return;
    this.shown.update((index) => (index + by + count) % count);
  }
}
