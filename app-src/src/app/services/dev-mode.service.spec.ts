import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { DevModeService, GENERATE_FIXTURES } from './dev-mode.service';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

/** The fixture a run answers with while nobody chose one. */
const DEFAULT_FIXTURE = GENERATE_FIXTURES[0].id;
/** One that is not the default, for the settings-count tests. */
const OTHER_FIXTURE = GENERATE_FIXTURES[1].id;

describe('DevModeService', () => {
  let devMode: DevModeService;
  let extension: BrowserExtensionFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    devMode = TestBed.inject(DevModeService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const keys = APP_CONFIG.storageKeys;

  /** Switch the mode on with the settings a faked run is shaped by. */
  async function enable(
    settings: { collectionId?: string; nodeId?: string; skipWrites?: boolean; generate?: string } = {},
  ): Promise<void> {
    await devMode.setEnabled(true);
    if (settings.collectionId !== undefined) await devMode.setCollectionId(settings.collectionId);
    if (settings.nodeId !== undefined) await devMode.setNodeId(settings.nodeId);
    if (settings.skipWrites !== undefined) await devMode.setSkipWrites(settings.skipWrites);
    if (settings.generate !== undefined) await devMode.setGenerate(settings.generate);
  }

  it('is off by default, so an install nobody configured never fakes an answer', () => {
    expect(devMode.enabled()).toBe(false);
    expect(devMode.collectionId()).toBe('');
    expect(devMode.nodeId()).toBe('');
    expect(devMode.skipWrites()).toBe(false);
    expect(devMode.generate()).toBe(DEFAULT_FIXTURE);
  });

  describe('load', () => {
    it('takes over every persisted setting', async () => {
      extension.storage.set(keys.devMode, true);
      extension.storage.set(keys.devModeCollectionId, 'collection-7');
      extension.storage.set(keys.devModeSkipWrites, true);
      extension.storage.set(keys.devModeNodeId, 'node-7');
      extension.storage.set(keys.devModeGenerate, OTHER_FIXTURE);

      await devMode.load();

      expect(devMode.enabled()).toBe(true);
      expect(devMode.collectionId()).toBe('collection-7');
      expect(devMode.skipWrites()).toBe(true);
      expect(devMode.nodeId()).toBe('node-7');
      expect(devMode.generate()).toBe(OTHER_FIXTURE);
    });

    it('falls back to the first fixture for an id no fixture is held under', async () => {
      extension.storage.set(keys.devModeGenerate, 'a-fixture-that-was-removed');

      await devMode.load();

      expect(devMode.generate()).toBe(DEFAULT_FIXTURE);
    });

    it('falls back for a stored value that is not a string at all', async () => {
      extension.storage.set(keys.devModeGenerate, null);

      await devMode.load();

      expect(devMode.generate()).toBe(DEFAULT_FIXTURE);
    });
  });

  describe('what a setting says only while the mode is on', () => {
    it('reports no faked collection while the mode is off', async () => {
      await devMode.setCollectionId('collection-7');

      expect(devMode.collectionId()).toBe('collection-7');
      expect(devMode.fakedCollectionId()).toBe('');
    });

    it('reports the trimmed collection while it is on', async () => {
      await enable({ collectionId: '  collection-7  ' });

      expect(devMode.fakedCollectionId()).toBe('collection-7');
    });

    it('skips no write unless both the mode and the flag say so', async () => {
      await devMode.setSkipWrites(true);
      expect(devMode.writesSkipped()).toBe(false);

      await devMode.setEnabled(true);
      expect(devMode.writesSkipped()).toBe(true);
    });

    it('names no stand-in node while the writes are actually made', async () => {
      await enable({ nodeId: 'node-7', skipWrites: false });

      // With a node of its own, a second id would be a claim about a different content.
      expect(devMode.nodeId()).toBe('node-7');
      expect(devMode.fakedNodeId()).toBe('');
    });

    it('names the stand-in node once the writes are skipped', async () => {
      await enable({ nodeId: '  node-7 ', skipWrites: true });

      expect(devMode.fakedNodeId()).toBe('node-7');
    });
  });

  describe('changedSettings', () => {
    it('counts nothing while the mode is off, whatever is stored', async () => {
      await devMode.setCollectionId('collection-7');
      await devMode.setSkipWrites(true);

      expect(devMode.changedSettings()).toBe(0);
    });

    it('counts the mode itself once it is on', async () => {
      await enable();

      expect(devMode.changedSettings()).toBe(1);
    });

    it('counts each setting that stands away from what the panel ships with', async () => {
      await enable({
        generate: OTHER_FIXTURE,
        collectionId: 'collection-7',
        skipWrites: true,
        nodeId: 'node-7',
      });

      expect(devMode.changedSettings()).toBe(5);
    });
  });

  describe('persistence', () => {
    it('writes each setter through to its own key, trimmed', async () => {
      await devMode.setEnabled(true);
      await devMode.setCollectionId('  collection-7  ');
      await devMode.setNodeId('  node-7  ');
      await devMode.setSkipWrites(true);
      await devMode.setGenerate(OTHER_FIXTURE);

      expect(extension.storage.get(keys.devMode)).toBe(true);
      expect(extension.storage.get(keys.devModeCollectionId)).toBe('collection-7');
      expect(extension.storage.get(keys.devModeNodeId)).toBe('node-7');
      expect(extension.storage.get(keys.devModeSkipWrites)).toBe(true);
      expect(extension.storage.get(keys.devModeGenerate)).toBe(OTHER_FIXTURE);
    });

    it('normalises an unknown fixture id before persisting it', async () => {
      await devMode.setGenerate('a-fixture-that-was-removed');

      expect(extension.storage.get(keys.devModeGenerate)).toBe(DEFAULT_FIXTURE);
    });
  });

  describe('answering from a fixture', () => {
    it('waits before answering, so the caller sees the in-flight state too', async () => {
      let settled = false;
      const answer = devMode.answer('generate', { title: 'Dresden' }).then((value) => {
        settled = true;
        return value;
      });

      await vi.advanceTimersByTimeAsync(299);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(await answer).toEqual({ title: 'Dresden' });
    });

    it('hands out a deep copy, so one run cannot edit the next run start', async () => {
      const fixture = { keywords: ['Optik'], nested: { fields: ['title'] } };

      const answer = devMode.answer('generate', fixture);
      await vi.advanceTimersByTimeAsync(300);
      const received = await answer;

      received.nested.fields.push('description');
      received.keywords.push('Linse');

      expect(fixture.nested.fields).toEqual(['title']);
      expect(fixture.keywords).toEqual(['Optik']);
    });

    it('waits the same before a faked failure, so the in-flight state is exercised', async () => {
      const cause = new Error('ContentJudge antwortet mit 503');
      const failure = devMode.fail('evaluate', cause);
      const settled = expect(failure).rejects.toBe(cause);

      await vi.advanceTimersByTimeAsync(300);
      await settled;
    });
  });
});
