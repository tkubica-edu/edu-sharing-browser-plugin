import { TestBed } from '@angular/core/testing';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { METADATA_AGENT_API_URL } from '../config';
import { EXTRACT_FIELD_ANSWER } from '../util/dev-fixtures';
import {
  BrowserExtensionFake,
  DevModeFake,
  PageDerivationFake,
  fakeBrowserExtension,
  fakeDevMode,
  fakePageDerivation,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import {
  BrowserExtensionService,
  PageData,
  PageSource,
  WORKER_UNREACHABLE,
  WORKER_UNREACHABLE_TEXT,
} from './browser-extension.service';
import { DevModeService } from './dev-mode.service';
import { MetadataAgentService } from './metadata-agent.service';
import { PageDerivationService } from './page-derivation.service';

const EXTRACT_URL = `${METADATA_AGENT_API_URL}/extract-field`;

/** The page a run was made on, as the worker reports it back. */
const SOURCE: PageSource = { url: 'https://example.org/optik', title: 'Optik' };

/** A page as the content script read it. */
function aPage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: 'https://example.org/optik',
    title: 'Optik',
    mainContent: 'Der Artikel selbst.',
    formattedText: 'Titel: Optik\n\nDer Artikel selbst.',
    ...overrides,
  } as PageData;
}

describe('MetadataAgentService', () => {
  let agent: MetadataAgentService;
  let extension: BrowserExtensionFake;
  let devMode: DevModeFake;
  let derivation: PageDerivationFake;
  let fetchMock: Mock;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    devMode = fakeDevMode();
    derivation = fakePageDerivation();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(PageDerivationService, derivation.fake),
      ],
    });
    agent = TestBed.inject(MetadataAgentService);
    // Stubbed over the guard from `no-network.setup.ts`: `/extract-field` is the one call this service
    // makes from the panel itself rather than through the worker.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.useRealTimers());

  describe('run', () => {
    it('tells the worker which agent to call, since it has no repository of its own', async () => {
      extension.analyzes({ 'cclom:title': 'Optik' }, SOURCE);

      await agent.run();

      expect(extension.fake.analyzeActiveTab).toHaveBeenCalledWith('de', METADATA_AGENT_API_URL);
    });

    it('reports the answer as the last run, so it survives a view switch', async () => {
      extension.analyzes({ 'cclom:title': 'Optik' }, SOURCE);

      const outcome = await agent.run();

      expect(outcome.ok).toBe(true);
      expect(outcome.source).toEqual(SOURCE);
      expect(outcome.parsed?.fields).toEqual([{ key: 'cclom:title', values: ['Optik'] }]);
      expect(agent.lastRun()).toBe(outcome);
    });

    it('strips the quality criteria the model answered itself, at the one place a payload enters', async () => {
      extension.analyzes(
        { 'cclom:title': 'Optik', 'ccm:oeh_quality_data_privacy': ['einwandfrei'] },
        SOURCE,
      );

      const outcome = await agent.run();

      expect(outcome.parsed?.raw).not.toHaveProperty('ccm:oeh_quality_data_privacy');
      expect(outcome.parsed?.raw).toHaveProperty('cclom:title');
    });

    it('lays the page\'s own statements underneath the generated answer', async () => {
      extension.analyzes({ 'cclom:title': 'Optik' }, SOURCE, aPage());
      derivation.derives({ 'cclom:title': 'Optik', 'cclom:general_language': 'de' });

      const outcome = await agent.run();

      expect(derivation.fake.deriveUnder).toHaveBeenCalled();
      expect(outcome.parsed?.raw['cclom:general_language']).toBe('de');
    });

    it('keeps the generated answer where the page states nothing the panel can use', async () => {
      extension.analyzes({ 'cclom:title': 'Optik' }, SOURCE, aPage());

      expect((await agent.run()).parsed?.raw).toEqual({ 'cclom:title': 'Optik' });
    });

    it('says it is running while it is, and stops saying so however it ends', async () => {
      extension.analyzes({}, SOURCE);
      const pending = agent.run();
      expect(agent.running()).toBe(true);
      await pending;
      expect(agent.running()).toBe(false);
    });

    it('names the two builds having fallen out of step, which is what NO_RESPONSE means', async () => {
      extension.refusesAnalysis('NO_RESPONSE');

      const outcome = await agent.run();

      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('Extension neu laden');
    });

    it('names every failure the worker reports in words the panel can show', async () => {
      const said = async (error: string) => {
        extension.refusesAnalysis(error);
        return (await agent.run()).error;
      };

      expect(await said(WORKER_UNREACHABLE)).toBe(WORKER_UNREACHABLE_TEXT);
      expect(await said('UNSUPPORTED_PAGE')).toContain('interne Browser-Seite');
      expect(await said('NO_ACTIVE_TAB')).toBe('Kein aktiver Tab gefunden.');
      expect(await said('EMPTY_EXTRACTION')).toContain('konnte nicht ausgelesen werden');
      expect(await said('EXTRACTION_FAILED')).toContain('konnte nicht ausgelesen werden');
      expect(await said('IRGENDWAS')).toBe('Fehler: IRGENDWAS');
      expect(await said('')).toBe('Unbekannter Fehler bei der Erschließung.');
    });

    it('reports a throw of the worker call as the failed run it is', async () => {
      extension.fake.analyzeActiveTab.mockRejectedValueOnce(new Error('kaputt'));

      expect(await agent.run()).toEqual({ ok: false, error: 'kaputt' });
      expect(agent.running()).toBe(false);
    });
  });

  describe('readPage', () => {
    it('describes the content from what the page states, without calling the agent', async () => {
      extension.reads({ success: true, source: SOURCE, data: aPage() });

      const outcome = await agent.readPage();

      expect(outcome.ok).toBe(true);
      expect(extension.fake.analyzeActiveTab).not.toHaveBeenCalled();
      expect(outcome.parsed?.raw['cclom:title']).toBe('Optik');
    });

    it('lets the derivation replace the plain facts it builds on', async () => {
      extension.reads({ success: true, source: SOURCE, data: aPage() });
      derivation.derives({ 'cclom:title': 'Optik', 'cclom:general_keyword': ['Linsen'] });

      const outcome = await agent.readPage();

      expect(derivation.fake.derive).toHaveBeenCalled();
      expect(outcome.parsed?.raw['cclom:general_keyword']).toEqual(['Linsen']);
    });

    it('is stored as the same last run, since it is the same statement about the same thing', async () => {
      extension.reads({ success: true, source: SOURCE, data: aPage() });

      const outcome = await agent.readPage();

      expect(agent.lastRun()).toBe(outcome);
    });

    it('says a page nothing can be read off cannot be read', async () => {
      const outcome = await agent.readPage();

      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('kann nicht gelesen werden');
    });

    it('says the same for a read that came back without the page', async () => {
      extension.reads({ success: true, source: SOURCE });

      expect((await agent.readPage()).ok).toBe(false);
    });

    it('says the same where the read names no page it happened on', async () => {
      extension.reads({ success: true, data: aPage() });

      expect((await agent.readPage()).ok).toBe(false);
    });
  });

  describe('runForUrl', () => {
    it('has the agent read the page where it lives, rather than wherever the browser is', async () => {
      extension.analyzes({ 'cclom:title': 'Optik' }, SOURCE);

      const outcome = await agent.runForUrl('https://example.org/optik', 'Optik');

      expect(extension.fake.analyzeUrl).toHaveBeenCalledWith(
        'https://example.org/optik',
        'de',
        'Optik',
        METADATA_AGENT_API_URL,
      );
      expect(outcome.ok).toBe(true);
      expect(agent.lastRun()).toBe(outcome);
    });

    it('strips the quality criteria here too', async () => {
      extension.analyzes({ 'ccm:oeh_quality_criminal_law': ['einwandfrei'] }, SOURCE);

      expect((await agent.runForUrl('https://example.org/optik')).parsed?.raw).toEqual({});
    });

    it('reports what the worker refused with, in the same words', async () => {
      extension.refusesAnalysis('NO_ACTIVE_TAB');

      expect((await agent.runForUrl('https://example.org/optik')).error).toBe('Kein aktiver Tab gefunden.');
    });
  });

  describe('parse', () => {
    it('sorts the fields and drops the envelope', () => {
      const parsed = agent.parse({
        'ccm:taxonid': ['380'],
        'cclom:title': 'Optik',
        contextName: 'wlo',
        _source_text: 'Der Artikel.',
        processing: { fields_extracted: 7, fields_total: 12 },
      });

      // `localeCompare` sorts by the letters, so the namespace colon does not decide the order.
      expect(parsed.fields.map((field) => field.key)).toEqual(['cclom:title', 'ccm:taxonid']);
      expect(parsed.fieldsExtracted).toBe(7);
      expect(parsed.fieldsTotal).toBe(12);
    });

    it('keeps the whole payload, envelope included, as what the run answered', () => {
      expect(agent.parse({ contextName: 'wlo' }).raw).toEqual({ contextName: 'wlo' });
    });

    it('drops a field that states nothing rather than showing it empty', () => {
      const parsed = agent.parse({ 'cclom:title': '', 'ccm:taxonid': [], 'ccm:author': null });
      expect(parsed.fields).toEqual([]);
    });

    it('reads a value however the agent nested it', () => {
      const parsed = agent.parse({
        'ccm:taxonid': [{ uri: 'http://vocabs/380' }, { name: 'Physik' }],
        'ccm:duration': 45,
        'ccm:etwas': { unbekannt: true },
      });

      expect(parsed.fields.find((f) => f.key === 'ccm:taxonid')?.values).toEqual([
        'http://vocabs/380',
        'Physik',
      ]);
      expect(parsed.fields.find((f) => f.key === 'ccm:duration')?.values).toEqual(['45']);
      expect(parsed.fields.find((f) => f.key === 'ccm:etwas')?.values).toEqual(['{"unbekannt":true}']);
    });

    it('states no counts where the answer carries none', () => {
      const parsed = agent.parse(undefined);
      expect(parsed).toEqual({ fieldsExtracted: null, fieldsTotal: null, fields: [], raw: {} });
    });
  });

  describe('reset and restore', () => {
    it('discards the previous run', async () => {
      extension.analyzes({}, SOURCE);
      await agent.run();

      agent.reset();

      expect(agent.lastRun()).toBeNull();
    });

    it('takes a stored outcome back, as reopening a history entry does', () => {
      const outcome = { ok: true, source: SOURCE };
      agent.restore(outcome);
      expect(agent.lastRun()).toBe(outcome);
    });
  });

  describe('extractField', () => {
    /** The agent answers the single-field call with `body` under `status`. */
    function answers(body: unknown, status = 200): void {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
        ),
      );
    }

    const TEXT = 'Der Artikel selbst, lang genug, dass der Agent damit etwas anfangen kann.';

    it('asks the agent for the one field, out of the core schema', async () => {
      answers({ value: ['Optik'] });

      await agent.extractField(TEXT, 'cclom:general_keyword');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(EXTRACT_URL);
      expect(JSON.parse(init.body as string)).toMatchObject({
        input_source: 'text',
        text: TEXT,
        schema_file: 'core.json',
        field_id: 'cclom:general_keyword',
        language: 'de',
      });
    });

    it('carries the repository session, which is what the agent\'s proxy authorizes by', async () => {
      answers({ value: ['Optik'] });

      await agent.extractField(TEXT, 'cclom:general_keyword');

      expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe('include');
    });

    it('answers with the values, split as a multi-value field states them', async () => {
      answers({ value: 'Optik, Licht' });

      await expect(agent.extractField(TEXT, 'cclom:general_keyword')).resolves.toEqual({
        ok: true,
        values: ['Optik', 'Licht'],
      });
    });

    it('falls back to the value before normalization where there is no normalized one', async () => {
      answers({ raw_value: ['Optik'] });

      await expect(agent.extractField(TEXT, 'cclom:general_keyword')).resolves.toMatchObject({
        values: ['Optik'],
      });
    });

    it('never asks for a field on a text the agent has nothing to work with', async () => {
      await expect(agent.extractField('zu kurz', 'cclom:general_keyword')).resolves.toEqual({
        ok: false,
        error: 'Der Text enthält zu wenig Inhalt für eine Erschließung.',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a status the answer cannot be read under', async () => {
      answers('kaputt', 500);

      const outcome = await agent.extractField(TEXT, 'cclom:general_keyword');

      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('500');
    });

    it('reports an answer that is not JSON', async () => {
      answers('<html>Wartung</html>');

      expect((await agent.extractField(TEXT, 'cclom:general_keyword')).ok).toBe(false);
    });

    it('reports a run the agent did not answer in time as exactly that', async () => {
      fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));

      await expect(agent.extractField(TEXT, 'cclom:general_keyword')).resolves.toEqual({
        ok: false,
        error: 'Der Metadaten-Agent hat nicht rechtzeitig geantwortet.',
      });
    });

    it('never becomes the last run, so it neither opens an editor nor counts as unsaved work', async () => {
      answers({ value: ['Optik'] });

      await agent.extractField(TEXT, 'cclom:general_keyword');

      expect(agent.lastRun()).toBeNull();
    });

    it('answers from the fixture while the KI answers are faked, without asking anything', async () => {
      devMode.fake.enabled.set(true);

      const outcome = await agent.extractField(TEXT, 'cclom:general_keyword');

      expect(outcome.values).toEqual(EXTRACT_FIELD_ANSWER.value);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(devMode.faked).toEqual(['Agent POST /extract-field (cclom:general_keyword)']);
    });
  });
});
