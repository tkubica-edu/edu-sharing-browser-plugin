// Typings for the "Aktionen & Optionen" extension point. Everything extension-related
// lives under `app/extension/` so the whole feature can be removed by deleting this
// folder and reverting the handful of thin hooks in the core (see README.md).

import { TemplateRef } from '@angular/core';

import { AppOption, Conditions, OptionId } from '../model/options';

/**
 * Where a custom rendering is used:
 *  - `menuItem` — the compact row in the "Aktionen & Optionen" list,
 *  - `screen`   — the full view shown when the option is selected.
 */
export type OptionSlot = 'menuItem' | 'screen';

/**
 * A menu option contributed by an extension.
 *
 * The `id` is the unique key. If it matches a built-in {@link OptionId}, that built-in
 * option is **replaced**; otherwise the option is **added** to the menu. All display
 * fields are optional — they are only used by the default rendering; a fully custom
 * `menuItem` rendering does not need them.
 */
export interface ExtensionOption {
  id: OptionId;
  label?: string;
  description?: string;
  /** Icon key (see menu.component's built-in set) OR a raw inline `<svg…>` string. */
  icon?: string;
  /** Visibility predicate against the current conditions (defaults to always visible). */
  visible?: (conditions: Conditions) => boolean;
}

/** Context handed to a custom template / set as the `data` property on a custom element. */
export interface CustomRenderingContext {
  option: AppOption;
  conditions: Conditions;
  slot: OptionSlot;
}

/**
 * A custom rendering for a given option + slot. Mirrors the field-rendering pattern:
 * an optional predicate decides whether it applies, then either an Angular template
 * (`templateRef`) OR a custom-element tag (`element`) is used — the template wins if both
 * are given.
 */
export interface CustomOptionRendering {
  /** The option id this applies to — an existing {@link OptionId} or a custom one. */
  optionId: OptionId;
  slot: OptionSlot;
  /** Return true if this rendering should be used for the current conditions. */
  useCallback?: (conditions: Conditions) => boolean;
  /** An Angular template to render, receiving a {@link CustomRenderingContext}. */
  templateRef?: TemplateRef<CustomRenderingContext>;
  /** A custom-element tag name (registered by a loaded web-component bundle). */
  element?: string;
}

/**
 * The registration API exposed on `window.eduSharingExtension` once an additional
 * web-component bundle is configured. The loaded bundle calls these to contribute
 * options and renderings and to relax the login requirement.
 */
export interface EduSharingExtensionApi {
  registerOption(option: ExtensionOption): void;
  registerRendering(rendering: CustomOptionRendering): void;
  setLoginRequired(required: boolean): void;
}

declare global {
  interface Window {
    eduSharingExtension?: EduSharingExtensionApi;
  }
}
