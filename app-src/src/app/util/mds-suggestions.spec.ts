import { NodeSuggestionResponseDto, SuggestionResponseDto } from 'ngx-edu-sharing-api';
import { describe, expect, it } from 'vitest';

import {
  aiFieldsOf, aiSuggestionRequests, aiSuggestionsFor, proposedAiSuggestions, proposedFieldsOf,
  storedAiSuggestions
} from './mds-suggestions';

/** An agent payload where the agent filled a description and two keywords, and the user the title. */
function aPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'cclom:title': 'Optik – Licht, Linsen, Spiegel',
    'cclom:general_description': 'Eine Einführung in die geometrische Optik.',
    'cclom:general_keyword': ['Optik', 'Linsen'],
    _origins: {
      'cclom:title': 'user',
      'cclom:general_description': 'ai',
      'cclom:general_keyword': 'ai',
    },
    ...overrides,
  };
}

/** One suggestion as the repository hands it back. */
function aStored(overrides: Partial<SuggestionResponseDto> = {}): SuggestionResponseDto {
  return {
    id: 'suggestion-1',
    nodeId: 'node-1',
    propertyId: 'cclom:general_description',
    value: 'Eine Einführung in die geometrische Optik.',
    status: 'PENDING',
    type: 'AI',
    version: 'browser-extension',
    confidence: 1,
    created: '2026-08-28T10:00:00Z',
    createdBy: { authorityName: 'admin' },
    ...overrides,
  };
}

describe('aiSuggestionRequests', () => {
  it('proposes one entry per value of every field the agent filled', () => {
    expect(aiSuggestionRequests(aPayload())).toEqual([
      {
        propertyId: 'cclom:general_description',
        value: 'Eine Einführung in die geometrische Optik.',
        description: 'METHODOLOGY',
        confidence: 1,
      },
      { propertyId: 'cclom:general_keyword', value: 'Optik', description: 'METHODOLOGY', confidence: 1 },
      { propertyId: 'cclom:general_keyword', value: 'Linsen', description: 'METHODOLOGY', confidence: 1 },
    ]);
  });

  it('proposes nothing for a payload that attributes no field to the agent', () => {
    expect(aiSuggestionRequests({ 'cclom:title': 'Optik' })).toEqual([]);
    expect(aiSuggestionRequests(null)).toEqual([]);
  });

  it('leaves the licence out — it is set rather than proposed', () => {
    const payload = aPayload({
      'ccm:commonlicense_key': 'CC_BY_SA',
      _origins: { 'ccm:commonlicense_key': 'ai' },
    });
    expect(aiSuggestionRequests(payload)).toEqual([]);
  });

  it('leaves out the vocabularies of the agent that are no property of a node', () => {
    const payload = {
      'schema:datePublished': '2024-05-06',
      'oeh:new_lrt': 'http://w3id.org/openeduhub/vocabs/new_lrt/d8c3ef03',
      'cclom:general_description': 'Eine Einführung in die geometrische Optik.',
      _origins: {
        'schema:datePublished': 'ai',
        'oeh:new_lrt': 'ai',
        'cclom:general_description': 'ai',
      },
    };
    expect(aiSuggestionRequests(payload).map((entry) => entry.propertyId)).toEqual([
      'cclom:general_description',
    ]);
  });

  it('drops a field the agent claims but left blank', () => {
    const payload = { 'cclom:general_description': '  ', _origins: { 'cclom:general_description': 'ai' } };
    expect(aiSuggestionRequests(payload)).toEqual([]);
  });
});

describe('storedAiSuggestions', () => {
  it('takes the pending proposals of the machine, keyed by property', () => {
    const response: NodeSuggestionResponseDto = {
      nodeId: 'node-1',
      suggestions: {
        'cclom:general_description': [aStored()],
        'cclom:general_keyword': [
          aStored({ id: 'suggestion-2', propertyId: 'cclom:general_keyword', value: 'Optik' }),
        ],
      },
    };
    expect(storedAiSuggestions(response)).toEqual({
      nodeId: 'node-1',
      suggestions: {
        'cclom:general_description': [
          {
            id: 'suggestion-1',
            propertyId: 'cclom:general_description',
            value: 'Eine Einführung in die geometrische Optik.',
            status: 'PENDING',
            type: 'AI',
          },
        ],
        'cclom:general_keyword': [
          {
            id: 'suggestion-2',
            propertyId: 'cclom:general_keyword',
            value: 'Optik',
            status: 'PENDING',
            type: 'AI',
          },
        ],
      },
    });
  });

  it('passes over a decision already taken and a proposal of a person', () => {
    const response: NodeSuggestionResponseDto = {
      nodeId: 'node-1',
      suggestions: {
        'cclom:general_description': [
          aStored({ status: 'ACCEPTED' }),
          aStored({ id: 'suggestion-2', status: 'DECLINED' }),
          aStored({ id: 'suggestion-3', type: 'USER_PROPOSAL' }),
        ],
      },
    };
    expect(storedAiSuggestions(response)).toBeNull();
  });

  it('answers null for a node the repository holds no proposals for', () => {
    expect(storedAiSuggestions({ nodeId: 'node-1', suggestions: {} })).toBeNull();
    expect(storedAiSuggestions(null)).toBeNull();
  });
});

describe('proposedAiSuggestions', () => {
  it('offers what a run reports it proposed, by property', () => {
    expect(
      proposedAiSuggestions('node-1', [
        { id: 'a', propertyId: 'cclom:general_description', value: 'Eine Einführung.', status: 'PENDING', type: 'AI' },
        { id: 'b', propertyId: 'cclom:general_keyword', value: 'Optik', status: 'PENDING', type: 'AI' },
        { id: 'c', propertyId: 'cclom:general_keyword', value: 'Linsen', status: 'PENDING', type: 'AI' },
      ]),
    ).toEqual({
      nodeId: 'node-1',
      suggestions: {
        'cclom:general_description': [
          { id: 'a', propertyId: 'cclom:general_description', value: 'Eine Einführung.', status: 'PENDING', type: 'AI' },
        ],
        'cclom:general_keyword': [
          { id: 'b', propertyId: 'cclom:general_keyword', value: 'Optik', status: 'PENDING', type: 'AI' },
          { id: 'c', propertyId: 'cclom:general_keyword', value: 'Linsen', status: 'PENDING', type: 'AI' },
        ],
      },
    });
  });

  it('offers an entry the run states no status for — it was just made', () => {
    expect(
      proposedAiSuggestions('node-1', [{ propertyId: 'cclom:general_description', value: 'Eine Einführung.' }])
        ?.suggestions['cclom:general_description'],
    ).toEqual([
      {
        id: 'es-proposed-cclom:general_description-0',
        propertyId: 'cclom:general_description',
        value: 'Eine Einführung.',
        status: 'PENDING',
        type: 'AI',
      },
    ]);
  });

  it('leaves out a declined entry, a person\'s proposal and an empty value', () => {
    expect(
      proposedAiSuggestions('node-1', [
        { id: 'a', propertyId: 'cclom:general_description', value: 'Abgelehnt.', status: 'DECLINED', type: 'AI' },
        { id: 'b', propertyId: 'cclom:general_keyword', value: 'Optik', type: 'USER_PROPOSAL' },
        { id: 'c', propertyId: 'cclom:general_keyword', value: '  ', type: 'AI' },
      ]),
    ).toBeNull();
  });

  it('offers nothing for a run that reported nothing', () => {
    expect(proposedAiSuggestions('node-1', [])).toBeNull();
    expect(proposedAiSuggestions('node-1', null)).toBeNull();
  });
});

describe('the two readings of `_origins`', () => {
  /** A payload of the KI-free way: the page states the description, and the keywords were derived. */
  const pageDerived = {
    'cclom:general_description': 'Ein Überblick über Licht.',
    'cclom:general_keyword': ['Brechung', 'Brennpunkt'],
    _origins: { 'cclom:general_keyword': 'page', 'cclom:general_description': 'user' },
  };

  it('attributes only a model’s fields to the agent', () => {
    expect(aiFieldsOf(pageDerived)).toEqual([]);
    expect(aiFieldsOf({ _origins: { 'cclom:general_keyword': 'ai' } })).toEqual(['cclom:general_keyword']);
  });

  it('offers both kinds in the form — a proposal is a proposal, wherever it came from', () => {
    expect(proposedFieldsOf(pageDerived)).toEqual(['cclom:general_keyword']);
    expect(proposedFieldsOf({ _origins: { a: 'page', 'cclom:x': 'ai', 'cclom:y': 'user' } })).toEqual(['cclom:x']);
    expect(proposedFieldsOf(null)).toEqual([]);
  });

  it('proposes a page-derived field to the repository’s suggestion store like a model’s', () => {
    // A derived value is a machine's proposal whatever derived it, and the store is where an acceptance
    // of it is recorded. What the page states is not in there: it is a value, not a proposal.
    expect(aiSuggestionRequests(pageDerived).map((entry) => entry.propertyId)).toEqual([
      'cclom:general_keyword', 'cclom:general_keyword',
    ]);
    expect(
      aiSuggestionRequests(pageDerived).some(
        (entry) => entry.propertyId === 'cclom:general_description',
      ),
    ).toBe(false);
  });

  it('builds the form’s offer for a page-derived field without asking anything', () => {
    expect(aiSuggestionsFor(pageDerived, 'node-1')?.suggestions).toEqual({
      'cclom:general_keyword': [
        {
          id: 'es-ai-cclom:general_keyword-0',
          propertyId: 'cclom:general_keyword',
          value: 'Brechung',
          status: 'PENDING',
          type: 'AI',
        },
        {
          id: 'es-ai-cclom:general_keyword-1',
          propertyId: 'cclom:general_keyword',
          value: 'Brennpunkt',
          status: 'PENDING',
          type: 'AI',
        },
      ],
    });
  });
});
