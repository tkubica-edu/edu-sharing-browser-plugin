import { Injectable, computed, effect, inject, signal } from '@angular/core';

import {
  AppSection, Conditions, SECTIONS, ScreenId, SectionId, SectionTab, sectionText
} from '../model/navigation';
import { BusyService } from './busy.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';

/** A section's sub step as the tab bar renders it: its definition plus whether it can be opened. */
export interface TabView extends SectionTab {
  disabled: boolean;
}

/**
 * A section as the menu renders it: its definition with everything that depends on the conditions
 * already resolved — its texts, whether it can be entered, and the reason that applies.
 */
export interface SectionView
  extends Omit<AppSection, 'label' | 'description' | 'disabledHint' | 'loading'> {
  label: string;
  description: string;
  disabled: boolean;
  disabledHint?: string;
  loading: boolean;
}

/** A visited step: a section plus the sub step that was open in it. */
export interface NavStep {
  section: SectionId;
  tab: ScreenId | null;
}

/** A step together with the steps behind it — a whole navigation state, as a resume carries it. */
export interface NavState extends NavStep {
  trail: readonly NavStep[];
}

/** How many steps back are kept. Deep enough for any flow, bounded so nothing accumulates. */
const TRAIL_LIMIT = 20;

// The single source of navigation truth: which section is open, which of its tabs is selected,
// guarded transitions, the current title, and the landing logic.
//
// Navigation is two levels deep and no deeper: a section, and one of its sub steps (tabs). The back
// button walks back through the sections the user came through (the {@link trail}) and arrives at
// the main menu at the end of it; switching sub steps within a section is not a step of its own —
// the tab bar is on screen, so going back there is a click, not a return.
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly conditions = inject(ConditionsService);
  // To release a picked content once the steps it was picked for are left — see back() and openMenu().
  private readonly curation = inject(CurationService);
  // A write in flight refuses every *user-driven* move; see BusyService and the guards below.
  private readonly busy = inject(BusyService);

  readonly section = signal<SectionId>('menu');

  /** The tab the user picked; `null` (and after a section change) means "the section's first". */
  private readonly requestedTab = signal<ScreenId | null>(null);

  /** The sections behind the open one, oldest first. Pushed by {@link go}, popped by {@link back}. */
  private readonly trail = signal<readonly NavStep[]>([]);

  /** The steps behind the open one, for carrying them across a page change (SessionResumeService). */
  readonly trailOf = this.trail.asReadonly();

  /** Back button is shown on every section except the menu. */
  readonly showBack = computed(() => this.section() !== 'menu');

  /** Where back goes, for the button's tooltip. */
  readonly backLabel = computed(() => {
    const previous = this.previousStep();
    const section = previous && this.sectionOf(previous.section);
    return section && previous.section !== 'menu'
      ? `Zurück zu „${section.title ?? sectionText(section.label, this.conditions.snapshot())}“`
      : 'Zurück zum Hauptmenü';
  });

  /** The sections listed in the main menu, in registry order, resolved for the current conditions. */
  readonly menuSections = computed<readonly SectionView[]>(() => {
    const conditions = this.conditions.snapshot();
    return SECTIONS.filter((section) => section.menu && section.visible(conditions)).map((section) =>
      this.viewOf(section, conditions),
    );
  });

  /** The utility sections, shown as topbar icons rather than as menu entries. */
  readonly topbarSections = computed<readonly SectionView[]>(() => {
    const conditions = this.conditions.snapshot();
    return SECTIONS.filter((section) => section.topbar && section.visible(conditions)).map(
      (section) => this.viewOf(section, conditions),
    );
  });

  /** The open section's definition; undefined on the menu. */
  readonly currentSection = computed<AppSection | undefined>(() => this.sectionOf(this.section()));

  /**
   * Whether the open section asks for a login the panel does not have: it needs a session of the
   * user's own and this one is a guest's (see AppSection.requiresSession).
   *
   * The section is entered all the same — what it shows then is the login instead of its screen
   * (LoginGateComponent), and its footer is the gate's own. So this is read by the shell, which
   * decides what to render, and by ActionBarService, whose actions belong to a screen that is not on
   * display.
   */
  readonly sessionGate = computed(
    () => !!this.currentSection()?.requiresSession && !this.conditions.hasSession(),
  );

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
    if (!section) return '';
    return section.title ?? sectionText(section.label, this.conditions.snapshot());
  });

  constructor() {
    // Guard: if the open section becomes invisible (logout, node cleared, page change) or disabled
    // (a content was detected for this page while "Inhalt erschließen" was open), don't strand the
    // user on a dead screen — re-land on a valid view.
    effect(() => {
      const id = this.section();
      if (id === 'menu') return;
      const conditions = this.conditions.snapshot();
      const section = this.sectionOf(id);
      if (!section?.visible(conditions) || !this.isEnabled(section, conditions)) this.land();
    });
  }

  /**
   * Whether a section applies right now. For the screens that offer a *choice of sections* (see
   * the add-content screen), so they never offer a target that {@link go} would refuse.
   */
  isVisible(id: SectionId, conditions = this.conditions.snapshot()): boolean {
    return this.sectionOf(id)?.visible(conditions) ?? false;
  }

  /**
   * Navigate to a section, if it can be entered right now; optionally straight to one of its tabs.
   *
   * A *disabled* section is refused as firmly as an invisible one — the menu renders it as a
   * disabled row, and every other caller (a footer action, a screen offering a choice of sections)
   * must not be able to route around that.
   *
   * So is every move while a write is in flight (see {@link BusyService}): the controls that lead
   * anywhere are disabled meanwhile, and this is the same answer for whatever reaches past them.
   */
  go(id: SectionId, options?: { tab?: ScreenId }): void {
    if (this.busy.busy()) return;
    const conditions = this.conditions.snapshot();
    const section = this.sectionOf(id);
    if (!section?.visible(conditions) || !this.isEnabled(section, conditions)) return;
    // The step being left becomes the one back returns to. Re-entering the section one is already
    // in is a tab change, not a step (see goTab).
    if (id !== this.section()) {
      this.trail.update((trail) =>
        [...trail, { section: this.section(), tab: this.screen() }].slice(-TRAIL_LIMIT),
      );
    }
    this.open(id, options?.tab ?? null);
  }

  /**
   * Back one step: to the section the user came from, with the sub step they had open there, and to
   * the main menu once the trail is used up.
   *
   * A step that no longer applies is skipped rather than opened (its content is gone, the page
   * changed) — the trail is where the user *was*, and only what still holds can be returned to. So
   * is a step that must not be re-entered at all (see AppSection.oneWay).
   */
  back(): void {
    if (this.busy.busy()) return;
    let trail = this.trail();
    while (trail.length) {
      const target = trail[trail.length - 1];
      trail = trail.slice(0, -1);
      if (target.section === 'menu') break;
      const section = this.sectionOf(target.section);
      if (!section || !this.canReturnTo(section)) continue;
      this.trail.set(trail);
      this.open(target.section, target.tab);
      this.releaseContentUnneededBy(section);
      return;
    }
    this.openMenu();
  }

  /** Select one of the open section's sub steps, if it can be opened right now. */
  goTab(id: ScreenId): void {
    if (this.busy.busy()) return;
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
   * The trail goes with it: the menu is the root, there is nothing behind it.
   */
  openMenu(): void {
    this.trail.set([]);
    this.open('menu', null);
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
    // A fresh start, so nothing is behind it — landing happens on boot, on a logout and whenever a
    // view falls away, and in none of those cases is the way the user came still theirs to walk back.
    this.trail.set([]);
    if (!this.conditions.snapshot().loggedIn) return this.open('login', null);
    this.openMenu();
  }

  /**
   * The state a {@link go} to `id` would leave behind, without performing it: the step plus the way
   * to it. Null when the section could not be entered at all, exactly as `go` refuses it.
   *
   * For a step that belongs on another page (see ContentFlowService): it is carried across in the
   * stored state instead of being opened here, so the panel about to be torn down stays on the screen
   * the user is looking at rather than rendering the next one for the instant before the load.
   */
  stateFor(id: SectionId, options?: { tab?: ScreenId }): NavState | null {
    const conditions = this.conditions.snapshot();
    const section = this.sectionOf(id);
    if (!section?.visible(conditions) || !this.isEnabled(section, conditions)) return null;
    const behind =
      id === this.section()
        ? this.trail()
        : [...this.trail(), { section: this.section(), tab: this.screen() }];
    return { section: id, tab: options?.tab ?? null, trail: behind.slice(-TRAIL_LIMIT) };
  }

  /**
   * Reopen a stored state (SessionResumeService): the step the user was on, with the steps behind it
   * as the trail. Answers whether anything was opened — nothing is, when none of it applies here.
   *
   * The stored step often cannot be re-entered on the new page: it needed a content that described
   * the page just left. Then the *deepest step behind it that still applies* is opened instead, so
   * the panel comes back as close to where the user was as this page allows — rather than dropping
   * them at the main menu with the way back thrown away.
   */
  resume(step: NavStep, trail: readonly NavStep[]): boolean {
    const steps = [...trail.slice(-TRAIL_LIMIT), step];
    for (let index = steps.length - 1; index >= 0; index--) {
      const candidate = steps[index];
      // The menu is the root: reaching it means nothing above it survived, which is a landing.
      if (candidate.section === 'menu') break;
      const section = this.sectionOf(candidate.section);
      if (!section || !this.canReturnTo(section)) continue;
      this.trail.set(steps.slice(0, index));
      this.open(candidate.section, candidate.tab);
      return true;
    }
    return false;
  }

  /**
   * The step back returns to; undefined once the trail is used up (then it is the main menu). The
   * same skipping as {@link back}, so the button's label names where it actually goes.
   */
  private previousStep(): NavStep | undefined {
    const trail = this.trail();
    for (let index = trail.length - 1; index >= 0; index--) {
      const step = trail[index];
      if (step.section === 'menu') return step;
      const section = this.sectionOf(step.section);
      if (section && this.canReturnTo(section)) return step;
    }
    return undefined;
  }

  /**
   * Whether a visited section can be re-opened: it still applies, and re-entering it is a return
   * rather than a restart (see AppSection.oneWay).
   */
  private canReturnTo(section: AppSection): boolean {
    const conditions = this.conditions.snapshot();
    return !section.oneWay && section.visible(conditions) && this.isEnabled(section, conditions);
  }

  /** Open a section without touching the trail — the one place section/tab are actually set. */
  private open(id: SectionId, tab: ScreenId | null): void {
    this.section.set(id);
    this.requestedTab.set(tab);
  }

  /**
   * Release a *picked* content when stepping back to a view that does not need one.
   *
   * The test is the target's own reachability: judged against a world with no content at all, a
   * section that is still reachable does not depend on one — so the content belongs to the steps
   * just left, not to the one returned to, and the user is back where they can pick again. A section
   * that needs a content (Inhaltsoptionen, the flow's steps) keeps it.
   *
   * Only a picked content is affected; a detected one describes the open page and stays either way
   * (see CurationService.releaseChosenContent).
   */
  private releaseContentUnneededBy(section: AppSection): void {
    const withoutContent: Conditions = {
      ...this.conditions.snapshot(),
      hasActiveNode: false,
      hasDetectedNode: false,
      hasEditableMetadata: false
    };
    if (section.visible(withoutContent) && this.isEnabled(section, withoutContent)) {
      this.curation.releaseChosenContent();
    }
  }

  /** A section resolved for one set of conditions — what the templates render directly. */
  private viewOf(section: AppSection, conditions: Conditions): SectionView {
    return {
      ...section,
      label: sectionText(section.label, conditions),
      description: sectionText(section.description, conditions),
      disabled: !this.isEnabled(section, conditions),
      disabledHint:
        typeof section.disabledHint === 'function'
          ? section.disabledHint(conditions)
          : section.disabledHint,
      loading: section.loading?.(conditions) ?? false
    };
  }

  private isEnabled(section: AppSection, conditions: Conditions): boolean {
    return section.enabled?.(conditions) ?? true;
  }

  private sectionOf(id: SectionId): AppSection | undefined {
    return SECTIONS.find((section) => section.id === id);
  }
}
