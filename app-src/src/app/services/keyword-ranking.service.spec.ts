import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { KeywordRankingService, RankedKeyword } from './keyword-ranking.service';

describe('KeywordRankingService', () => {
  let ranking: KeywordRankingService;

  beforeEach(() => {
    ranking = TestBed.inject(KeywordRankingService);
  });

  /** The ranked keywords in order, which is what a caller cuts its query off from. */
  function order(keywords: readonly string[], text: string): string[] {
    return ranking.rank(keywords, text).map((entry) => entry.keyword);
  }

  function entryFor(keywords: readonly string[], text: string, keyword: string): RankedKeyword {
    const found = ranking.rank(keywords, text).find((entry) => entry.keyword === keyword);
    if (!found) throw new Error(`${keyword} was dropped from the ranking`);
    return found;
  }

  it('keeps the agent order and scores nothing without usable text', () => {
    const ranked = ranking.rank(['Bruchrechnung', 'Optik'], '');

    expect(ranked.map((entry) => entry.keyword)).toEqual(['Bruchrechnung', 'Optik']);
    expect(ranked.map((entry) => entry.score)).toEqual([0, 0]);
    expect(ranked.map((entry) => entry.textScore)).toEqual([0, 0]);
  });

  it('drops no keyword — the caller decides the cut-off, not the ranking', () => {
    const ranked = ranking.rank(['Optik', 'Nichtsdavon', 'Linse'], '# Optik\n\nEine Linse bricht Licht.');

    expect(ranked).toHaveLength(3);
  });

  it('ranks a keyword in the title above one that only occurs in the body', () => {
    const text = '# Optik\n\nDie Linse gehört zur Optik.';

    expect(order(['Linse', 'Optik'], text)).toEqual(['Optik', 'Linse']);
  });

  it('ranks a keyword in a later heading above one that only occurs in the body', () => {
    const text = '# Physik\n\n## Linse\n\nEin Prisma zerlegt Licht, die Linse bricht es.';
    const linse = entryFor(['Prisma', 'Linse'], text, 'Linse');

    expect(linse.inHeading).toBe(true);
    expect(linse.inTitle).toBe(false);
    expect(order(['Prisma', 'Linse'], text)).toEqual(['Linse', 'Prisma']);
  });

  it('counts repeats up to the cap and nothing beyond it', () => {
    const capped = 'linse linse linse linse';
    const beyond = `${capped} linse linse linse`;

    expect(entryFor(['linse'], capped, 'linse').occurrences).toBe(4);
    expect(entryFor(['linse'], beyond, 'linse').occurrences).toBe(7);
    // Four occurrences already exhaust the three repeats that count; the score must not move.
    expect(entryFor(['linse'], beyond, 'linse').textScore).toBe(
      entryFor(['linse'], capped, 'linse').textScore,
    );
  });

  it('ranks an early first mention above a late one', () => {
    const filler = 'füllsatz '.repeat(200);
    const early = ranking.rank(['linse'], `linse ${filler}`)[0];
    const late = ranking.rank(['linse'], `${filler} linse`)[0];

    expect(early.textScore).toBeGreaterThan(late.textScore);
  });

  it('pushes a keyword the document never uses below one it does', () => {
    const text = 'Die Linse bricht das Licht.';
    const absent = entryFor(['Wahrscheinlichkeitsrechnung', 'Linse'], text, 'Wahrscheinlichkeitsrechnung');

    expect(absent.occurrences).toBe(0);
    expect(absent.textScore).toBe(0);
    expect(order(['Wahrscheinlichkeitsrechnung', 'Linse'], text)).toEqual([
      'Linse',
      'Wahrscheinlichkeitsrechnung',
    ]);
  });

  it('rewards a phrase whose words all occur even though the phrase itself does not', () => {
    // The keyword is a phrase no document writes verbatim, yet both its signal words carry it —
    // "von" is a stopword and is not one of them.
    const text = 'Brüchen begegnet man beim Addieren.';
    const keywords = ['Addieren von Brüchen', 'Kegelschnitt Ellipse'];
    const all = entryFor(keywords, text, 'Addieren von Brüchen');
    const none = entryFor(keywords, text, 'Kegelschnitt Ellipse');

    expect(all.occurrences).toBe(0);
    expect(all.allTermsPresent).toBe(true);
    expect(none.allTermsPresent).toBe(false);
    expect(all.textScore).toBeGreaterThan(none.textScore);
  });

  it('lets no German stopword act as a signal', () => {
    // "von" is a stopword, so only "Addieren" and "Brüchen" may count as terms — a phrase whose
    // stopword happened to count would report every word present.
    const partial = entryFor(['Addieren von Kegelschnitten'], 'Beim Addieren rechnet man.', 'Addieren von Kegelschnitten');

    expect(partial.allTermsPresent).toBe(false);
  });

  it('does not read a short term out of the middle of a longer word', () => {
    // "die" sits inside "Studien" and "Medien"; the title and heading signals must not report the
    // article as evidence. The body's own occurrence count is a plain substring test and does see
    // them — the word-start rule guards `inTitle`/`inHeading`, not `occurrences`.
    const inside = entryFor(['die'], '# Studien zu Medien\n\nStudien über Medien.', 'die');
    const atWordStart = entryFor(['die'], '# Die Linse\n\nDie Linse bricht Licht.', 'die');

    expect(inside.inTitle).toBe(false);
    expect(inside.inHeading).toBe(false);
    expect(atWordStart.inTitle).toBe(true);
    expect(atWordStart.inHeading).toBe(true);
  });

  it('penalises a long phrase per word beyond the second', () => {
    // Both phrases occur verbatim and both start at the same offset, so the only thing that separates
    // them is their word count: a phrase is the weaker *search* word however well the text supports it.
    const text = 'Linse bricht Licht im Prisma.';
    const two = entryFor(['Linse bricht'], text, 'Linse bricht');
    const three = entryFor(['Linse bricht Licht'], text, 'Linse bricht Licht');

    expect(two.occurrences).toBe(1);
    expect(three.occurrences).toBe(1);
    expect(three.textScore).toBeLessThan(two.textScore);
  });

  it('breaks a tie by the agent order, and an equal position by German collation', () => {
    // Neither keyword occurs, so both carry the same evidence and only the tie-breakers separate them.
    const text = 'Ein Text über etwas völlig anderes.';

    expect(order(['Zebra', 'Apfel'], text)).toEqual(['Zebra', 'Apfel']);
    // Identical agent positions cannot occur through `rank`, so the collation is asserted on the
    // duplicate case that reaches it: two entries with the same rank fall back to the word.
    expect(order(['Ähre', 'Zebra'], text)).toEqual(['Ähre', 'Zebra']);
  });
});
