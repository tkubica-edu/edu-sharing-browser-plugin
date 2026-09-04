import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MdsDefinition, MdsService, MdsValue, MdsWidget } from 'ngx-edu-sharing-api';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  QualityJudgeFake,
  aJudgement,
  aMeasurement,
  fakeQualityJudge,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import { CriteriaProperties, QualityCriteriaComponent } from './quality-criteria.component';

/** The vocabulary the criteria's answers are mapped through. */
const QUALITY = 'http://w3id.org/openeduhub/vocabs/quality';

/** The two properties the component reads the lists out of. */
const KNOCKOUT_WIDGET = 'virtual:unmetLegalCriteria';
const EDITORIAL_PROPERTY = 'ccm:oeh_buffet_criteria';

/** A knock-out criterion the neutrality scheme judges, so ContentJudge can answer for it. */
const NEUTRALNESS = 'ccm:oeh_quality_neutralness';

/** One nothing judges — the criterion a person has to answer themselves. */
const COPYRIGHT = 'ccm:oeh_quality_copyright_law';

/** An editorial criterion MetalookUp measures, which is the only one it has a check for. */
const ACCESSIBLE = 'accessible';

/** And one ContentJudge rates. */
const CONTENT_VALID = 'content_valid';

/** How a machine's all-clear is recorded, recognised by the term at the end of the URI. */
const AUTO_MET = `${QUALITY}/no_auto_findings`;

function aWidget(id: string, values: MdsValue[]): MdsWidget {
  return { id, values } as unknown as MdsWidget;
}

/**
 * A metadata set as the criteria view reads one: the two lists, plus a widget per knock-out criterion
 * whose values carry the vocabulary ids that say what a tick means.
 *
 * `ccm:oeh_quality_neutralness` additionally offers the machine's all-clear
 * (`…/no_auto_findings`), which is the value a check's own tick is written as.
 */
function aSet(overrides: Partial<MdsDefinition> = {}): MdsDefinition {
  return {
    id: 'mds_oeh',
    widgets: [
      aWidget(KNOCKOUT_WIDGET, [
        { id: NEUTRALNESS, caption: 'Neutralität' },
        { id: COPYRIGHT, caption: 'Urheberrecht' },
      ] as MdsValue[]),
      aWidget(EDITORIAL_PROPERTY, [
        { id: CONTENT_VALID, caption: 'Sachrichtigkeit' },
        { id: ACCESSIBLE, caption: 'Barrierearmut' },
      ] as MdsValue[]),
      // The answers carry the quality vocabulary's own ids beside their names, which is what says
      // which of them means met and which violated; the all-clear is recognised by its *term*
      // instead, so that value's id is the vocabulary URI itself.
      aWidget(NEUTRALNESS, [
        { id: 'neutral', caption: 'Neutral', alternativeIds: [`${QUALITY}/3`, '3'] },
        { id: 'einseitig', caption: 'Einseitig', alternativeIds: [`${QUALITY}/0`, '0'] },
        { id: AUTO_MET, caption: 'Ohne maschinellen Befund' },
      ] as MdsValue[]),
      aWidget(COPYRIGHT, [
        { id: 'frei', caption: 'Frei', alternativeIds: [`${QUALITY}/3`, '3'] },
        { id: 'verstoss', caption: 'Verstoß', alternativeIds: [`${QUALITY}/0`, '0'] },
      ] as MdsValue[]),
    ],
    ...overrides,
  } as MdsDefinition;
}

describe('QualityCriteriaComponent', () => {
  let fixture: ComponentFixture<QualityCriteriaComponent>;
  let judge: QualityJudgeFake;

  /** What the repository hands over for the set the component asks about. */
  let published: Observable<MdsDefinition>;

  /** Every change the view reported, in order. */
  let reported: CriteriaProperties[];

  /** Every answer it gave about the gate. */
  let gate: boolean[];

  const mds = {
    getMetadataSet: vi.fn((_request: { repository?: string; metadataSet?: string }) => published),
  };

  beforeEach(() => {
    published = of(aSet());
    mds.getMetadataSet.mockClear();
    judge = fakeQualityJudge();
    reported = [];
    gate = [];
    TestBed.configureTestingModule({
      imports: [QualityCriteriaComponent],
      providers: [
        provideFake(MdsService, mds as never),
        provideFake(QualityJudgeService, judge.fake),
      ],
    });
  });

  /** Render the view over the properties a content records right now. */
  async function render(properties: Record<string, unknown> | null = {}): Promise<void> {
    fixture = TestBed.createComponent(QualityCriteriaComponent);
    fixture.componentRef.setInput('properties', properties);
    fixture.componentInstance.propertiesChange.subscribe((values) => reported.push(values));
    fixture.componentInstance.knockoutSatisfiedChange.subscribe((open) => gate.push(open));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Let the effects run over whatever was just set. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';

  /** The rows of one list, as the template lays them out. */
  function rows(column: 0 | 1): HTMLLIElement[] {
    const columns = fixture.nativeElement.querySelectorAll('.criteria-column');
    return Array.from(columns[column]?.querySelectorAll('li') ?? []);
  }

  /** One criterion's row, by the caption it is labelled with. */
  function row(caption: string): HTMLLIElement {
    const all = [...rows(0), ...rows(1)];
    const found = all.find((entry) => (entry.textContent ?? '').includes(caption));
    if (!found) throw new Error(`no row for ${caption} in: ${all.map((e) => e.textContent).join(' | ')}`);
    return found;
  }

  /** Its box, which is where every answer is given. */
  function box(caption: string): HTMLInputElement {
    return row(caption).querySelector('input')!;
  }

  /** Tick or untick a criterion the way a person does. */
  async function click(caption: string, checked = true): Promise<void> {
    const input = box(caption);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  /** The three shortcuts under the lists. */
  function bulkBoxes(): HTMLInputElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.criteria-bulk input'));
  }

  describe('before there is anything to show', () => {
    it('waits for the metadata set', () => {
      fixture = TestBed.createComponent(QualityCriteriaComponent);
      fixture.componentRef.setInput('properties', {});
      fixture.detectChanges();

      expect(text()).toContain('Die Qualitätskriterien werden geladen');
      expect(fixture.nativeElement.querySelector('.criteria-group')).toBeNull();
    });

    it('waits for the content record as well, since every box shows what it answers', async () => {
      await render(null);

      expect(text()).toContain('Die Qualitätskriterien werden geladen');
    });

    it('says so where the set holds no criteria for this content', async () => {
      published = of(aSet({ widgets: [] }));

      await render();

      expect(text()).toContain('keine Qualitätskriterien bereit');
    });

    it('shows a set that could not be read as one that holds no criteria', async () => {
      published = throwError(() => new Error('mds unreachable'));

      await render();

      // What the code does. The load records „Die Qualitätskriterien konnten nicht geladen werden.",
      // but the only place the template renders a problem sits inside the branch that needs criteria
      // to have loaded — so what the person is told is that the set defines none.
      expect(text()).toContain('keine Qualitätskriterien bereit');
      expect(text()).not.toContain('konnten nicht geladen werden');
    });

    it('re-reads the criteria when the set it is pointed at changes', async () => {
      await render();
      expect(mds.getMetadataSet).toHaveBeenCalledWith({ repository: '-home-', metadataSet: '-default-' });

      fixture.componentRef.setInput('metadataSet', 'mds_custom');
      await settle();

      expect(mds.getMetadataSet).toHaveBeenLastCalledWith({
        repository: '-home-',
        metadataSet: 'mds_custom',
      });
    });
  });

  describe('the two lists', () => {
    beforeEach(() => render());

    it('shows the criteria of each, by their captions', () => {
      expect(rows(0).map((entry) => entry.textContent?.trim())).toEqual(['Neutralität', 'Urheberrecht']);
      expect(rows(1).map((entry) => entry.textContent?.trim())).toEqual(['Sachrichtigkeit', 'Barrierearmut']);
    });

    it('falls back to the bare id for a criterion the set gives no caption', async () => {
      published = of(
        aSet({
          widgets: [aWidget(KNOCKOUT_WIDGET, [{ id: 'ccm:oeh_quality_data_privacy' }] as MdsValue[])],
        }),
      );

      await render();

      expect(rows(0)[0].textContent?.trim()).toBe('ccm:oeh_quality_data_privacy');
    });
  });

  describe('what a box shows', () => {
    it('is ticked for a criterion the record answers as met', async () => {
      await render({ [NEUTRALNESS]: ['neutral'] });

      expect(box('Neutralität').checked).toBe(true);
      expect(box('Urheberrecht').checked).toBe(false);
    });

    it('is empty for one answered as violated, since a tick is always something established', async () => {
      await render({ [NEUTRALNESS]: ['einseitig'] });

      expect(box('Neutralität').checked).toBe(false);
    });

    it('is ticked for the machine own all-clear as well', async () => {
      await render({ [NEUTRALNESS]: [AUTO_MET] });

      expect(box('Neutralität').checked).toBe(true);
    });

    it('is empty for a value the vocabulary does not map at all', async () => {
      await render({ [NEUTRALNESS]: ['irgendwas'] });

      expect(box('Neutralität').checked).toBe(false);
    });

    it('is ticked for an editorial criterion the shared property names', async () => {
      await render({ [EDITORIAL_PROPERTY]: [CONTENT_VALID] });

      expect(box('Sachrichtigkeit').checked).toBe(true);
      expect(box('Barrierearmut').checked).toBe(false);
    });
  });

  describe('answering a criterion', () => {
    beforeEach(() => render());

    it('records a knock-out criterion under its own property', async () => {
      await click('Neutralität');

      expect(reported).toContainEqual({ [NEUTRALNESS]: ['neutral'] });
    });

    it('records the violation where the box is emptied', async () => {
      await click('Neutralität');
      await click('Neutralität', false);

      expect(reported[reported.length - 1]).toEqual({ [NEUTRALNESS]: ['einseitig'] });
    });

    it('answers its own click, so the box moves without the host feeding anything back', async () => {
      await click('Neutralität');

      expect(box('Neutralität').checked).toBe(true);
    });

    it('adds an editorial criterion to the shared property, keeping the others', async () => {
      await click('Barrierearmut');
      await click('Sachrichtigkeit');

      expect(reported[reported.length - 1]).toEqual({
        [EDITORIAL_PROPERTY]: [ACCESSIBLE, CONTENT_VALID],
      });
    });

    it('takes one out again without disturbing the rest', async () => {
      await click('Barrierearmut');
      await click('Sachrichtigkeit');

      await click('Barrierearmut', false);

      expect(reported[reported.length - 1]).toEqual({ [EDITORIAL_PROPERTY]: [CONTENT_VALID] });
    });

    it('records nothing where the vocabulary holds no value for what the click means', async () => {
      published = of(
        aSet({
          widgets: [
            aWidget(KNOCKOUT_WIDGET, [{ id: NEUTRALNESS, caption: 'Neutralität' }] as MdsValue[]),
            aWidget(NEUTRALNESS, [{ id: 'unklar', caption: 'Unklar' }] as MdsValue[]),
          ],
        }),
      );
      await render();

      await click('Neutralität');

      // The criterion decides whether the content may be published, so saying nothing beats
      // recording something else.
      expect(reported).toEqual([]);
      expect(text()).toContain('Für „Neutralität“ ist kein passender Wert hinterlegt.');
    });
  });

  describe('the shortcuts under the lists', () => {
    beforeEach(() => render());

    it('fulfils every knock-out criterion at once', async () => {
      bulkBoxes()[0].dispatchEvent(new Event('change'));
      await settle();

      expect(reported[reported.length - 1]).toEqual({
        [NEUTRALNESS]: ['neutral'],
        [COPYRIGHT]: ['frei'],
      });
      expect(box('Neutralität').checked).toBe(true);
      expect(box('Urheberrecht').checked).toBe(true);
    });

    it('fulfils every editorial one', async () => {
      bulkBoxes()[1].dispatchEvent(new Event('change'));
      await settle();

      expect(reported[reported.length - 1]).toEqual({
        [EDITORIAL_PROPERTY]: [CONTENT_VALID, ACCESSIBLE],
      });
    });

    it('fulfils both lists together', async () => {
      bulkBoxes()[2].dispatchEvent(new Event('change'));
      await settle();

      expect(box('Neutralität').checked).toBe(true);
      expect(box('Sachrichtigkeit').checked).toBe(true);
    });

    it('is spent once its list is complete, being a shortcut to a state rather than a toggle', async () => {
      bulkBoxes()[0].dispatchEvent(new Event('change'));
      await settle();

      expect(bulkBoxes()[0].checked).toBe(true);
      expect(bulkBoxes()[0].disabled).toBe(true);
      expect(bulkBoxes()[1].disabled).toBe(false);
    });
  });

  describe('the gate the confirmation hangs off', () => {
    it('stays shut while the set is still being read', () => {
      fixture = TestBed.createComponent(QualityCriteriaComponent);
      fixture.componentRef.setInput('properties', {});
      fixture.componentInstance.knockoutSatisfiedChange.subscribe((open) => gate.push(open));
      fixture.detectChanges();

      expect(gate[0]).toBe(false);
    });

    it('stays shut while a knock-out criterion is unanswered', async () => {
      await render({ [NEUTRALNESS]: ['neutral'] });

      expect(gate[gate.length - 1]).toBe(false);
    });

    it('opens once every one of them is met', async () => {
      await render({ [NEUTRALNESS]: ['neutral'], [COPYRIGHT]: ['frei'] });

      expect(gate[gate.length - 1]).toBe(true);
    });

    it('opens where the set defines none at all', async () => {
      published = of(
        aSet({ widgets: [aWidget(EDITORIAL_PROPERTY, [{ id: CONTENT_VALID }] as MdsValue[])] }),
      );

      await render();

      expect(gate[gate.length - 1]).toBe(true);
    });

    it('is unmoved by the editorial list, which gates nothing', async () => {
      await render({ [NEUTRALNESS]: ['neutral'], [COPYRIGHT]: ['frei'] });

      await click('Sachrichtigkeit');

      expect(gate[gate.length - 1]).toBe(true);
    });

    it('shuts again when a criterion is taken back', async () => {
      await render({ [NEUTRALNESS]: ['neutral'], [COPYRIGHT]: ['frei'] });

      await click('Neutralität', false);

      expect(gate[gate.length - 1]).toBe(false);
    });
  });

  describe('once the quality is confirmed', () => {
    beforeEach(async () => {
      await render({ [NEUTRALNESS]: ['neutral'], [COPYRIGHT]: ['frei'] });
      fixture.componentRef.setInput('confirmed', true);
      await settle();
    });

    it('says so, and drops the ask that led there', () => {
      expect(text()).toContain('Die Qualität ist bestätigt.');
      expect(text()).not.toContain('Erst dann lässt sich die Qualität bestätigen');
    });

    it('locks every box, since the confirmation was given for exactly these answers', () => {
      expect(box('Neutralität').disabled).toBe(true);
      expect(box('Sachrichtigkeit').disabled).toBe(true);
      expect(bulkBoxes().every((entry) => entry.disabled)).toBe(true);
    });

    it('records nothing from a click that gets through anyway', async () => {
      reported = [];

      await click('Neutralität', false);
      bulkBoxes()[0].dispatchEvent(new Event('change'));
      bulkBoxes()[1].dispatchEvent(new Event('change'));
      await settle();

      expect(reported).toEqual([]);
    });
  });

  describe('what the machines made of the criteria', () => {
    /** A ContentJudge answer for the neutrality scheme, whose threshold is 3. */
    const neutrality = (value: number) =>
      aJudgement([{ scheme_id: 'neutralitaet', value, reasoning: 'weil', confidence: 0.9 }] as never);

    /** A MetalookUp measurement of the accessibility check, whose threshold is 0.9. */
    const accessibility = (value: number) =>
      aMeasurement([
        { propertyId: 'ccm:accessibilitySummary', value, description: 'AXE', confidence: 1 },
      ] as never);

    it('reports nothing at all before a check was asked for', async () => {
      await render();

      expect(fixture.nativeElement.querySelector('es-quality-check-alert')).toBeNull();
    });

    it('ticks a criterion a check found in order, and marks it as the machine answer', async () => {
      await render();

      judge.answered(neutrality(4));
      await settle();

      expect(box('Neutralität').checked).toBe(true);
      expect(row('Neutralität').querySelector('.auto-met')).not.toBeNull();
      expect(text()).toContain('bei unserer maschinellen Prüfung sind keine Auffälligkeiten');
      expect(reported[reported.length - 1]).toEqual({ [NEUTRALNESS]: [AUTO_MET] });
    });

    it('leaves a criterion the record already answers alone', async () => {
      await render({ [NEUTRALNESS]: ['neutral'] });

      judge.answered(neutrality(4));
      await settle();

      expect(reported).toEqual([]);
      expect(row('Neutralität').querySelector('.auto-met')).toBeNull();
    });

    it('drops the machine mark once the person answers the criterion themselves', async () => {
      await render();
      judge.answered(neutrality(4));
      await settle();

      await click('Neutralität', false);

      expect(row('Neutralität').querySelector('.auto-met')).toBeNull();
    });

    it('ticks an editorial criterion a measurement found in order', async () => {
      await render();

      judge.answered(null, accessibility(1));
      await settle();

      expect(box('Barrierearmut').checked).toBe(true);
      expect(reported[reported.length - 1]).toEqual({ [EDITORIAL_PROPERTY]: [ACCESSIBLE] });
    });

    it('leaves the whole editorial list alone once the person has touched it', async () => {
      await render();
      await click('Sachrichtigkeit');
      reported = [];

      judge.answered(null, accessibility(1));
      await settle();

      // Coarse on purpose: the list shares one property, so there is no telling which of its entries
      // the click was about.
      expect(reported).toEqual([]);
      expect(box('Barrierearmut').checked).toBe(false);
    });

    it('puts an objection to the person rather than answering it', async () => {
      await render();

      judge.answered(neutrality(1));
      await settle();

      expect(box('Neutralität').checked).toBe(false);
      expect(row('Neutralität').textContent).toContain('mögliche Auffälligkeit');
      expect(row('Neutralität').querySelector('.is-violated')).not.toBeNull();
    });

    it('counts the objection as looked at once the person answers it', async () => {
      await render();
      judge.answered(neutrality(1));
      await settle();

      await click('Neutralität');

      expect(row('Neutralität').textContent).toContain('geprüft');
      expect(row('Neutralität').querySelector('.violation.is-dismissed')).not.toBeNull();
      expect(row('Neutralität').querySelector('.is-violated')).toBeNull();
    });

    it('keeps the row in the alarm colour where the person confirmed the objection', async () => {
      await render();
      judge.answered(neutrality(1));
      await settle();

      await click('Neutralität', false);

      expect(row('Neutralität').textContent).toContain('geprüft');
      expect(row('Neutralität').querySelector('.is-violated')).not.toBeNull();
    });

    it('waits for both judges before showing what either found', async () => {
      await render();

      judge.judging();
      await settle();

      expect(reported).toEqual([]);
      expect(row('Neutralität').textContent).not.toContain('Auffälligkeit');
    });

    it('claims nothing either way where not one judge got through', async () => {
      await render();

      judge.unavailable();
      await settle();

      expect(reported).toEqual([]);
      expect(fixture.nativeElement.querySelector('es-quality-check-alert')).not.toBeNull();
    });
  });

  describe('what is wrong right now', () => {
    it('is what the host ran into, where this view found nothing of its own', async () => {
      await render();

      fixture.componentRef.setInput('problem', 'Die Bestätigung konnte nicht geschrieben werden.');
      await settle();

      expect(text()).toContain('Die Bestätigung konnte nicht geschrieben werden.');
    });

    it('is this view own complaint where it has one, which is about the click just made', async () => {
      published = of(
        aSet({
          widgets: [
            aWidget(KNOCKOUT_WIDGET, [{ id: NEUTRALNESS, caption: 'Neutralität' }] as MdsValue[]),
            aWidget(NEUTRALNESS, [{ id: 'unklar' }] as MdsValue[]),
          ],
        }),
      );
      await render();
      fixture.componentRef.setInput('problem', 'Etwas anderes ging schief.');
      await settle();

      await click('Neutralität');

      expect(text()).toContain('ist kein passender Wert hinterlegt');
      expect(text()).not.toContain('Etwas anderes ging schief.');
    });
  });
});
