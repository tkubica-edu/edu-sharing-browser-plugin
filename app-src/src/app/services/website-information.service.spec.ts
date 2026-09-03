import { TestBed } from '@angular/core/testing';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { WebsiteInformationService } from './website-information.service';
import { ClientUtilsFake, fakeClientUtils } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

describe('WebsiteInformationService', () => {
  let clientUtils: ClientUtilsFake;
  let service: WebsiteInformationService;

  beforeEach(() => {
    clientUtils = fakeClientUtils({ title: 'Bruchrechnung üben', keywords: ['Bruchrechnung'] });
    TestBed.configureTestingModule({
      providers: [provideFake(ClientutilsV1Service, clientUtils.fake)],
    });
    service = TestBed.inject(WebsiteInformationService);
  });

  it('answers with what the repository read off the address', async () => {
    await expect(service.read('https://beispiel.de/brueche')).resolves.toEqual({
      title: 'Bruchrechnung üben',
      keywords: ['Bruchrechnung'],
    });
  });

  it('asks about an address once — the recognition and the Erschließung want the same answer', async () => {
    await service.read('https://beispiel.de/brueche');
    await service.read('https://beispiel.de/brueche');
    expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(1);
  });

  it('makes one request for two callers asking at the same time', async () => {
    await Promise.all([
      service.read('https://beispiel.de/brueche'),
      service.read('https://beispiel.de/brueche'),
    ]);
    expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(1);
  });

  it('asks again for another address', async () => {
    await service.read('https://beispiel.de/brueche');
    await service.read('https://beispiel.de/optik');
    expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(2);
  });

  it('asks again once what was read is forgotten', async () => {
    await service.read('https://beispiel.de/brueche');
    service.invalidate('https://beispiel.de/brueche');
    await service.read('https://beispiel.de/brueche');
    expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(2);
  });

  it('answers with nothing where the repository will not — the callers have their own way on', async () => {
    clientUtils.fails(new Error('503'));
    service.invalidate();
    await expect(service.read('https://beispiel.de/brueche')).resolves.toBeNull();
  });

  it('holds nothing back for an address nobody asked about', () => {
    expect(service.held('https://beispiel.de/unbekannt')).toBeNull();
  });
});
