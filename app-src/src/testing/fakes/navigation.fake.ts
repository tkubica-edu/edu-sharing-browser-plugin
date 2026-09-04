import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ScreenId, SectionId } from '../../app/model/navigation';
import {
  NavState, NavStep, NavigationService, SectionView, TabView,
} from '../../app/services/navigation.service';

/**
 * A section as the menu renders one. The registry's own entry carries the predicates; what a reader
 * of the menu sees is this — already decided against the conditions, so a spec states the outcome.
 */
export function aSectionView(id: SectionId, overrides: Partial<SectionView> = {}): SectionView {
  return {
    id,
    label: id,
    description: '',
    disabled: false,
    loading: false,
    tabs: [],
    visible: () => true,
    ...overrides,
  } as SectionView;
}

/** A sub step as the tab bar would render it: open unless the caller says otherwise. */
export function aTab(id: ScreenId, overrides: Partial<TabView> = {}): TabView {
  return { id, label: id, disabled: false, ...overrides };
}

/**
 * `NavigationService` reduced to where the panel stands and the moves its dependents make. The real one
 * derives all of that from the registry and the conditions; a spec of a *dependent* wants to state the step
 * it is on directly, which is what the writable signals here are for.
 *
 * `nextTab` is a signal of its own rather than derived from `tabs` and `screen`: deriving it would restate
 * the production rule in the fake, and then a spec asserting on a footer's „Weiter" would be asserting on
 * this file. `isVisible` answers for the sections handed to {@link offer} — the fake's stand-in for the
 * conditions, since that is the only question a dependent asks about a section it is not on.
 */
export function fakeNavigation() {
  const offered = new Set<SectionId>();

  /** Sub steps the registry does not offer at all, and ones it offers but holds shut. */
  const hiddenTabs = new Set<string>();
  const lockedTabs = new Set<string>();

  /** The steps behind the open one, as a resume carries them over. */
  const trail = signal<readonly NavStep[]>([]);

  /** Whether a resumed state applied on the page it was carried to — see {@link resumesNothing}. */
  let resumes = true;

  /** What a remembered step resolves to, or null where it can no longer be opened. */
  let resumable: NavState | null = null;

  const fake = {
    section: signal<SectionId>('menu'),
    menuSections: signal<readonly SectionView[]>([]),
    screen: signal<ScreenId | null>(null),
    overlaySection: signal<SectionId | null>(null),
    sessionGate: signal(false),
    tabs: signal<readonly TabView[]>([]),
    nextTab: signal<TabView | null>(null),
    isVisible: vi.fn((id: SectionId, _conditions?: unknown): boolean => offered.has(id)),
    // A sub step's own statement, asked of the registry by whatever offers a way into it. Both answer
    // for the tabs handed to {@link offerTab} and {@link lockTab}; a tab nothing was said about is
    // there and reachable, which is the ordinary case.
    isTabVisible: vi.fn(
      (id: SectionId, tab: ScreenId, _conditions?: unknown): boolean => !hiddenTabs.has(`${id}/${tab}`),
    ),
    isTabDisabled: vi.fn(
      (id: SectionId, tab: ScreenId, _conditions?: unknown): boolean => lockedTabs.has(`${id}/${tab}`),
    ),
    go: vi.fn((_id: SectionId, _options?: { tab?: ScreenId }): void => undefined),
    back: vi.fn(),
    toggle: vi.fn(),
    goTab: vi.fn((_id: ScreenId): void => undefined),
    goNextTab: vi.fn(),
    openMenu: vi.fn(),
    trailOf: trail,
    resumableStep: vi.fn((_step: NavStep | null | undefined): NavState | null => resumable),
    stepLabel: vi.fn((step: NavStep | null | undefined): string => step?.section ?? ''),
    resume: vi.fn((_step: NavStep, _behind: readonly NavStep[]): boolean => resumes),
  } satisfies Partial<NavigationService>;

  /** Put the panel on a step: the section, and the sub step showing in it. */
  function at(section: SectionId, screen: ScreenId | null = null): void {
    fake.section.set(section);
    fake.screen.set(screen);
  }

  /** Which sections apply right now — what {@link NavigationService.isVisible} is asked about. */
  function offer(...ids: readonly SectionId[]): void {
    ids.forEach((id) => offered.add(id));
  }

  /** This sub step does not exist for the current conditions — see `NavigationService.isTabVisible`. */
  function hideTab(section: SectionId, tab: ScreenId): void {
    hiddenTabs.add(`${section}/${tab}`);
  }

  /** It exists but cannot be entered yet, which is what an earlier step unlocks. */
  function lockTab(section: SectionId, tab: ScreenId): void {
    lockedTabs.add(`${section}/${tab}`);
  }

  /** The steps the user came through to get here. */
  function came(...steps: readonly NavStep[]): void {
    trail.set(steps);
  }

  /** The menu offers these entries — already decided against the conditions. */
  function lists(...sections: readonly SectionView[]): void {
    fake.menuSections.set(sections);
  }

  /** A remembered step that can still be opened, so an offer to continue leads there. */
  function resumesAt(section: SectionId, tab: ScreenId | null = null): void {
    resumable = { section, tab } as NavState;
  }

  /** Nothing of a resumed state applies on this page, so the caller lands instead. */
  function resumesNothing(): void {
    resumes = false;
  }

  return { fake, at, offer, hideTab, lockTab, came, lists, resumesAt, resumesNothing };
}

export type NavigationFake = ReturnType<typeof fakeNavigation>;
