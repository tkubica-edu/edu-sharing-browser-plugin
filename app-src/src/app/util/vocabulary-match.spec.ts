import { describe, expect, it } from 'vitest';
import type { MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import { matchVocabularyValue, matchVocabularyValues, suggestionCapableWidget } from './vocabulary-match';

/** Three subjects of the discipline vocabulary, two of which are near neighbours. */
const DISCIPLINES: MdsValue[] = [
  {
    id: 'http://w3id.org/openeduhub/vocabs/discipline/380',
    caption: 'Mathematik',
    alternativeIds: ['380', 'mathematik'],
  },
  { id: 'http://w3id.org/openeduhub/vocabs/discipline/120', caption: 'Deutsch' },
  { id: 'http://w3id.org/openeduhub/vocabs/discipline/28010', caption: 'Deutsch als Zweitsprache' },
  { id: 'http://w3id.org/openeduhub/vocabs/discipline/460', caption: 'Physik, Astronomie' },
];

const CONTEXTS: MdsValue[] = [
  { id: 'http://w3id.org/openeduhub/vocabs/educationalContext/schule', caption: 'Schule' },
  { id: 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1', caption: 'Sekundarstufe I' },
];

describe('matchVocabularyValue', () => {
  it('takes the term that is the value itself', () => {
    const match = matchVocabularyValue(DISCIPLINES, 'http://w3id.org/openeduhub/vocabs/discipline/380');
    expect(match?.value.caption).toBe('Mathematik');
    expect(match?.by).toBe('id');
  });

  it('takes an alternative id the vocabulary carries', () => {
    expect(matchVocabularyValue(DISCIPLINES, '380')?.by).toBe('alternativeId');
  });

  it('takes a caption however it is spelled', () => {
    expect(matchVocabularyValue(DISCIPLINES, 'Mathematik')?.by).toBe('caption');
    expect(matchVocabularyValue(DISCIPLINES, 'mathematik')?.value.caption).toBe('Mathematik');
    expect(matchVocabularyValue(DISCIPLINES, '  MATHEMATIK ')?.value.caption).toBe('Mathematik');
  });

  it('takes one of the names a caption lists', () => {
    expect(matchVocabularyValue(DISCIPLINES, 'Physik')?.value.caption).toBe('Physik, Astronomie');
  });

  it('takes the readable last segment of a value URI', () => {
    const match = matchVocabularyValue(CONTEXTS, 'Sekundarstufe I');
    expect(match?.value.id).toBe('http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1');
  });

  it('never takes a neighbouring concept for the one that was named', () => {
    expect(matchVocabularyValue(DISCIPLINES, 'Deutsch')?.value.id).toBe(
      'http://w3id.org/openeduhub/vocabs/discipline/120',
    );
    expect(matchVocabularyValue(DISCIPLINES, 'Mathe')).toBeNull();
    expect(matchVocabularyValue(DISCIPLINES, 'Physikunterricht')).toBeNull();
  });

  it('answers with nothing for a term the vocabulary does not hold', () => {
    expect(matchVocabularyValue(DISCIPLINES, 'Kochen')).toBeNull();
    expect(matchVocabularyValue(DISCIPLINES, '')).toBeNull();
    expect(matchVocabularyValue(undefined, 'Mathematik')).toBeNull();
  });
});

describe('matchVocabularyValues', () => {
  it('keeps the terms in their own order and each value once', () => {
    const matched = matchVocabularyValues(DISCIPLINES, ['Kochen', 'Deutsch', '380', 'Mathematik'], 5);
    expect(matched.map((match) => match.value.caption)).toEqual(['Deutsch', 'Mathematik']);
  });

  it('takes no more than it was allowed to', () => {
    expect(matchVocabularyValues(DISCIPLINES, ['Deutsch', 'Mathematik', 'Physik'], 2)).toHaveLength(2);
  });
});

describe('suggestionCapableWidget', () => {
  const widget = (type: string): MdsWidget => ({ id: 'ccm:x', type });

  it('knows the kinds whose widget shows a pending proposal', () => {
    for (const type of ['text', 'textarea', 'singleoption', 'duration', 'slider', 'multivalueTree',
      'multivalueSuggestBadges', 'multivalueFixedBadges']) {
      expect(suggestionCapableWidget(widget(type)), type).toBe(true);
    }
  });

  it('knows the kinds where a proposal would be invisible', () => {
    for (const type of ['multivalueBadges', 'singlevalueSuggestBadges', 'vcard', 'checkbox']) {
      expect(suggestionCapableWidget(widget(type)), type).toBe(false);
    }
  });

  it('counts a kind it does not know as able — an unseen proposal is inert, a claim is not', () => {
    expect(suggestionCapableWidget(widget('somethingNew'))).toBe(true);
    expect(suggestionCapableWidget(undefined)).toBe(true);
  });
});
