import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MdsValue } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { CriterionJudgement, CriterionViolation } from '../../../util/quality-schemes';
import { CheckState, QualityCheckAlertComponent } from './quality-check-alert.component';

/** What a check objected to, as the criteria view hands one over. */
function aViolation(
  id: string,
  caption: string,
  findings: Partial<CriterionJudgement>[] = [{}],
): CriterionViolation {
  return {
    criterion: { id, caption } as MdsValue,
    findings: findings.map((finding, index) => ({
      criterion: id,
      source: 'ContentJudge',
      scheme: `schema-${index}`,
      value: 1,
      label: null,
      confidence: 0.9,
      reasoning: null,
      met: false,
      ...finding,
    })) as CriterionJudgement[],
  };
}

/**
 * What the machines made of the content, above the criteria they judged. Display only: an objection is
 * answered on the criterion's own box below, so what this component decides is which objection is on
 * screen and whether the whole alert may be folded away.
 */
describe('QualityCheckAlertComponent', () => {
  let fixture: ComponentFixture<QualityCheckAlertComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [QualityCheckAlertComponent] });
    fixture = TestBed.createComponent(QualityCheckAlertComponent);
    fixture.componentRef.setInput('state', 'running');
    fixture.componentRef.setInput('violations', []);
    fixture.detectChanges();
  });

  /** Put the alert into a state and re-render. */
  function show(
    state: CheckState,
    violations: readonly CriterionViolation[] = [],
    decidedIds: readonly string[] = [],
  ): void {
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('violations', violations);
    fixture.componentRef.setInput('decidedIds', decidedIds);
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const count = (): string => fixture.nativeElement.querySelector('.alert-count')?.textContent ?? '';
  const lead = (): string => fixture.nativeElement.querySelector('.alert-lead')?.textContent ?? '';
  const reasons = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.alert-reason')).map((entry) =>
      ((entry as HTMLElement).textContent ?? '').trim(),
    );
  const arrows = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.alert-arrow'));

  /** Two objections, which is what the stepping is about. */
  const twoViolations = [
    aViolation('ccm:oeh_quality_neutralness', 'Neutralität', [{ reasoning: 'Einseitig formuliert.' }]),
    aViolation('accessible', 'Barrierearmut', [{ reasoning: 'Kontraste zu schwach.' }]),
  ];

  describe('while the checks are still out', () => {
    it('shows the wait and says nothing about what is being waited for', () => {
      show('running');

      expect(fixture.nativeElement.querySelector('.ai-check-waiting')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('es-spinner')).not.toBeNull();
    });
  });

  describe('once they are back', () => {
    it('reports the all-clear', () => {
      show('done');

      expect(text()).toContain('KI-Prüfung abgeschlossen');
    });

    it('says nothing at all where not one check got through', () => {
      show('unavailable');

      expect(text().trim()).toBe('');
    });
  });

  describe('an objection', () => {
    it('names the criterion it is about, and asks for a decision', () => {
      show('violations', [twoViolations[0]]);

      expect(lead()).toContain('Neutralität');
      expect(lead()).toContain('entscheide, ob das Kriterium erfüllt ist');
    });

    it('is quoted in the check own words', () => {
      show('violations', [twoViolations[0]]);

      expect(reasons()).toEqual(['„Einseitig formuliert.“']);
    });

    it('is stated as the bare verdict where the check gave no reasoning', () => {
      show('violations', [
        aViolation('accessible', 'Barrierearmut', [
          { reasoning: null, scheme: 'Barrierefreiheit (AXE)', value: 0.4567, label: null },
        ]),
      ]);

      expect(reasons()).toEqual(['„Barrierefreiheit (AXE): 0.46“']);
    });

    it('is stated by its label where the check gave one', () => {
      show('violations', [
        aViolation('accessible', 'Barrierearmut', [
          { reasoning: null, scheme: 'Barrierefreiheit (AXE)', value: 0.4, label: 'mangelhaft' },
        ]),
      ]);

      expect(reasons()).toEqual(['„Barrierefreiheit (AXE): mangelhaft“']);
    });

    it('shows every check that objected to the same criterion, all being its argument', () => {
      show('violations', [
        aViolation('accessible', 'Barrierearmut', [
          { reasoning: 'Kontraste zu schwach.', scheme: 'axe' },
          { reasoning: 'Keine Alternativtexte.', scheme: 'llm' },
        ]),
      ]);

      expect(reasons()).toHaveLength(2);
    });

    it('falls back to the bare id where the criterion carries no caption', () => {
      show('violations', [aViolation('accessible', '')]);

      expect(lead()).toContain('accessible');
    });
  });

  describe('leading through several objections', () => {
    it('shows one at a time, and how many there are', () => {
      show('violations', twoViolations);

      expect(count()).toBe('1/2');
      expect(lead()).toContain('Neutralität');
    });

    it('steps to the next', () => {
      show('violations', twoViolations);

      arrows()[1].click();
      fixture.detectChanges();

      expect(count()).toBe('2/2');
      expect(lead()).toContain('Barrierearmut');
    });

    it('wraps at either end', () => {
      show('violations', twoViolations);

      arrows()[0].click();
      fixture.detectChanges();

      expect(count()).toBe('2/2');

      arrows()[1].click();
      fixture.detectChanges();

      expect(count()).toBe('1/2');
    });

    it('offers no stepping for a single objection', () => {
      show('violations', [twoViolations[0]]);

      expect(arrows().every((arrow) => arrow.disabled)).toBe(true);
    });

    it('stays put where a single objection is stepped anyway', () => {
      show('violations', [twoViolations[0]]);

      arrows()[1].click();
      fixture.detectChanges();

      expect(count()).toBe('1/1');
    });

    it('moves on to the first unanswered one when a decision is taken', () => {
      show('violations', twoViolations);

      show('violations', twoViolations, ['ccm:oeh_quality_neutralness']);

      expect(count()).toBe('2/2');
      expect(lead()).toContain('Barrierearmut');
    });

    it('stays where it is once every objection is answered', () => {
      show('violations', twoViolations, ['ccm:oeh_quality_neutralness', 'accessible']);

      expect(count()).toBe('1/2');
    });

    it('clamps to what is there when the findings shrink under it', () => {
      show('violations', twoViolations);
      arrows()[1].click();
      fixture.detectChanges();
      expect(count()).toBe('2/2');

      show('violations', [twoViolations[0]]);

      expect(count()).toBe('1/1');
    });
  });

  describe('folding the alert away', () => {
    it('is not offered while an objection is still open', () => {
      show('violations', twoViolations, ['ccm:oeh_quality_neutralness']);

      expect(fixture.nativeElement.querySelector('button.alert-close')).toBeNull();
    });

    it('is offered once every one of them is answered', () => {
      show('violations', twoViolations, ['ccm:oeh_quality_neutralness', 'accessible']);

      expect(fixture.nativeElement.querySelector('button.alert-close')).not.toBeNull();
    });

    it('leaves the way back to the findings', () => {
      show('violations', twoViolations, ['ccm:oeh_quality_neutralness', 'accessible']);

      (fixture.nativeElement.querySelector('button.alert-close') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.alert-body')).toBeNull();
      expect(text()).toContain('Hinweise der KI-Prüfung anzeigen');
    });

    it('brings them back, since a decision taken can be taken differently', () => {
      show('violations', twoViolations, ['ccm:oeh_quality_neutralness', 'accessible']);
      (fixture.nativeElement.querySelector('button.alert-close') as HTMLButtonElement).click();
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('button.ai-check-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.alert-body')).not.toBeNull();
    });
  });
});
