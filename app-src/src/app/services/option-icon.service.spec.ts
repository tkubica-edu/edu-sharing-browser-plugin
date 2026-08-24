import { DomSanitizer } from '@angular/platform-browser';
import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { OptionIconService } from './option-icon.service';

describe('OptionIconService', () => {
  let icons: OptionIconService;
  let sanitizer: DomSanitizer;

  beforeEach(() => {
    // The real sanitizer: `BrowserTestingModule` provides it, and what `icon()` returns is only
    // meaningful once it is unwrapped again.
    icons = TestBed.inject(OptionIconService);
    sanitizer = TestBed.inject(DomSanitizer);
  });

  describe('material', () => {
    it('names the ligature the icon font draws an entry with', () => {
      expect(icons.material('history')).toBe('history');
      expect(icons.material('editorial-forward')).toBe('person_add');
    });

    it('answers null for an entry the font has no motif for', () => {
      // Drawn from the inline SVGs instead — see `icon()`.
      expect(icons.material('find-content')).toBeNull();
    });
  });

  describe('icon', () => {
    it('hands out the inline SVG for the few entries that still draw one', () => {
      const markup = sanitizer.sanitize(SecurityContext.HTML, icons.icon('find-content'));

      expect(markup).toContain('<svg');
      expect(markup).toContain('viewBox="0 0 24 24"');
    });

    it('hands out nothing for an entry the icon font covers', () => {
      expect(sanitizer.sanitize(SecurityContext.HTML, icons.icon('history'))).toBe('');
    });

    it('caches per entry, so the tab bar does not re-trust the same markup', () => {
      expect(icons.icon('find-content')).toBe(icons.icon('find-content'));
    });

    it('caches the empty answer too', () => {
      expect(icons.icon('history')).toBe(icons.icon('history'));
    });
  });
});
