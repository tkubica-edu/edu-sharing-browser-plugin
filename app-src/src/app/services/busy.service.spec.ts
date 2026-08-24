import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BusyService } from './busy.service';
import { CurationService } from './curation.service';
import { CurationFake, fakeCuration } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

describe('BusyService', () => {
  let busy: BusyService;
  let curation: CurationFake;

  beforeEach(() => {
    curation = fakeCuration();
    TestBed.configureTestingModule({ providers: [provideFake(CurationService, curation.fake)] });
    busy = TestBed.inject(BusyService);
  });

  it('refuses nothing while no write is in flight', () => {
    expect(busy.busy()).toBe(false);
    expect(busy.hint()).toBeNull();
  });

  it('reports a metadata save as busy, with the reason a control can show', () => {
    curation.fake.saving.set(true);

    expect(busy.busy()).toBe(true);
    expect(busy.hint()).toContain('gespeichert');
  });

  it('reports an assignment on its own as busy too', () => {
    curation.fake.assigning.set(true);

    expect(busy.busy()).toBe(true);
  });

  it('lets go again once the write is through', () => {
    curation.fake.saving.set(true);
    curation.fake.saving.set(false);

    expect(busy.busy()).toBe(false);
    expect(busy.hint()).toBeNull();
  });
});
