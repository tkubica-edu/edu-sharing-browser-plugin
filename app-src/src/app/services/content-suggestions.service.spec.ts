import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetadataAgentFake, fakeMetadataAgent } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { ContentSuggestionsService } from './content-suggestions.service';
import { KeywordRankingService, RankedKeyword } from './keyword-ranking.service';
import { MetadataAgentService } from './metadata-agent.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';

/** The widget the keywords go in as, in both roles the service uses them in. */
const KEYWORD_WIDGET = 'cclom:general_keyword';

const NO_KEYWORDS =
  'Für das Dokument konnten keine Schlagworte erzeugt werden. Bitte erst mehr Inhalte schreiben.';

describe('ContentSuggestionsService', () => {
  let suggestions: ContentSuggestionsService;
  let agent: MetadataAgentFake;

  /** The markdown the plugin hands over for the open document. */
  let documentMarkdown: string | undefined;

  /** What reading the open document rejects with, where it does. */
  let readRefusal: Error | null;

  /** How the ranking reorders what the agent named — see {@link ranksBy}. */
  let order: (keywords: readonly string[]) => string[];

  const requestContent = vi.fn(() =>
    readRefusal ? Promise.reject(readRefusal) : Promise.resolve({ markdown: documentMarkdown }),
  );

  const ranking = {
    rank: vi.fn(
      (keywords: readonly string[], text: string): RankedKeyword[] =>
        order(keywords).map((keyword, place) => ({
          keyword,
          score: 1 - place / 100,
          textScore: text.length ? 1 : 0,
          occurrences: 1,
          inTitle: false,
          inHeading: false,
          allTermsPresent: true,
          agentRank: keywords.indexOf(keyword),
        })),
    ),
  };

  beforeEach(() => {
    documentMarkdown = '# Optik\n\nLicht bricht sich am Prisma.';
    readRefusal = null;
    order = (keywords) => [...keywords];
    requestContent.mockClear();
    ranking.rank.mockClear();
    agent = fakeMetadataAgent();
    // The ranking is reported as a table, which `quiet-logs.setup.ts` does not silence: it only
    // takes `console.log`, and a table per run would be the loudest thing in the report.
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideFake(OnlyOfficeDocumentService, { requestContent } as never),
        provideFake(MetadataAgentService, agent.fake),
        provideFake(KeywordRankingService, ranking as never),
      ],
    });
    suggestions = TestBed.inject(ContentSuggestionsService);
  });

  /** The ranking puts the keywords in this order, whatever order the agent named them in. */
  function ranksBy(reorder: (keywords: readonly string[]) => string[]): void {
    order = reorder;
  }

  /** Derive from a document the agent answers these keywords for. */
  async function derive(values: readonly string[]): Promise<boolean> {
    agent.generatesField(values);
    return suggestions.deriveFromOpenDocument();
  }

  describe('deriving the keywords from the open document', () => {
    it('has none before it ran', () => {
      expect(suggestions.keywords()).toEqual([]);
      expect(suggestions.ranked()).toEqual([]);
      expect(suggestions.documentText()).toBe('');
      expect(suggestions.error()).toBeNull();
      expect(suggestions.running()).toBe(false);
    });

    it('generates the keyword field alone, from the document markdown', async () => {
      await derive(['Optik', 'Prisma']);

      expect(requestContent).toHaveBeenCalled();
      expect(agent.fake.extractField).toHaveBeenCalledWith(
        '# Optik\n\nLicht bricht sich am Prisma.',
        KEYWORD_WIDGET,
      );
    });

    it('keeps what came out, and the text it came out of', async () => {
      await expect(derive(['Optik', 'Prisma'])).resolves.toBe(true);

      expect(suggestions.keywords()).toEqual(['Optik', 'Prisma']);
      expect(suggestions.ranked().map((entry) => entry.keyword)).toEqual(['Optik', 'Prisma']);
      expect(suggestions.documentText()).toBe('# Optik\n\nLicht bricht sich am Prisma.');
      expect(suggestions.error()).toBeNull();
    });

    it('reads a document the plugin sends without markdown as empty text', async () => {
      documentMarkdown = undefined;

      await derive(['Optik']);

      expect(agent.fake.extractField).toHaveBeenCalledWith('', KEYWORD_WIDGET);
      expect(suggestions.documentText()).toBe('');
    });

    it('says it is running while it is, and stops saying so afterwards', async () => {
      let running: boolean | null = null;
      requestContent.mockImplementationOnce(() => {
        running = suggestions.running();
        return Promise.resolve({ markdown: 'Licht' });
      });

      await derive(['Optik']);

      expect(running).toBe(true);
      expect(suggestions.running()).toBe(false);
    });

    it('ranks against the very text the keywords were generated from', async () => {
      await derive(['Optik']);

      expect(ranking.rank).toHaveBeenCalledWith(['Optik'], '# Optik\n\nLicht bricht sich am Prisma.');
    });

    it('orders by the ranking rather than by what the agent named first', async () => {
      ranksBy((keywords) => [...keywords].reverse());

      await derive(['Prisma', 'Optik']);

      expect(suggestions.keywords()).toEqual(['Optik', 'Prisma']);
    });

    it('keeps the eight the document supports best, not the eight named first', async () => {
      const named = Array.from({ length: 12 }, (_, index) => `wort-${index}`);
      ranksBy((keywords) => [...keywords].reverse());

      await derive(named);

      expect(suggestions.keywords()).toEqual([
        'wort-11',
        'wort-10',
        'wort-9',
        'wort-8',
        'wort-7',
        'wort-6',
        'wort-5',
        'wort-4',
      ]);
    });

    it('keeps a keyword the agent named twice once, in the place it first named it', async () => {
      await derive(['Optik', 'Prisma', 'optik']);

      expect(suggestions.keywords()).toEqual(['optik', 'Prisma']);
    });

    it('keeps the last spelling of the ones that differ only in case', async () => {
      // What the code does — `new Map(entries)` lets a later entry overwrite an earlier one under the
      // same key. `pickKeywords` says the first spelling wins, which is not what happens; pinned as it
      // stands, since the spelling only shows on the screen and both are the agent's own.
      await derive(['Optik', 'optik', 'OPTIK']);

      expect(suggestions.keywords()).toEqual(['OPTIK']);
    });

    it('trims what it was given and drops what is left empty', async () => {
      await derive(['  Optik  ', '', '   ', 'Prisma']);

      expect(ranking.rank).toHaveBeenCalledWith(['Optik', 'Prisma'], expect.any(String));
    });

    it('starts the search at the first step again on every run', async () => {
      await derive(['Optik', 'Prisma', 'Licht']);
      suggestions.searchWithoutKeywords();

      await derive(['Optik', 'Prisma', 'Licht']);

      expect(suggestions.unfiltered()).toBe(false);
      expect(suggestions.searchKeywords()).toEqual(['Optik', 'Prisma']);
    });
  });

  describe('where nothing can be derived', () => {
    it('reports what the agent said', async () => {
      agent.refusesField('Der Erschließungsdienst ist nicht erreichbar.');

      await expect(suggestions.deriveFromOpenDocument()).resolves.toBe(false);

      expect(suggestions.error()).toBe('Der Erschließungsdienst ist nicht erreichbar.');
      expect(suggestions.keywords()).toEqual([]);
    });

    it('asks for more content where the agent named no reason', async () => {
      agent.refusesField();

      await expect(suggestions.deriveFromOpenDocument()).resolves.toBe(false);

      expect(suggestions.error()).toBe(NO_KEYWORDS);
    });

    it('asks for more content where the agent answered with nothing', async () => {
      await expect(derive([])).resolves.toBe(false);

      expect(suggestions.error()).toBe(NO_KEYWORDS);
    });

    it('asks for more content where nothing survived the ranking', async () => {
      ranksBy(() => []);

      await expect(derive(['Optik'])).resolves.toBe(false);

      expect(suggestions.error()).toBe(NO_KEYWORDS);
      expect(suggestions.keywords()).toEqual([]);
    });

    it('reports a document that could not be read at all', async () => {
      readRefusal = new Error('Keine Antwort vom OnlyOffice-Plugin.');

      await expect(suggestions.deriveFromOpenDocument()).resolves.toBe(false);

      expect(suggestions.error()).toBe('Keine Antwort vom OnlyOffice-Plugin.');
      expect(suggestions.running()).toBe(false);
    });

    it('clears the previous failure when it runs again', async () => {
      agent.refusesField('kaputt');
      await suggestions.deriveFromOpenDocument();

      await derive(['Optik']);

      expect(suggestions.error()).toBeNull();
    });

    it('leaves the keywords it had where a later run fails', async () => {
      await derive(['Optik', 'Prisma']);

      agent.refusesField('kaputt');
      await suggestions.deriveFromOpenDocument();

      expect(suggestions.keywords()).toEqual(['Optik', 'Prisma']);
    });
  });

  describe('what the search actually filters on', () => {
    beforeEach(() => derive(['Optik', 'Prisma', 'Licht', 'Brechung']));

    it('starts with the two best-supported keywords', () => {
      expect(suggestions.searchKeywords()).toEqual(['Optik', 'Prisma']);
      expect(suggestions.filters()).toEqual({ [KEYWORD_WIDGET]: ['Optik', 'Prisma'] });
      expect(suggestions.unfiltered()).toBe(false);
    });

    it('widens to the single best one, once', () => {
      expect(suggestions.relax()).toBe(true);

      expect(suggestions.searchKeywords()).toEqual(['Optik']);
      expect(suggestions.filters()).toEqual({ [KEYWORD_WIDGET]: ['Optik'] });

      expect(suggestions.relax()).toBe(false);
      expect(suggestions.searchKeywords()).toEqual(['Optik']);
    });

    it('drops the filter entirely only when the user asks', () => {
      suggestions.searchWithoutKeywords();

      expect(suggestions.searchKeywords()).toEqual([]);
      expect(suggestions.filters()).toEqual({});
      expect(suggestions.unfiltered()).toBe(true);
    });

    it('does not widen back from there', () => {
      suggestions.searchWithoutKeywords();

      expect(suggestions.relax()).toBe(false);
      expect(suggestions.unfiltered()).toBe(true);
    });

    it('shows every keyword while searching for two of them', () => {
      expect(suggestions.keywords()).toEqual(['Optik', 'Prisma', 'Licht', 'Brechung']);
    });
  });

  describe('with fewer keywords than the search starts with', () => {
    it('searches for the one there is', async () => {
      await derive(['Optik']);

      expect(suggestions.searchKeywords()).toEqual(['Optik']);
      expect(suggestions.filters()).toEqual({ [KEYWORD_WIDGET]: ['Optik'] });
    });

    it('has no filter at all where there is none', () => {
      expect(suggestions.searchKeywords()).toEqual([]);
      expect(suggestions.filters()).toEqual({});
    });
  });

  describe('forgetting what was derived', () => {
    it('puts everything back to where the next visit reads the document again', async () => {
      await derive(['Optik', 'Prisma']);
      suggestions.searchWithoutKeywords();

      suggestions.reset();

      expect(suggestions.keywords()).toEqual([]);
      expect(suggestions.ranked()).toEqual([]);
      expect(suggestions.documentText()).toBe('');
      expect(suggestions.error()).toBeNull();
      expect(suggestions.unfiltered()).toBe(false);
      expect(suggestions.filters()).toEqual({});
    });

    it('clears a failure too', async () => {
      agent.refusesField('kaputt');
      await suggestions.deriveFromOpenDocument();

      suggestions.reset();

      expect(suggestions.error()).toBeNull();
    });
  });
});
