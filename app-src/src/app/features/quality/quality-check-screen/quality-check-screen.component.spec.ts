import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MdsDefinition, MdsService } from 'ngx-edu-sharing-api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../../../config';
import { CurationFake, fakeCuration, fakeQualityJudge } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { CurationService } from '../../../services/curation.service';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import { QualityCheckScreenComponent } from './quality-check-screen.component';

/**
 * „Qualität", the first view of the Qualitätsprüfung. The criteria themselves are their own component;
 * this screen is the wiring around them — which set they are read from, that the record is tracked
 * rather than sampled, and that what the view reports goes to the flow and not into a node.
 */
describe('QualityCheckScreenComponent', () => {
  let fixture: ComponentFixture<QualityCheckScreenComponent>;
  let curation: CurationFake;

  /** A set with one knock-out criterion, which is what makes the view render anything at all. */
  const QUALITY = 'http://w3id.org/openeduhub/vocabs/quality';
  const aSet = () =>
    ({
      id: 'mds_oeh',
      widgets: [
        {
          id: 'virtual:unmetLegalCriteria',
          values: [{ id: 'ccm:oeh_quality_neutralness', caption: 'Neutralität' }],
        },
        {
          id: 'ccm:oeh_quality_neutralness',
          values: [
            { id: 'neutral', caption: 'Neutral', alternativeIds: [`${QUALITY}/3`, '3'] },
            { id: 'einseitig', caption: 'Einseitig', alternativeIds: [`${QUALITY}/0`, '0'] },
          ],
        },
      ],
    }) as unknown as MdsDefinition;

  const mds = {
    getMetadataSet: vi.fn((_request: { repository?: string; metadataSet?: string }) => of(aSet())),
  };

  beforeEach(async () => {
    mds.getMetadataSet.mockClear();
    curation = fakeCuration();
    TestBed.configureTestingModule({
      imports: [QualityCheckScreenComponent],
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(QualityJudgeService, fakeQualityJudge().fake),
        provideFake(MdsService, mds as never),
      ],
    });
    fixture = TestBed.createComponent(QualityCheckScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /** The criteria view this screen is built around. */
  const criteria = (): HTMLElement => fixture.nativeElement.querySelector('es-quality-criteria');

  /** The box of the one criterion the set defines — where both reports come from. */
  const box = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('.criteria-column input[type="checkbox"]');

  /** Answer it the way a person does, and let what follows settle. */
  async function tick(checked = true): Promise<void> {
    const input = box();
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('reads the criteria out of the WLO set, which is the only place they are defined', () => {
    expect(mds.getMetadataSet).toHaveBeenCalledWith({
      repository: '-home-',
      metadataSet: APP_CONFIG.metadataSet,
    });
  });

  it('has the content judged, which is a no-op for one judged on its way here', () => {
    expect(curation.fake.judgeQuality).toHaveBeenCalled();
  });

  it('shows the criteria', () => {
    expect(criteria()).not.toBeNull();
  });

  it('tracks the record rather than sampling it, since a node picked from the Verlauf still loads', () => {
    expect(box().checked).toBe(false);

    // A record read once would stay as it was, and the first click would write the view's idea of the
    // answers over the content's.
    curation.fake.editorMetadata.set({ 'ccm:oeh_quality_neutralness': ['neutral'] });
    fixture.detectChanges();

    expect(box().checked).toBe(true);
  });

  it('records what the criteria view reports, and writes nothing itself', async () => {
    await tick();

    expect(curation.fake.recordValues).toHaveBeenCalledWith({
      'ccm:oeh_quality_neutralness': ['neutral'],
    });
    expect(curation.fake.saveCollected).not.toHaveBeenCalled();
  });

  it('passes the gate on to the flow, where both things hanging off it live', async () => {
    expect(curation.fake.reportQualityCriteria).toHaveBeenLastCalledWith(false);

    await tick();

    expect(curation.fake.reportQualityCriteria).toHaveBeenLastCalledWith(true);
  });

  it('tells the view whether the quality is already confirmed', async () => {
    curation.fake.qualityConfirmed.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Die Qualität ist bestätigt.');
  });
});
