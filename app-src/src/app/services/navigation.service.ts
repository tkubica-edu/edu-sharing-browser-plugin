import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AppSection, SECTIONS, ScreenId, SectionId, SectionTab } from '../model/navigation';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';

/** A section's sub step as the tab bar renders it: its definition plus whether it can be opened. */
export interface TabView extends SectionTab {
  disabled: boolean;
}

// The single source of navigation truth: which section is open, which of its tabs is selected,
// guarded transitions, the current title, and the landing logic.
//
// Navigation is two levels deep and no deeper: a section, and one of its sub steps (tabs). The
// back button always returns to the main menu (no step-history stack) — the flow's own steps hand
// over to each other through the footer actions instead.
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly conditions = inject(ConditionsService);
  // Only to release a picked content when its flow ends — see openMenu().
  private readonly curation = inject(CurationService);

  readonly section = signal<SectionId>('menu');

  /** The tab the user picked; `null` (and after a section change) means "the section's first". */
  private readonly requestedTab = signal<ScreenId | null>(null);

  /** Back button is shown on every section except the menu; it always returns to the menu. */
  readonly showBack = computed(() => this.section() !== 'menu');

  /**
   * The sections listed in the main menu, in registry order, filtered by the conditions. A section
   * may be reachable without being offered here — see AppSection.listed.
   */
  readonly menuSections = computed(() => {
    const conditions = this.conditions.snapshot();
    return SECTIONS.filter(
      (section) =>
        section.menu && section.visible(conditions) && (section.listed?.(conditions) ?? true),
    );
  });

  /** The utility sections, shown as topbar icons rather than as menu entries. */
  readonly topbarSections = computed(() => {
    const conditions = this.conditions.snapshot();
    return SECTIONS.filter((section) => section.topbar && section.visible(conditions));
  });

  /** The open section's definition; undefined on the menu. */
  readonly currentSection = computed<AppSection | undefined>(() => this.sectionOf(this.section()));

  /** The open section's sub steps that apply right now, each with its current openability. */
  readonly tabs = computed<readonly TabView[]>(() => {
    const conditions = this.conditions.snapshot();
    return (
      this.currentSection()
        ?.tabs.filter((tab) => tab.visible?.(conditions) ?? true)
        .map((tab) => ({ ...tab, disabled: !(tab.enabled?.(conditions) ?? true) })) ?? []
    );
  });

  /** A tab bar only makes sense for a real choice. A disabled tab still counts — it is the hint. */
  readonly showTabs = computed(() => this.tabs().length > 1);

  /**
   * The screen to render: the requested tab while it is one of the section's open-able ones, else
   * the section's first open-able one. Derived rather than stored, so a tab that falls away or
   * locks again (its condition changed) never strands the user on a dead screen.
   */
  readonly screen = computed<ScreenId | null>(() => {
    const tabs = this.tabs();
    const requested = this.requestedTab();
    if (requested && tabs.some((tab) => tab.id === requested && !tab.disabled)) return requested;
    return (tabs.find((tab) => !tab.disabled) ?? tabs[0])?.id ?? null;
  });

  /** The sub step following the open one, if the section has one. */
  readonly nextTab = computed<TabView | null>(() => {
    const tabs = this.tabs();
    const index = tabs.findIndex((tab) => tab.id === this.screen());
    return index < 0 ? null : tabs[index + 1] ?? null;
  });

  /**
   * Heading shown for the current section. A section may be *named* differently where it is entered
   * than where it is open (see AppSection.title), so the title wins over the label.
   */
  readonly title = computed(() => {
    if (this.section() === 'menu') return 'Hauptmenü';
    const section = this.currentSection();
    return section?.title ?? section?.label ?? '';
  });

  constructor() {
    // Guard: if the open section becomes invisible (logout, node cleared, page change), don't
    // strand the user on a dead screen — re-land on a valid view.
    effect(() => {
      const id = this.section();
      if (id === 'menu') return;
      if (!this.isVisible(id)) this.land();
    });
  }

  /**
   * Whether a section applies right now. For the screens that offer a *choice of sections* (see
   * the add-content screen), so they never offer a target that {@link go} would refuse.
   */
  isVisible(id: SectionId, conditions = this.conditions.snapshot()): boolean {
    return this.sectionOf(id)?.visible(conditions) ?? false;
  }

  /** Navigate to a section, if currently visible; optionally straight to one of its tabs. */
  go(id: SectionId, options?: { tab?: ScreenId }): void {
    if (!this.isVisible(id)) return;
    this.section.set(id);
    this.requestedTab.set(options?.tab ?? null);
  }

  /** Select one of the open section's sub steps, if it can be opened right now. */
  goTab(id: ScreenId): void {
    if (this.tabs().some((tab) => tab.id === id && !tab.disabled)) this.requestedTab.set(id);
  }

  /** Advance to the section's next sub step, if there is one and it can be opened. */
  goNextTab(): void {
    const next = this.nextTab();
    if (next) this.goTab(next.id);
  }

  /**
   * Back to the main menu — which ends whatever flow was running, so a content the user *picked*
   * for it is released again (a detected one is kept; see CurationService.releaseChosenContent).
   */
  openMenu(): void {
    this.section.set('menu');
    this.requestedTab.set(null);
    this.curation.releaseChosenContent();
  }

  /**
   * Pick the view that fits the current context: the main menu, unless the user must log in first.
   *
   * Nothing else opens itself — the main menu is the start view everywhere, so what is on offer
   * stays visible instead of being decided for the user. A node that was loaded (an OnlyOffice
   * document, a history entry) surfaces as the *Inhalt erkannt* menu entry rather than as a jump.
   */
  land(): void {
    if (!this.conditions.snapshot().loggedIn) return this.go('login');
    this.openMenu();
  }

  private sectionOf(id: SectionId): AppSection | undefined {
    return SECTIONS.find((section) => section.id === id);
  }
}
