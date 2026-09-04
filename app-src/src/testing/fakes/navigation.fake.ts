import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ScreenId, SectionId } from '../../app/model/navigation';
import { NavStep, NavigationService, TabView } from '../../app/services/navigation.service';

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

  /** The steps behind the open one, as a resume carries them over. */
  const trail = signal<readonly NavStep[]>([]);

  /** Whether a resumed state applied on the page it was carried to — see {@link resumesNothing}. */
  let resumes = true;

  const fake = {
    section: signal<SectionId>('menu'),
    screen: signal<ScreenId | null>(null),
    overlaySection: signal<SectionId | null>(null),
    sessionGate: signal(false),
    tabs: signal<readonly TabView[]>([]),
    nextTab: signal<TabView | null>(null),
    isVisible: vi.fn((id: SectionId): boolean => offered.has(id)),
    go: vi.fn((_id: SectionId, _options?: { tab?: ScreenId }): void => undefined),
    back: vi.fn(),
    toggle: vi.fn(),
    goTab: vi.fn((_id: ScreenId): void => undefined),
    goNextTab: vi.fn(),
    openMenu: vi.fn(),
    trailOf: trail,
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

  /** The steps the user came through to get here. */
  function came(...steps: readonly NavStep[]): void {
    trail.set(steps);
  }

  /** Nothing of a resumed state applies on this page, so the caller lands instead. */
  function resumesNothing(): void {
    resumes = false;
  }

  return { fake, at, offer, came, resumesNothing };
}

export type NavigationFake = ReturnType<typeof fakeNavigation>;
