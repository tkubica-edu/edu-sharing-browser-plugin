import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  MetadataAgentFake,
  NavigationFake,
  fakeCuration,
  fakeMetadataAgent,
  fakeNavigation,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { CurationService } from '../../../services/curation.service';
import { MetadataAgentService } from '../../../services/metadata-agent.service';
import { NavigationService } from '../../../services/navigation.service';
import { CurationScreenComponent } from './curation-screen.component';

/**
 * „Inhalt erschließen". Entering the section is the start — there is nothing to choose here — so what
 * this screen decides is when a run may begin and where its answer takes the panel.
 */
describe('CurationScreenComponent', () => {
  let fixture: ComponentFixture<CurationScreenComponent>;
  let curation: CurationFake;
  let navigation: NavigationFake;
  let agent: MetadataAgentFake;

  beforeEach(() => {
    curation = fakeCuration();
    navigation = fakeNavigation();
    agent = fakeMetadataAgent();
    TestBed.configureTestingModule({
      imports: [CurationScreenComponent],
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(NavigationService, navigation.fake),
        provideFake(MetadataAgentService, agent.fake),
      ],
    });
  });

  /** Enter the section, which is what starts the run. */
  async function enter(): Promise<void> {
    fixture = TestBed.createComponent(CurationScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('starts the run on entering, with nothing to press first', async () => {
    await enter();

    expect(curation.fake.analyze).toHaveBeenCalledTimes(1);
  });

  it('carries the result to the step that shows it', async () => {
    await enter();

    expect(navigation.fake.go).toHaveBeenCalledWith('curation-preview');
  });

  it('stays here where the run answered nothing, so the failure can be reported', async () => {
    curation.fake.analyze.mockResolvedValue(false);

    await enter();

    expect(navigation.fake.go).not.toHaveBeenCalled();
  });

  it('starts nothing on top of a run that is already going', async () => {
    curation.fake.running.set(true);

    await enter();

    // The footer offers the same action, and a second run would throw the first one's answer away.
    expect(curation.fake.analyze).not.toHaveBeenCalled();
  });

  it('is the waiting animation while the agent works, and says nothing beside it', async () => {
    curation.fake.running.set(true);
    await enter();

    expect(fixture.nativeElement.querySelector('es-curation-progress')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Analysiert die aktuelle Webseite');
  });

  it('describes the step while no run is going', async () => {
    await enter();

    expect(fixture.nativeElement.textContent).toContain('Analysiert die aktuelle Webseite');
    expect(fixture.nativeElement.querySelector('es-curation-progress')).toBeNull();
  });

  it('reports a run that failed, so the footer retry has something to answer', async () => {
    curation.fake.analyze.mockResolvedValue(false);
    agent.fails('Der Seiteninhalt konnte nicht ausgelesen werden.');
    agent.lastRun.set({ ok: false, error: 'Der Seiteninhalt konnte nicht ausgelesen werden.' });

    await enter();

    expect(fixture.nativeElement.querySelector('.es-error')?.textContent).toContain(
      'Der Seiteninhalt konnte nicht ausgelesen werden.',
    );
  });
});
