import { NodeSuggestionResponseDto, SuggestionResponseDto } from 'ngx-edu-sharing-api';
import { describe, expect, it } from 'vitest';

import { aiSuggestionRequests, storedAiSuggestions } from './mds-suggestions';

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
