import { TestBed } from '@angular/core/testing';
import { MdsDefinition, MdsService } from 'ngx-edu-sharing-api';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MdsValuespaceService } from './mds-valuespace.service';
import { provideFake } from '../../testing/provide-fake';

/**
 * A metadata set whose `io` group renders two of its three widgets: the subject, which carries a
 * valuespace, and a keyword field. The third is defined but not in the form — which is the case that
 * decides whether a value would be visible at all.
 */
function aSet(): MdsDefinition {
  return {
    id: 'default',
    name: 'Test',
    groups: [{ id: 'io', views: ['node_general'] }],
    views: [{ id: 'node_general', html: '<cclom:title><ccm:taxonid><cclom:general_keyword>' }],
    widgets: [
      { id: 'cclom:title', type: 'text' },
      {
        id: 'ccm:taxonid',
        type: 'multivalueTree',
        values: [
          { id: 'http://w3id.org/openeduhub/vocabs/discipline/460', caption: 'Physik' },
          { id: 'http://w3id.org/openeduhub/vocabs/discipline/380', caption: 'Mathematik' },
        ],
      },
      { id: 'cclom:general_keyword', type: 'multivalueBadges' },
      {
        id: 'ccm:educationalcontext',
        type: 'multivalueFixedBadges',
        values: [{ id: 'http://w3id.org/openeduhub/vocabs/educationalContext/schule', caption: 'Schule' }],
      },
    ],
    lists: [],
    sorts: [],
  } as MdsDefinition;
}

describe('MdsValuespaceService', () => {
  let answer: Observable<MdsDefinition>;
  let mds: { getMetadataSet: ReturnType<typeof vi.fn> };
  let service: MdsValuespaceService;

  beforeEach(() => {
    answer = of(aSet());
    mds = { getMetadataSet: vi.fn(() => answer) };
    TestBed.configureTestingModule({
      providers: [provideFake(MdsService, mds as unknown as Partial<MdsService>)],
    });
    service = TestBed.inject(MdsValuespaceService);
  });

  it('resolves a page’s word to the value the widget offers', async () => {
    const matched = await service.resolve('default', 'io', 'ccm:taxonid', ['Kochen', 'Physik']);
    expect(matched.map((match) => match.value.id)).toEqual([
      'http://w3id.org/openeduhub/vocabs/discipline/460',
    ]);
  });

  it('resolves nothing for a word no value of the widget names', async () => {
    await expect(service.resolve('default', 'io', 'ccm:taxonid', ['Kochen'])).resolves.toEqual([]);
  });

  it('resolves nothing for a property this form does not render', async () => {
    // The set defines the widget and its valuespace, but the `io` view does not place it.
    await expect(
      service.resolve('default', 'io', 'ccm:educationalcontext', ['Schule']),
    ).resolves.toEqual([]);
  });

  it('fetches the set once, however often it is asked', async () => {
    await service.resolve('default', 'io', 'ccm:taxonid', ['Physik']);
    await service.resolve('default', 'io', 'ccm:taxonid', ['Mathematik']);
    await service.canShowSuggestion('default', 'io', 'cclom:title');
    expect(mds.getMetadataSet).toHaveBeenCalledTimes(1);
  });

  it('says which of the form’s widgets can show a proposal at all', async () => {
    await expect(service.canShowSuggestion('default', 'io', 'ccm:taxonid')).resolves.toBe(true);
    await expect(service.canShowSuggestion('default', 'io', 'cclom:general_keyword')).resolves.toBe(false);
    // A property the form does not render has nothing to show it in.
    await expect(service.canShowSuggestion('default', 'io', 'ccm:notInTheForm')).resolves.toBe(false);
  });

  it('resolves nothing where the repository will not hand the set over', async () => {
    answer = throwError(() => new Error('503'));
    await expect(service.resolve('other', 'io', 'ccm:taxonid', ['Physik'])).resolves.toEqual([]);
  });
});
