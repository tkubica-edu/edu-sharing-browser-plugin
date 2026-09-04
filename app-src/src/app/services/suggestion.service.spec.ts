import { TestBed } from '@angular/core/testing';
import { HOME_REPOSITORY, SuggestionsV1Service } from 'ngx-edu-sharing-api';
import { Observable, of, throwError } from 'rxjs';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { provideFake } from '../../testing/provide-fake';
import { SuggestionService } from './suggestion.service';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

/** A payload with two fields the run marked as a machine's proposal. */
const PROPOSED = {
  'cclom:title': 'Optik',
  'cclom:general_keyword': ['Linsen', 'Brechung'],
  _origins: { 'cclom:title': 'ai', 'cclom:general_keyword': 'page' },
};

describe('SuggestionService', () => {
  let suggestions: SuggestionService;
  let api: {
    createSuggestions: Mock;
    getSuggestionsByNodeId: Mock;
    deleteSuggestions: Mock;
  };

  /** Property ids the repository will not take, whatever else the request carries. */
  let refused: Set<string>;

  beforeEach(() => {
    refused = new Set();
    api = {
      createSuggestions: vi.fn((request: { body: { propertyId: string }[] }): Observable<unknown> => {
        const bad = request.body.find((entry) => refused.has(entry.propertyId));
        return bad ? throwError(() => new Error(`refused ${bad.propertyId}`)) : of({});
      }),
      getSuggestionsByNodeId: vi.fn(() => of({ suggestions: {} })),
      deleteSuggestions: vi.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      providers: [provideFake(SuggestionsV1Service, api as never)],
    });
    suggestions = TestBed.inject(SuggestionService);
  });

  /** The property ids of the nth create request. */
  function proposedAt(index: number): string[] {
    return (api.createSuggestions.mock.calls[index][0].body as { propertyId: string }[]).map(
      (entry) => entry.propertyId,
    );
  }

  describe('propose', () => {
    it('writes the run\'s proposals under the panel\'s own version', async () => {
      await expect(suggestions.propose(NODE, PROPOSED)).resolves.toBe(true);

      expect(api.createSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: HOME_REPOSITORY,
          node: NODE,
          type: 'AI',
          version: 'browser-extension',
        }),
      );
    });

    it('proposes a model\'s values and the page\'s alike — both are a machine\'s proposal', async () => {
      await suggestions.propose(NODE, PROPOSED);

      expect(new Set(proposedAt(0))).toEqual(new Set(['cclom:general_keyword', 'cclom:title']));
    });

    it('proposes one entry per value, since a proposal is accepted value by value', async () => {
      await suggestions.propose(NODE, PROPOSED);

      expect(proposedAt(0).filter((id) => id === 'cclom:general_keyword')).toHaveLength(2);
    });

    it('drops what this panel proposed before, so the form never offers both', async () => {
      await suggestions.propose(NODE, PROPOSED);

      expect(api.deleteSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ node: NODE, version: ['browser-extension'] }),
      );
      expect(api.deleteSuggestions.mock.invocationCallOrder[0]).toBeLessThan(
        api.createSuggestions.mock.invocationCallOrder[0],
      );
    });

    it('proposes and discards nothing for a run that marked no field', async () => {
      await expect(suggestions.propose(NODE, { 'cclom:title': 'Optik' })).resolves.toBe(true);

      expect(api.createSuggestions).not.toHaveBeenCalled();
      expect(api.deleteSuggestions).not.toHaveBeenCalled();
    });

    it('proposes nothing for a content with no payload at all', async () => {
      await expect(suggestions.propose(NODE, null)).resolves.toBe(true);
      expect(api.createSuggestions).not.toHaveBeenCalled();
    });

    it('retries entry by entry, since the endpoint validates the whole list before storing any', async () => {
      refused.add('cclom:title');

      await expect(suggestions.propose(NODE, PROPOSED)).resolves.toBe(true);

      // The batch of three, then one call per entry.
      expect(proposedAt(0)).toHaveLength(3);
      expect(api.createSuggestions).toHaveBeenCalledTimes(4);
    });

    it('reports a failure only where the repository took none of them', async () => {
      refused.add('cclom:title');
      refused.add('cclom:general_keyword');

      await expect(suggestions.propose(NODE, PROPOSED)).resolves.toBe(false);
    });

    it('does not retry a single entry the repository already refused on its own', async () => {
      refused.add('cclom:title');

      await expect(
        suggestions.propose(NODE, { 'cclom:title': 'Optik', _origins: { 'cclom:title': 'ai' } }),
      ).resolves.toBe(false);
      expect(api.createSuggestions).toHaveBeenCalledTimes(1);
    });

    it('goes on where the earlier proposals could not be discarded', async () => {
      api.deleteSuggestions.mockReturnValue(throwError(() => new Error('no mongo-plugin')));

      await expect(suggestions.propose(NODE, PROPOSED)).resolves.toBe(true);
      expect(api.createSuggestions).toHaveBeenCalled();
    });
  });

  describe('load', () => {
    it('asks for the node\'s open proposals only', async () => {
      await suggestions.load(NODE);

      expect(api.getSuggestionsByNodeId).toHaveBeenCalledWith(
        expect.objectContaining({ repository: HOME_REPOSITORY, node: NODE, status: ['PENDING'] }),
      );
    });

    it('answers with the properties the editor\'s widgets read', async () => {
      api.getSuggestionsByNodeId.mockReturnValue(
        of({
          suggestions: {
            'cclom:title': [{ type: 'AI', status: 'PENDING', value: 'Optik' }],
          },
        }),
      );

      const loaded = await suggestions.load(NODE);

      expect(Object.keys(loaded?.suggestions ?? {})).toEqual(['cclom:title']);
    });

    it('answers with nothing where the repository cannot be asked — the caller falls back', async () => {
      api.getSuggestionsByNodeId.mockReturnValue(throwError(() => new Error('no mongo-plugin')));

      await expect(suggestions.load(NODE)).resolves.toBeNull();
    });
  });
});
