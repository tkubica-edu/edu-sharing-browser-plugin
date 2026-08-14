import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ScreenId, SectionId } from '../model/navigation';

/** Anything that renders with an icon: a section (menu entry, topbar) or a tab. */
export type IconId = SectionId | ScreenId;

/**
 * Full-width, stroke-style icons (24×24), keyed by section / screen id. Only for the entries that
 * still draw their own icon — whatever {@link MATERIAL_ICONS} names is rendered from the icon font
 * and has no entry here.
 */
const ICONS: Partial<Record<IconId, string>> = {
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>',
  login:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
  // The curated content's picture, before anything is written: a framed image.
  'curation-preview':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M3 16.5l4.5-3.5L12 17"/><path d="M13 17l3-3 5 4"/></svg>',
  'content-options':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8.5 14.5l2 2 4-4"/></svg>',
  'new-document':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>',
  'add-material':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  'find-content':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.2-5.2"/><path d="M10.5 6.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/></svg>',
  quality:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.4-3.2 8-8 9-4.8-1-8-4.6-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  // Filing a curated content in one's own place: a folder with the person on it. Under it sits the
  // choice of the collection it lands in — stacked layers with a tick.
  'personal-storage':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.5H19.5A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.8" r="1.8"/><path d="M9 17.2a3.2 3.2 0 0 1 6 0"/></svg>',
  'select-collection':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 4-2"/><path d="M17.5 18.5l1.5 1.5 3-3.2"/></svg>',
  // The choice of process: two paths leaving one point. Behind it the KI analysis — a document with
  // what the machine reports about it, ticked line by line.
  'flow-choice':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V13"/><path d="M12 13L5 8V4"/><path d="M12 13l7-5V4"/><circle cx="5" cy="3.5" r="1.6"/><circle cx="19" cy="3.5" r="1.6"/><circle cx="12" cy="21.5" r="1.6"/></svg>',
  'ai-quality':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12.5 6.5"/><path d="M8 14l1.5 1.5L12.5 12.5"/><path d="M15 8.5h2"/><path d="M15 14.5h2"/></svg>',
  overview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11.5 12h1v4h1"/></svg>',
  // The assistant: a speech bubble for the asking, with the spark that marks what a machine answers.
  'ai-assistant':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A2.5 2.5 0 0 1 17.5 17H12l-4.5 3.5V17H6a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 6 4h11.5A2.5 2.5 0 0 1 20 6.5z"/><path d="M11.75 7.5l1.05 2.7 2.7 1.05-2.7 1.05-1.05 2.7-1.05-2.7L8 11.25l2.7-1.05z"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};

/**
 * Google Material icons instead of the drawn ones above — the panel's rows and tabs then read like
 * the rest of edu-sharing. Names are Material Symbols ligatures, rendered by the `esIcon` directive.
 * Whatever is not listed here keeps its SVG, so the two can be mixed while this spreads.
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
  share: 'share'
};

// The icons, shared by the three places that render navigation entries: the main menu, the tab bar
// and the topbar (the utility sections, see AppSection.topbar).
@Injectable({ providedIn: 'root' })
export class OptionIconService {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cache = new Map<IconId, SafeHtml>();

  /** The entry's Material icon name for {@link IconDirective}, or null where there is none. */
  material(id: IconId): string | null {
    return MATERIAL_ICONS[id] ?? null;
  }

  /** The entry's inline icon. Trusted: the SVGs are the constants above, not user input. */
  icon(id: IconId): SafeHtml {
    let icon = this.cache.get(id);
    if (!icon) {
      icon = this.sanitizer.bypassSecurityTrustHtml(ICONS[id] ?? '');
      this.cache.set(id, icon);
    }
    return icon;
  }
}
