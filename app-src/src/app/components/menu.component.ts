import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { NavigationService } from '../services/navigation.service';
import { HistoryService } from '../services/history.service';
import { AuthService } from '../services/auth.service';
import { UiStateService } from '../services/ui-state.service';
import { ExtensionService } from '../extension/extension.service';
import { ExtElementComponent } from '../extension/ext-element.component';

// Full-width, stroke-style option icons (24×24). Keyed by AppOption.icon.
const ICONS: Record<string, string> = {
  login:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
  analyze:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.9L12 16l-1.8-4.7L5.5 9.4l4.7-1.8z"/><path d="M18.5 14.5l.9 2.3 2.1.8-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.8z"/></svg>',
  preview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  'new-document':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>',
  metadata:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  collections:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v6"/><path d="M9 11l3 3 3-3"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  history:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};

// The "Aktionen & Optionen" list: the flow-agnostic options, filtered to those visible for
// the current conditions. Selecting one navigates to its screen.
@Component({
  selector: 'es-menu',
  standalone: true,
  imports: [CommonModule, ExtElementComponent],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss'
})
export class MenuComponent {
  readonly nav = inject(NavigationService);
  readonly history = inject(HistoryService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  private readonly extensionService = inject(ExtensionService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly iconCache = new Map<string, SafeHtml>();

  // Each visible option paired with its extension menu-item rendering (null for default).
  readonly items = computed(() =>
    this.nav.visibleOptions().map((option) => ({
      option,
      rendering: this.extensionService.getRendering('menuItem', option.id, this.ui.conditions()),
    })),
  );

  icon(key: string): SafeHtml {
    let svg = this.iconCache.get(key);
    if (!svg) {
      // Extensions may supply a raw inline SVG as the icon; otherwise resolve the built-in set.
      const raw = key?.trim().startsWith('<svg') ? key : (ICONS[key] ?? '');
      svg = this.sanitizer.bypassSecurityTrustHtml(raw);
      this.iconCache.set(key, svg);
    }
    return svg;
  }
}
