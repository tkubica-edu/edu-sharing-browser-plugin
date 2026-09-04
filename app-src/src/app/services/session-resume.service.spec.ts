import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import {
  BrowserExtensionFake,
  CurationFake,
  NavigationFake,
  fakeAuth,
  fakeBrowserExtension,
  fakeCuration,
  fakeNavigation,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';
import { SessionResumeService } from './session-resume.service';

const KEY = APP_CONFIG.storageKeys.resumeState;
const PAGE = 'https://example.org/optik';

describe('SessionResumeService', () => {
  let resume: SessionResumeService;
  let extension: BrowserExtensionFake;
  let navigation: NavigationFake;
  let curation: CurationFake;
  let conditions: ConditionsService;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    navigation = fakeNavigation();
    curation = fakeCuration();
    TestBed.configureTestingModule({
      providers: [
        // The real `ConditionsService` is used rather than a fake: it is a derivation over the fakes
        // around it, and faking it would move its own rules into this spec (see navigation.service.spec).
        provideFake(AuthService, fakeAuth().fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(NavigationService, navigation.fake),
        provideFake(CurationService, curation.fake),
      ],
    });
    resume = TestBed.inject(SessionResumeService);
    conditions = TestBed.inject(ConditionsService);
    conditions.activeUrl.set(PAGE);
  });

  /** What was last written under the resume key. */
  function stored(key = KEY): Record<string, unknown> | null {
    return (extension.storage.get(key) ?? null) as Record<string, unknown> | null;
  }

  /** Put a state into storage as a previous page's panel left it. */
  function leftBehind(state: Record<string, unknown>, key = KEY): void {
    extension.storage.set(key, { section: 'quality', tab: null, trail: [], at: Date.now(), ...state });
  }

  describe('tracking', () => {
    it('writes nothing before the restore has run', async () => {
      navigation.at('quality', 'metadata');
      await TestBed.inject(SessionResumeService);
      TestBed.tick();

      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });

    it('writes where the user is once tracking is on', async () => {
      navigation.at('quality', 'metadata');
      navigation.came({ section: 'curation', tab: null });
      curation.chose('node-7');

      resume.track();
      TestBed.tick();
      await vi.waitFor(() => expect(stored()).not.toBeNull());

      expect(stored()).toMatchObject({
        section: 'quality',
        tab: 'metadata',
        trail: [{ section: 'curation', tab: null }],
        nodeId: 'node-7',
        nodeSource: 'chosen',
        url: PAGE,
      });
    });

    it('writes again whenever the state changes', async () => {
      resume.track();
      TestBed.tick();
      await vi.waitFor(() => expect(stored()).not.toBeNull());

      navigation.at('overview', 'preview');
      TestBed.tick();

      await vi.waitFor(() => expect(stored()).toMatchObject({ section: 'overview' }));
    });

    it('carries the Erschließung the content still owes', async () => {
      curation.owesExtraction('https://example.org/noch-offen');

      resume.track();
      TestBed.tick();

      await vi.waitFor(() =>
        expect(stored()).toMatchObject({ extractUrl: 'https://example.org/noch-offen' }),
      );
    });
  });

  describe('save', () => {
    it('writes at once, and names the page the panel is about to land on', async () => {
      navigation.at('quality');

      await resume.save('https://example.org/danach');

      expect(stored()).toMatchObject({ section: 'quality', url: 'https://example.org/danach' });
    });

    it('takes the current page where the caller names none', async () => {
      await resume.save();

      expect(stored()).toMatchObject({ url: PAGE });
    });

    it('is the app\'s last write — nothing overwrites it afterwards', async () => {
      navigation.at('quality');
      resume.track();
      await resume.save('https://example.org/danach');

      navigation.at('overview');
      TestBed.tick();

      expect(stored()).toMatchObject({ url: 'https://example.org/danach', section: 'quality' });
    });
  });

  describe('restore', () => {
    it('takes the node back up first, since the step is often only reachable because of it', async () => {
      leftBehind({ nodeId: 'node-7', nodeSource: 'chosen', url: PAGE });

      await expect(resume.restore()).resolves.toBe(true);

      expect(curation.fake.resumeNode).toHaveBeenCalledWith('node-7', 'chosen');
      expect(navigation.fake.resume).toHaveBeenCalled();
    });

    it('walks the whole way the user came, not just where they stood', async () => {
      leftBehind({ section: 'quality', tab: 'metadata', trail: [{ section: 'curation', tab: null }] });

      await resume.restore();

      expect(navigation.fake.resume).toHaveBeenCalledWith({ section: 'quality', tab: 'metadata' }, [
        { section: 'curation', tab: null },
      ]);
    });

    it('reports that nothing applied, so the caller lands instead', async () => {
      leftBehind({});
      navigation.resumesNothing();

      await expect(resume.restore()).resolves.toBe(false);
    });

    it('restores nothing where no state was stored at all', async () => {
      await expect(resume.restore()).resolves.toBe(false);
      expect(navigation.fake.resume).not.toHaveBeenCalled();
    });

    it('restores nothing left behind by a load that never happened', async () => {
      leftBehind({ at: Date.now() - 61_000 });

      await expect(resume.restore()).resolves.toBe(false);
    });

    it('restores nothing from a state that names no step', async () => {
      extension.storage.set(KEY, { nodeId: 'node-7', at: Date.now() });

      await expect(resume.restore()).resolves.toBe(false);
    });

    it('keeps a node the user chose, whatever page this is', async () => {
      leftBehind({ nodeId: 'node-7', nodeSource: 'chosen', url: 'https://example.org/woanders' });

      await resume.restore();

      expect(curation.fake.resumeNode).toHaveBeenCalled();
    });

    it('drops a node found on another page — it was a statement about that page', async () => {
      leftBehind({ nodeId: 'node-7', nodeSource: 'detected', url: 'https://example.org/woanders' });

      await resume.restore();

      expect(curation.fake.resumeNode).not.toHaveBeenCalled();
    });

    it('keeps a detected node where the page is the same one', async () => {
      leftBehind({ nodeId: 'node-7', nodeSource: 'detected', url: PAGE });

      await resume.restore();

      expect(curation.fake.resumeNode).toHaveBeenCalledWith('node-7', 'detected');
    });

    it('takes an unknown page at face value rather than as a reason to drop the node', async () => {
      conditions.activeUrl.set(null);
      leftBehind({ nodeId: 'node-7', nodeSource: 'detected', url: 'https://example.org/woanders' });

      await resume.restore();

      expect(curation.fake.resumeNode).toHaveBeenCalled();
    });

    it('starts the Erschließung the content still owes, without waiting for it', async () => {
      leftBehind({
        nodeId: 'node-7',
        nodeSource: 'chosen',
        extractUrl: 'https://example.org/noch-offen',
      });

      await resume.restore();

      expect(curation.fake.resumePendingExtraction).toHaveBeenCalledWith(
        'https://example.org/noch-offen',
      );
    });

    it('starts none where the node could not be taken back up', async () => {
      curation.refuseResume();
      leftBehind({ nodeId: 'node-7', nodeSource: 'chosen', extractUrl: 'https://example.org/offen' });

      await resume.restore();

      expect(curation.fake.resumePendingExtraction).not.toHaveBeenCalled();
    });

    it('restores nothing where the storage cannot be read', async () => {
      extension.storageGet.mockRejectedValueOnce(new Error('storage denied'));

      await expect(resume.restore()).resolves.toBe(false);
    });
  });

  describe('the storage key', () => {
    it('is per tab, so two panels do not overwrite each other', async () => {
      extension.inTab(42);
      navigation.at('quality');

      await resume.save();

      expect(stored(`${KEY}:42`)).toMatchObject({ section: 'quality' });
      expect(stored()).toBeNull();
    });

    it('is one shared key where there is no tab — there is only one panel then', async () => {
      await resume.save();

      expect(stored()).not.toBeNull();
    });

    it('is resolved once and reused', async () => {
      extension.inTab(42);

      await resume.save();
      await resume.save();

      expect(extension.fake.getOwnTabId).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('forgets the state, so the panel comes back at the main menu', async () => {
      await resume.save();

      await resume.clear();

      expect(stored()).toBeNull();
    });

    it('stops the tracking with it', async () => {
      resume.track();
      await resume.clear();

      navigation.at('overview');
      TestBed.tick();

      expect(stored()).toBeNull();
    });
  });
});
