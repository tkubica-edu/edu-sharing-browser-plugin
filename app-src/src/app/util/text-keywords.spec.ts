import { describe, expect, it } from 'vitest';

import { candidateKeywords, rankingTextOf } from './text-keywords';

const TEXT =
  'Die Brechung des Lichts an einer Linse ist ein Grundphänomen der Optik. ' +
  'Wer die Brechung versteht, versteht auch die Linse und ihren Brennpunkt. ' +
  'Der Brennpunkt einer Linse hängt von ihrer Krümmung ab.';

describe('candidateKeywords', () => {
  it('finds the words the text is built on, most-used first', () => {
    expect(candidateKeywords(TEXT)).toEqual(['Linse', 'Brechung', 'Brennpunkt']);
  });

  it('answers the same way twice, so two runs of a page can be compared', () => {
    expect(candidateKeywords(TEXT)).toEqual(candidateKeywords(TEXT));
  });

  it('counts a word in a heading as naming what follows it', () => {
    expect(candidateKeywords(TEXT, ['Krümmung'])).toContain('Krümmung');
  });

  it('leaves a word the text uses only once out — once is not a subject', () => {
    expect(candidateKeywords(TEXT)).not.toContain('Krümmung');
    expect(candidateKeywords(TEXT)).not.toContain('Grundphänomen');
  });

  it('leaves out what is not a keyword: stopwords, short words, lower case', () => {
    expect(candidateKeywords('Der der der und und und ist ist ist')).toEqual([]);
    expect(candidateKeywords('Uhr Uhr Uhr')).toEqual([]);
    expect(candidateKeywords('brechung brechung brechung')).toEqual([]);
  });

  it('takes no more than it was allowed to', () => {
    expect(candidateKeywords(TEXT, [], 2)).toHaveLength(2);
    expect(candidateKeywords(TEXT, [], 0)).toEqual([]);
  });

  it('finds nothing in nothing', () => {
    expect(candidateKeywords('')).toEqual([]);
    expect(candidateKeywords(null)).toEqual([]);
  });
});

describe('rankingTextOf', () => {
  it('writes the headings back as markdown, which is what the ranker reads them as', () => {
    expect(rankingTextOf(['Optik', 'Brechung'], 'Der Text.')).toBe('# Optik\n\n## Brechung\n\nDer Text.');
  });

  it('leaves out what is not there', () => {
    expect(rankingTextOf([], 'Der Text.')).toBe('Der Text.');
    expect(rankingTextOf(['  '], '')).toBe('');
  });
});
