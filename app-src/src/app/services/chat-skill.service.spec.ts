import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { ChatSkillService } from './chat-skill.service';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

describe('ChatSkillService', () => {
  let skill: ChatSkillService;
  let extension: BrowserExtensionFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    skill = TestBed.inject(ChatSkillService);
  });

  const key = APP_CONFIG.storageKeys.chatMasterSkill;

  it('says nothing about the skill until it is told to, and leaves the attribute off', () => {
    // The operator's configuration is the intended state, so the panel does not speak over it.
    expect(skill.masterSkill()).toBe('operator');
    expect(skill.masterSkillAttribute()).toBeNull();
    expect(skill.changedSettings()).toBe(0);
  });

  describe('load', () => {
    it('takes over what was said for this embedding', async () => {
      extension.storage.set(key, 'off');

      await skill.load();

      expect(skill.masterSkill()).toBe('off');
    });

    it('takes over the third state as readily as the other two', async () => {
      extension.storage.set(key, 'operator');

      await skill.load();

      expect(skill.masterSkill()).toBe('operator');
    });

    it('follows the operator where nothing was stored at all', async () => {
      await skill.load();

      expect(skill.masterSkill()).toBe('operator');
    });

    it('follows the operator for a value no version of this setting has', async () => {
      extension.storage.set(key, 'enabled');

      await skill.load();

      // A key left behind by another version says nothing about this embedding.
      expect(skill.masterSkill()).toBe('operator');
    });

    it('follows the operator for a stored value that is not a string', async () => {
      extension.storage.set(key, true);

      await skill.load();

      expect(skill.masterSkill()).toBe('operator');
    });
  });

  describe('what the widget`s attribute carries', () => {
    it('states the skill for the two states that state something', async () => {
      await skill.setMasterSkill('on');
      expect(skill.masterSkillAttribute()).toBe('on');

      await skill.setMasterSkill('off');
      expect(skill.masterSkillAttribute()).toBe('off');
    });

    it('is left off the element altogether while the operator decides', async () => {
      await skill.setMasterSkill('on');
      await skill.setMasterSkill('operator');

      // A missing attribute leaves the state to the operator; an empty one is read that way by
      // this version of the widget alone.
      expect(skill.masterSkillAttribute()).toBeNull();
    });
  });

  describe('what the settings count', () => {
    it('counts nothing while the panel follows the operator', async () => {
      await skill.setMasterSkill('operator');

      expect(skill.changedSettings()).toBe(0);
    });

    it('counts either state that stands away from that', async () => {
      await skill.setMasterSkill('on');
      expect(skill.changedSettings()).toBe(1);

      await skill.setMasterSkill('off');
      expect(skill.changedSettings()).toBe(1);
    });
  });

  describe('persistence', () => {
    it('writes the setting through, so it survives a reload', async () => {
      await skill.setMasterSkill('off');

      expect(extension.storage.get(key)).toBe('off');
    });

    it('writes the state the panel ships with just as explicitly', async () => {
      await skill.setMasterSkill('on');

      await skill.resetToDefault();

      expect(skill.masterSkill()).toBe('operator');
      expect(extension.storage.get(key)).toBe('operator');
    });
  });
});
