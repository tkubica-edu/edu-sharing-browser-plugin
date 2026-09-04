import { TestBed } from '@angular/core/testing';
import { ClientConfig, ConfigService, DEFAULT, HOME_REPOSITORY, MdsDefinition, MdsService } from 'ngx-edu-sharing-api';
import { EduSharingLlmService } from 'ngx-edu-sharing-b-api';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposedSuggestion } from '../util/mds-suggestions';
import { AuthFake, ConfigFake, fakeAuth, fakeConfig } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { MdsAiSuggestionService } from './mds-ai-suggestion.service';

/** The prompt configuration a run is made under, as the MDS editor makes it. */
const CONFIG_ID = { type: 'mds', id: 'suggestion_ai' };

/**
 * A metadata set as the repository publishes one: an `io` form of two views, where the title and the
 * description carry an `aiConfig` and the licence carries none.
 */
function aSet(overrides: Partial<MdsDefinition> = {}): MdsDefinition {
  return {
    id: 'mds_oeh',
    name: 'mds_oeh',
    groups: [{ id: 'io', views: ['io_general'] }],
    views: [
      {
        id: 'io_general',
        html: '<cclom:title></cclom:title><cclom:general_description /><license></license>',
      },
    ],
    widgets: [
      { id: 'cclom:title', aiConfigs: [{ id: 'default' }] },
      { id: 'cclom:general_description', aiConfigs: [{ id: 'default' }] },
      { id: 'license' },
    ],
    lists: [],
    sorts: [],
    ...overrides,
  } as MdsDefinition;
}

describe('MdsAiSuggestionService', () => {
  let suggestions: MdsAiSuggestionService;
  let auth: AuthFake;
  let config: ConfigFake;

  /** The set the repository hands over for the id it is asked about. */
  let published: MdsDefinition | null;

  /** What the generation run answers with. */
  let proposals: Observable<ProposedSuggestion[]>;

  const mds = {
    getMetadataSet: vi.fn((_request: { repository?: string; metadataSet?: string }) =>
      published ? of(published) : throwError(() => new Error('no such set')),
    ),
  };

  const llm = {
    suggestions: vi.fn((_request: { body: unknown }) => proposals),
  };

  /** The text of the page, which is what a run works from beside the title. */
  const variables = { 'cclom:title': ['Optik'], text: ['Licht bricht sich am Prisma.'] };

  beforeEach(() => {
    published = aSet();
    proposals = of([
      { propertyId: 'cclom:general_description', value: 'Eine Einführung in die Optik.' },
    ] as ProposedSuggestion[]);
    mds.getMetadataSet.mockClear();
    llm.suggestions.mockClear();
    auth = fakeAuth();
    config = fakeConfig();
    config.answers({ availableMds: [{ repository: HOME_REPOSITORY, mds: ['mds_oeh'] }] } as ClientConfig);
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(ConfigService, config.fake),
        provideFake(MdsService, mds as never),
        provideFake(EduSharingLlmService, llm as never),
      ],
    });
    suggestions = TestBed.inject(MdsAiSuggestionService);
  });

  /** The body the last run was asked with. */
  function lastBody(): Record<string, unknown> {
    const calls = llm.suggestions.mock.calls;
    return (calls[calls.length - 1]?.[0] as { body: Record<string, unknown> }).body;
  }

  describe('what a run is asked for', () => {
    it('asks for the form fields the set can generate, under their own config', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(lastBody()['widgetAiConfigs']).toEqual([
        { widgetId: 'cclom:title', aiConfigId: 'default' },
        { widgetId: 'cclom:general_description', aiConfigId: 'default' },
      ]);
    });

    it('names the node, the set and the prompt configuration the editor uses', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(lastBody()).toMatchObject({
        metadataSet: 'mds_oeh',
        configIds: [CONFIG_ID],
        contextNodeId: 'node-1',
        variables: { text: ['Licht'] },
      });
    });

    it('names who is asking, and nobody where there is no session', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });
      expect(lastBody()['user']).toBe('');

      auth.fake.username.set('lehrerin');
      await suggestions.generate('node-2', 'io', { text: ['Licht'] });
      expect(lastBody()['user']).toBe('lehrerin');
    });

    it('leaves out the fields the values handed in already answer', async () => {
      await suggestions.generate('node-1', 'io', variables);

      expect(lastBody()['widgetAiConfigs']).toEqual([
        { widgetId: 'cclom:general_description', aiConfigId: 'default' },
      ]);
    });

    it('takes the settled fields from the caller where it names them', async () => {
      await suggestions.generate('node-1', 'io', variables, ['cclom:general_description']);

      expect(lastBody()['widgetAiConfigs']).toEqual([
        { widgetId: 'cclom:title', aiConfigId: 'default' },
      ]);
      // Everything the form holds still travels as context, settled or not: the prompts read it.
      expect(lastBody()['variables']).toEqual(variables);
    });

    it('asks for every field where nothing is settled at all', async () => {
      await suggestions.generate('node-1', 'io', variables, []);

      expect(lastBody()['widgetAiConfigs']).toHaveLength(2);
    });
  });

  describe('the metadata set a run is made under', () => {
    it('is the one the form was built from, where the caller names it', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] }, [], 'mds_custom');

      expect(mds.getMetadataSet).toHaveBeenCalledWith({
        repository: HOME_REPOSITORY,
        metadataSet: 'mds_custom',
      });
      expect(config.fake.observeConfig).not.toHaveBeenCalled();
    });

    it('is the one the client config names for the home repository otherwise', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(config.fake.observeConfig).toHaveBeenCalled();
      expect(mds.getMetadataSet).toHaveBeenCalledWith({
        repository: HOME_REPOSITORY,
        metadataSet: 'mds_oeh',
      });
    });

    it('takes an entry that names no repository as the home one', async () => {
      config.answers({ availableMds: [{ mds: ['mds_ohne_repo'] }] } as ClientConfig);

      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(mds.getMetadataSet).toHaveBeenCalledWith({
        repository: HOME_REPOSITORY,
        metadataSet: 'mds_ohne_repo',
      });
    });

    it('passes over an entry for another repository', async () => {
      config.answers({
        availableMds: [
          { repository: 'remote', mds: ['mds_fremd'] },
          { repository: HOME_REPOSITORY, mds: ['mds_oeh'] },
        ],
      } as ClientConfig);

      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(mds.getMetadataSet).toHaveBeenCalledWith({
        repository: HOME_REPOSITORY,
        metadataSet: 'mds_oeh',
      });
    });

    it('makes no run where the config names none', async () => {
      config.answers({ availableMds: [] } as unknown as ClientConfig);

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(mds.getMetadataSet).not.toHaveBeenCalled();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('makes no run where the config names an empty list of sets', async () => {
      config.answers({ availableMds: [{ repository: HOME_REPOSITORY, mds: [] }] } as ClientConfig);

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
    });

    it('makes no run where the config cannot be read', async () => {
      config.fails(new Error('config unreachable'));

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('makes no run where the repository will not hand the set over', async () => {
      published = null;

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('uses the set own id, not the one it was addressed under', async () => {
      published = aSet({ id: 'mds_oeh_real' });

      await suggestions.generate('node-1', 'io', { text: ['Licht'] }, [], DEFAULT);

      expect(lastBody()['metadataSet']).toBe('mds_oeh_real');
    });

    it('falls back to the id it was addressed under where the set names none', async () => {
      published = aSet({ id: undefined });

      await suggestions.generate('node-1', 'io', { text: ['Licht'] }, [], 'mds_custom');

      expect(lastBody()['metadataSet']).toBe('mds_custom');
    });

    it('makes no run for a placeholder id the generation cannot be configured under', async () => {
      published = aSet({ id: undefined });

      await expect(
        suggestions.generate('node-1', 'io', { text: ['Licht'] }, [], DEFAULT),
      ).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });
  });

  describe('where there is nothing to ask for', () => {
    it('makes no run without a single value to work from', async () => {
      await expect(suggestions.generate('node-1', 'io', {})).resolves.toBeNull();

      expect(config.fake.observeConfig).not.toHaveBeenCalled();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('makes no run for a form the set describes no generation for', async () => {
      published = aSet({
        widgets: [{ id: 'cclom:title' }, { id: 'cclom:general_description' }, { id: 'license' }],
      });

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('makes no run for a group the set does not know', async () => {
      await expect(suggestions.generate('node-1', 'collection', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });

    it('makes no run where every field of the form is already answered', async () => {
      await expect(
        suggestions.generate('node-1', 'io', variables, ['cclom:title', 'cclom:general_description']),
      ).resolves.toBeNull();
      expect(llm.suggestions).not.toHaveBeenCalled();
    });
  });

  describe('what the run reports', () => {
    it('is the proposals in the shape the widgets read', async () => {
      const offer = await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      expect(offer).toEqual({
        nodeId: 'node-1',
        suggestions: {
          'cclom:general_description': [
            {
              id: 'es-proposed-cclom:general_description-0',
              propertyId: 'cclom:general_description',
              value: 'Eine Einführung in die Optik.',
              status: 'PENDING',
              type: 'AI',
            },
          ],
        },
      });
    });

    it('is nothing where the run proposed nothing', async () => {
      proposals = of([]);

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
    });

    it('is nothing where the run failed', async () => {
      proposals = throwError(() => new Error('the generation service is down'));

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
    });
  });

  describe('one run per node', () => {
    it('does not ask twice for the same node', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).toHaveBeenCalledTimes(1);
    });

    it('asks again for another node', async () => {
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });
      await suggestions.generate('node-2', 'io', { text: ['Licht'] });

      expect(llm.suggestions).toHaveBeenCalledTimes(2);
    });

    it('does not repeat a run that failed', async () => {
      proposals = throwError(() => new Error('the generation service is down'));
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      proposals = of([{ propertyId: 'cclom:title', value: 'Optik' }] as ProposedSuggestion[]);
      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.toBeNull();
      expect(llm.suggestions).toHaveBeenCalledTimes(1);
    });

    it('leaves a node whose run never started open to a later attempt', async () => {
      published = null;
      await suggestions.generate('node-1', 'io', { text: ['Licht'] });

      published = aSet();
      await expect(suggestions.generate('node-1', 'io', { text: ['Licht'] })).resolves.not.toBeNull();
      expect(llm.suggestions).toHaveBeenCalledTimes(1);
    });
  });
});
