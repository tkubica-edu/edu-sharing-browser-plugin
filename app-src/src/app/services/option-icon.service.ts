import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ScreenId, SectionId } from '../model/navigation';

/** Anything that renders with an icon: a section (menu entry, topbar) or a tab. */
export type IconId = SectionId | ScreenId;

/**
 * Full-width, stroke-style icons (24×24) keyed by section / screen id — the few whose motif the icon font has
 * nothing for; everything else is a ligature (see {@link MATERIAL_ICONS}). Only the tab bar still draws these,
 * and the entries it does not reach today are kept because they are tab ids.
 */
const ICONS: Partial<Record<IconId, string>> = {
  // A page with what is done to it: the options as a ticked line, the search for a fitting content as
  // a magnifier with a spark.
  'content-options':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8.5 14.5l2 2 4-4"/></svg>',
  'find-content':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.2-5.2"/><path d="M10.5 6.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/></svg>',
  // The collection a forwarded content lands in — stacked layers with a tick.
  'select-collection':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 4-2"/><path d="M17.5 18.5l1.5 1.5 3-3.2"/></svg>',
  // The KI analysis: a document with what the machine reports about it, ticked line by line.
  'ai-quality':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12.5 6.5"/><path d="M8 14l1.5 1.5L12.5 12.5"/><path d="M15 8.5h2"/><path d="M15 14.5h2"/></svg>'
};

/**
 * Google Material icons, so the panel's rows and tabs read like the rest of edu-sharing; the names are Material
 * Symbols ligatures rendered by the `esIcon` directive. Every entry the menu, the topbar and the Add-Content rows
 * can show is named here — only a tab id may be missing, since the tab bar draws {@link ICONS} where it is.
 */
const MATERIAL_ICONS: Partial<Record<IconId, string>> = {
  // The main menu's entries.
  'add-content': 'add_notes',
  curation: 'quick_reference',
  'own-content': 'folder_open',
  history: 'history',
  // The Qualitätsprüfung's two views.
  'quality-check': 'check_circle',
  metadata: 'sell',
  // The steps the Inhaltsoptionen offer as rows: those rows already carry these glyphs (see
  // ContentOptionsScreenComponent.options), so the same step is drawn the same way wherever it is
  // reached from.
  editing: 'edit',
  'editorial-forward': 'person_add',
  preview: 'visibility',
  usages: 'bar_chart',
  share: 'share',
  // The entries whose glyph draws what the SVG drew: three lines, a door with an arrow, a framed
  // picture, a page with a plus, an arrow into a tray, a magnifier, a shield with a tick, a folder
  // with a person, a path splitting in two, an "i" in a circle, a bubble with a spark, a gear.
  menu: 'menu',
  login: 'login',
  'curation-preview': 'image',
  'new-document': 'note_add',
  'add-material': 'upload',
  search: 'search',
  quality: 'verified_user',
  'personal-storage': 'folder_shared',
  'flow-choice': 'alt_route',
  overview: 'info',
  'ai-assistant': 'assistant',
  settings: 'settings'
};

// The icons, shared by the four places that render navigation entries: the main menu, the tab bar,
// the topbar (the utility sections, see AppSection.topbar) and the Add-Content rows.
@Injectable({ providedIn: 'root' })
export class OptionIconService {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cache = new Map<IconId, SafeHtml>();

  /** The entry's Material icon name for {@link IconDirective}, or null where there is none. */
  material(id: IconId): string | null {
    return MATERIAL_ICONS[id] ?? null;
  }

  /**
   * The entry's inline icon, for the tab bar — the one place that still draws one. Empty for
   * everything {@link MATERIAL_ICONS} names. Trusted: the SVGs are the constants above, not user
   * input.
   */
  icon(id: IconId): SafeHtml {
    let icon = this.cache.get(id);
    if (!icon) {
      icon = this.sanitizer.bypassSecurityTrustHtml(ICONS[id] ?? '');
      this.cache.set(id, icon);
    }
    return icon;
  }
}
