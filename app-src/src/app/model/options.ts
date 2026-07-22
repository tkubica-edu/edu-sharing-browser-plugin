// The single, flow-agnostic list of options (menu items). Visibility is driven purely by
// the current conditions — no option is "owned" by a flow. The same registry feeds the
// options menu, the navigation guards, and the landing logic.
//
// Options are extensible at runtime: externally loaded code (see
// AdditionalWebComponentService) can ADD new options or REPLACE built-in ones by id via
// OptionsRegistryService. Ids are therefore plain strings; the built-in ids are exposed
// as constants (BUILTIN_OPTION_IDS) so the shell and landing logic can reference them.

export type OptionId = string;

// The stable ids of the built-in options. Contributed options reuse one of these to
// REPLACE it, or introduce a fresh id to ADD a new option.
export const BUILTIN_OPTION_IDS = {
  login: 'login',
  erschliessen: 'erschliessen',
  metadaten: 'metadaten',
  vorschau: 'vorschau',
  einsortieren: 'einsortieren',
  suchen: 'suchen',
  verlauf: 'verlauf',
  einstellungen: 'einstellungen'
} as const;

// A snapshot of the world an option's visibility is decided against.
export interface Conditions {
  /** OnlyOffice (or another insert host) detected on the active page. */
  onlyOfficePresent: boolean;
  /** The active page is Edu-Sharing itself (host match or `/edu-sharing` path). */
  onEduSharing: boolean;
  /** A valid, non-guest repository login exists. */
  loggedIn: boolean;
  /** No valid non-guest login — the inverse of `loggedIn`, exposed so a guest-visible
   *  (bypassLogin) option can reason about auth without being gated by it. */
  guest: boolean;
  /** An active node exists — an erschlossener Inhalt OR a node received from OnlyOffice. */
  hasActiveNode: boolean;
  /** Editable metadata exists: an active node OR a fresh /generate result not yet saved.
   *  (The node is created on the first save, so Metadaten opens on a result too.) */
  hasEditableMetadata: boolean;
  /** The metadata editor is currently open. */
  editMode: boolean;
}

// How an option's icon is resolved. A bare string is treated as a built-in ICONS key
// (back-compat). Contributed options may supply an inline SVG or an image URL.
export type OptionIcon =
  | { kind: 'builtin'; key: string }
  | { kind: 'svg'; svg: string }
  | { kind: 'url'; url: string };

// How an option's screen is rendered.
// - 'component' (or absent): a built-in Angular screen wired in the app shell's ngSwitch.
// - 'element': a custom element mounted inline in the sidebar DOM (needs the defining
//   script loaded; only viable when CSP/distribution allows remote script — see loader).
// - 'iframe': a remote page embedded in a sandboxed iframe (store-safe default).
export type OptionView =
  | { kind: 'component' }
  | { kind: 'element'; tag: string; props?: Record<string, unknown> }
  | { kind: 'iframe'; url: string; params?: Record<string, string>; passContext?: boolean };

export interface AppOption {
  id: OptionId;
  label: string;
  description: string;
  /** Icon key (built-in) or a full OptionIcon descriptor for contributed options. */
  icon: string | OptionIcon;
  visible: (c: Conditions) => boolean;
  /** When true, `visible` is used verbatim (NOT wrapped with a login requirement) and the
   *  option may show while logged out. Set by contributed, guest-capable options. */
  bypassLogin?: boolean;
  /** Custom view for a contributed option. Absent ⇒ built-in component (ngSwitch case). */
  view?: OptionView;
  /** True for options contributed by externally loaded code (vs. the built-in seed). */
  external?: boolean;
}

// All built-in options except Login and Einstellungen require a valid login (requirement 2).
// Exported so the registry can apply the same default to contributed options that opt in.
export const requiresLogin =
  (extra: (c: Conditions) => boolean = () => true) =>
  (c: Conditions): boolean =>
    c.loggedIn && extra(c);

// The built-in seed. OptionsRegistryService merges contributed options on top of this.
export const OPTIONS: AppOption[] = [
  {
    id: BUILTIN_OPTION_IDS.login,
    label: 'Login',
    description: 'Bei der Edu-Sharing-Instanz anmelden',
    icon: 'login',
    visible: (c) => !c.loggedIn
  },
  {
    id: BUILTIN_OPTION_IDS.erschliessen,
    label: 'Inhalt erschließen',
    description: 'Aus der aktuellen Webseite Metadaten erzeugen',
    icon: 'erschliessen',
    // Not on Edu-Sharing itself, and not on an insert host (there the intent is "suchen").
    visible: requiresLogin((c) => !c.onEduSharing && !c.onlyOfficePresent)
  },
  {
    id: BUILTIN_OPTION_IDS.metadaten,
    label: 'Metadaten editieren',
    description: 'Die Metadaten des Inhalts prüfen und bearbeiten',
    icon: 'metadaten',
    // Available for an active node OR a fresh /generate result (saved on first Speichern).
    visible: requiresLogin((c) => c.hasEditableMetadata)
  },
  {
    id: BUILTIN_OPTION_IDS.vorschau,
    label: 'Vorschau',
    description: 'Eine Vorschau des Inhalts inkl. der wichtigsten Metadaten anzeigen',
    icon: 'vorschau',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: BUILTIN_OPTION_IDS.einsortieren,
    label: 'Einsortieren in Sammlungen',
    description: 'Den Inhalt einer oder mehreren Sammlungen hinzufügen',
    icon: 'einsortieren',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: BUILTIN_OPTION_IDS.suchen,
    label: 'Inhalt suchen',
    description: 'Inhalte suchen und in OnlyOffice einfügen',
    icon: 'suchen',
    visible: requiresLogin((c) => c.onlyOfficePresent)
  },
  {
    id: BUILTIN_OPTION_IDS.verlauf,
    label: 'Verlauf',
    description: 'Zuletzt erstellte oder bearbeitete Inhalte erneut öffnen',
    icon: 'verlauf',
    visible: requiresLogin()
  },
  {
    id: BUILTIN_OPTION_IDS.einstellungen,
    label: 'Einstellungen',
    description: 'Repository-Adresse und Verbindung konfigurieren',
    icon: 'einstellungen',
    visible: () => true
  }
];
