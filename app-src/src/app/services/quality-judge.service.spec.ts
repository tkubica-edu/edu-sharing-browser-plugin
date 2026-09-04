import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import {
  BrowserExtensionFake,
  ContentJudgeFake,
  MetalookupFake,
  aJudgement,
  aMeasurement,
  fakeBrowserExtension,
  fakeContentJudge,
  fakeMetalookup,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionService, PageData } from './browser-extension.service';
import { ContentJudgeService } from './content-judge.service';
import { MetalookupResource, MetalookupService } from './metalookup.service';
import { JudgeState, QualityJudgeService } from './quality-judge.service';

const URL_UNDER_CHECK = 'https://example.org/optik';
const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

/** A page as the content script read it — long enough for ContentJudge to have something to judge. */
function aPage(url = URL_UNDER_CHECK): PageData {
  return { url, title: 'Optik', formattedText: 'Der Artikel selbst, in voller Länge.' } as PageData;
}

describe('QualityJudgeService', () => {
  let quality: QualityJudgeService;
  let extension: BrowserExtensionFake;
  let contentJudge: ContentJudgeFake;
  let metalookup: MetalookupFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    contentJudge = fakeContentJudge();
    metalookup = fakeMetalookup();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(ContentJudgeService, contentJudge.fake),
        provideFake(MetalookupService, metalookup.fake),
      ],
    });
    quality = TestBed.inject(QualityJudgeService);
  });

  /** Both judges switched on, as a spec that wants them to run needs them. */
  async function bothOn(): Promise<void> {
    await quality.setMetalookupEnabled(true);
    await quality.setContentJudgeEnabled(true);
  }

  /** What each judge ended up doing, by judge. */
  function stateOf(judge: 'MetalookUp' | 'ContentJudge'): JudgeState {
    return quality.statuses().find((status) => status.judge === judge)!.state;
  }

  /** Why it did that. */
  function detailOf(judge: 'MetalookUp' | 'ContentJudge'): string | null {
    return quality.statuses().find((status) => status.judge === judge)!.detail;
  }

  /** A run of both judges, awaited. */
  async function judged(resource: MetalookupResource = { url: URL_UNDER_CHECK }): Promise<void> {
    quality.start(resource);
    // `start` is fire and forget; both judges settle within a few microtasks of it.
    await vi.waitFor(() => expect(quality.running()).toBe(false));
  }

  describe('the switches', () => {
    it('measures every content unless the settings say otherwise, and judges none unless they do', () => {
      expect(quality.metalookupEnabled()).toBe(true);
      expect(quality.contentJudgeEnabled()).toBe(false);
    });

    it('keeps both, so the next session finds them', async () => {
      await quality.setMetalookupEnabled(false);
      await quality.setContentJudgeEnabled(true);

      expect(extension.fake.storageSet).toHaveBeenCalledWith(
        APP_CONFIG.storageKeys.qualityMetalookup,
        false,
      );
      expect(extension.fake.storageSet).toHaveBeenCalledWith(
        APP_CONFIG.storageKeys.qualityContentJudge,
        true,
      );
    });

    it('loads them, and the credential they depend on, before anything is judged', async () => {
      await quality.setMetalookupEnabled(false);
      await quality.setContentJudgeEnabled(true);

      const next = TestBed.inject(QualityJudgeService);
      await next.load();

      expect(contentJudge.fake.loadCredential).toHaveBeenCalled();
      expect(next.metalookupEnabled()).toBe(false);
      expect(next.contentJudgeEnabled()).toBe(true);
    });

    it('switches the judge off with the credential, without the setting being touched', async () => {
      await quality.setContentJudgeEnabled(true);
      expect(quality.contentJudgeEnabled()).toBe(true);

      contentJudge.fake.credentialSet.set(false);

      expect(quality.contentJudgeEnabled()).toBe(false);
    });

    it('counts a switch as changed only where it stands away from what the panel ships with', async () => {
      expect(quality.changedSettings()).toBe(0);

      await quality.setMetalookupEnabled(false);
      expect(quality.changedSettings()).toBe(1);

      await quality.setContentJudgeEnabled(true);
      expect(quality.changedSettings()).toBe(2);
    });

    it('counts the judge as the settings show it — a switch without a credential judges nothing', async () => {
      await quality.setContentJudgeEnabled(true);
      contentJudge.fake.credentialSet.set(false);

      expect(quality.changedSettings()).toBe(0);
    });
  });

  describe('start', () => {
    it('reports nothing before anything was asked', () => {
      expect(quality.asked()).toBe(false);
      expect(quality.statuses().map((status) => status.state)).toEqual(['idle', 'idle']);
    });

    it('has both judges answer, and keeps what each said', async () => {
      await bothOn();
      extension.extracts(aPage());
      metalookup.answers(aMeasurement([{ propertyId: 'ccm:accessibilitySummary', value: 0.9 } as never]));
      contentJudge.answers(aJudgement([{ scheme_id: 'neutralitaet', value: 4 } as never]));

      await judged();

      expect(stateOf('MetalookUp')).toBe('done');
      expect(stateOf('ContentJudge')).toBe('done');
      expect(quality.measured()?.featureExtractions).toHaveLength(1);
      expect(quality.evaluation()?.results[0].scheme_id).toBe('neutralitaet');
      expect(quality.asked()).toBe(true);
    });

    it('judges one content once, however often it is started', async () => {
      await bothOn();
      extension.extracts(aPage());

      quality.start({ url: URL_UNDER_CHECK });
      quality.start({ url: URL_UNDER_CHECK });
      await vi.waitFor(() => expect(quality.running()).toBe(false));

      expect(metalookup.fake.evaluate).toHaveBeenCalledTimes(1);
      expect(contentJudge.fake.evaluate).toHaveBeenCalledTimes(1);
    });

    it('leaves the other judge\'s answer standing where one of them fails', async () => {
      await bothOn();
      extension.extracts(aPage());
      metalookup.fails(new Error('MetalookUp nicht erreichbar'));

      await judged();

      expect(stateOf('MetalookUp')).toBe('failed');
      expect(detailOf('MetalookUp')).toContain('nicht erreichbar');
      expect(stateOf('ContentJudge')).toBe('done');
      expect(quality.evaluation()).not.toBeNull();
    });
  });

  describe('what MetalookUp is asked', () => {
    it('is bounded by the features the criteria point at', async () => {
      await bothOn();
      await judged();

      expect(metalookup.fake.evaluate).toHaveBeenCalledWith({ url: URL_UNDER_CHECK }, ['accessibility']);
    });

    it('is skipped where the settings switched the measurement off, and says so', async () => {
      await quality.setMetalookupEnabled(false);

      await judged();

      expect(stateOf('MetalookUp')).toBe('skipped');
      expect(detailOf('MetalookUp')).toContain('abgeschaltet');
      expect(metalookup.fake.evaluate).not.toHaveBeenCalled();
    });

    it('is skipped for a content that identifies itself in neither way', async () => {
      await judged({});

      expect(stateOf('MetalookUp')).toBe('skipped');
      expect(detailOf('MetalookUp')).toContain('weder eine Adresse noch einen Node');
    });

    it('runs for a content known only by its node', async () => {
      await judged({ nodeId: NODE });

      expect(metalookup.fake.evaluate).toHaveBeenCalledWith({ nodeId: NODE }, ['accessibility']);
    });
  });

  describe('what ContentJudge is asked', () => {
    it('is the text of the open page wherever that page is the content being judged', async () => {
      await bothOn();
      extension.extracts(aPage());

      await judged();

      expect(contentJudge.fake.evaluate).toHaveBeenCalledWith(
        { source: 'text', text: 'Der Artikel selbst, in voller Länge.' },
        expect.arrayContaining(['neutralitaet']),
      );
    });

    it('recognises the page as the content however its address is spelled', async () => {
      await bothOn();
      extension.extracts(aPage(`${URL_UNDER_CHECK}/#linsen`));

      await judged();

      expect(contentJudge.fake.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'text' }),
        expect.anything(),
      );
    });

    it('is the address where the browser shows a different page — one from the Verlauf, say', async () => {
      await bothOn();
      extension.extracts(aPage('https://example.org/etwas-anderes'));

      await judged();

      expect(contentJudge.fake.evaluate).toHaveBeenCalledWith(
        { source: 'url', url: URL_UNDER_CHECK },
        expect.anything(),
      );
    });

    it('is the node for a content with no address, read from the service\'s own repository', async () => {
      await bothOn();

      await judged({ nodeId: NODE });

      expect(contentJudge.fake.evaluate).toHaveBeenCalledWith(
        { source: 'nodeid', nodeId: NODE },
        expect.anything(),
      );
    });

    it('is skipped where there is nothing left to judge at all', async () => {
      await bothOn();

      await judged({});

      expect(stateOf('ContentJudge')).toBe('skipped');
      expect(detailOf('ContentJudge')).toContain('nichts, was sich beurteilen ließe');
      expect(contentJudge.fake.evaluate).not.toHaveBeenCalled();
    });

    it('is skipped while the settings hold it off, and says which of the two reasons applies', async () => {
      await judged();
      expect(detailOf('ContentJudge')).toContain('abgeschaltet');

      quality.reset();
      contentJudge.fake.credentialSet.set(false);
      await quality.setContentJudgeEnabled(true);
      await judged();
      expect(detailOf('ContentJudge')).toContain('kein Zugang hinterlegt');
    });
  });

  describe('reset', () => {
    it('drops what was judged and lets the next content be judged', async () => {
      await bothOn();
      extension.extracts(aPage());
      await judged();

      quality.reset();

      expect(quality.evaluation()).toBeNull();
      expect(quality.measured()).toBeNull();
      expect(quality.asked()).toBe(false);

      await judged();
      expect(contentJudge.fake.evaluate).toHaveBeenCalledTimes(2);
    });
  });
});
