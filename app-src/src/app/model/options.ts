// The single, flow-agnostic list of options (menu items). Visibility is driven purely by
// the current conditions — no option is "owned" by a flow. The same registry feeds the
// options menu, the navigation guards, and the landing logic.

/** Every option id. */
export type OptionId =
  | 'login'
  | 'analyze'
  | 'new-document'
  | 'metadata'
  | 'preview'
  | 'collections'
  | 'search'
  | 'history'
  | 'settings';

/** A snapshot of the world an option's visibility is decided against. */
export interface Conditions {
  /** OnlyOffice (or another insert host) detected on the active page. */
  onlyOfficePresent: boolean;
  /** The active page is Edu-Sharing itself (host match or `/edu-sharing` path). */
  onEduSharing: boolean;
  /** A valid, non-guest repository login exists. */
  loggedIn: boolean;
  /** An active node exists — a curated content OR a node received from OnlyOffice. */
  hasActiveNode: boolean;
  /** Editable metadata exists: an active node OR a fresh /generate result not yet saved.
   *  (The node is created on the first save, so the metadata option opens on a result too.) */
  hasEditableMetadata: boolean;
  /** The metadata editor is currently open. */
  editMode: boolean;
}

export interface AppOption {
  id: OptionId;
  label: string;
  description: string;
  visible: (conditions: Conditions) => boolean;
}

/** All options except login and settings require a valid login. */
const requiresLogin =
  (extra: (conditions: Conditions) => boolean = () => true) =>
  (conditions: Conditions): boolean =>
    conditions.loggedIn && extra(conditions);

/** Every option, in menu order. */
export const OPTIONS: readonly AppOption[] = [
  {
    id: 'login',
    label: 'Login',
    description: 'Bei der Edu-Sharing-Instanz anmelden',
    visible: (c) => !c.loggedIn
  },
  {
    id: 'analyze',
    label: 'Inhalt erschließen',
    description: 'Aus der aktuellen Webseite Metadaten erzeugen',
    // Not on Edu-Sharing itself, and not on an insert host (there the intent is searching).
    visible: requiresLogin((c) => !c.onEduSharing && !c.onlyOfficePresent)
  },
  {
    id: 'new-document',
    label: 'Neues OnlyOffice-Dokument',
    description: 'Ein neues OnlyOffice-Dokument im Repository anlegen',
    visible: requiresLogin()
  },
  {
    id: 'metadata',
    label: 'Metadaten editieren',
    description: 'Die Metadaten des Inhalts prüfen und bearbeiten',
    // Available for an active node OR a fresh /generate result (saved on first save).
    visible: requiresLogin((c) => c.hasEditableMetadata)
  },
  {
    id: 'preview',
    label: 'Vorschau',
    description: 'Eine Vorschau des Inhalts inkl. der wichtigsten Metadaten anzeigen',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: 'collections',
    label: 'Einsortieren in Sammlungen',
    description: 'Den Inhalt einer oder mehreren Sammlungen hinzufügen',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: 'search',
    label: 'Inhalt suchen',
    description: 'Inhalte suchen und in OnlyOffice einfügen',
    visible: requiresLogin((c) => c.onlyOfficePresent)
  },
  {
    id: 'history',
    label: 'Verlauf',
    description: 'Zuletzt erstellte oder bearbeitete Inhalte erneut öffnen',
    visible: requiresLogin()
  },
  {
    id: 'settings',
    label: 'Einstellungen',
    description: 'Repository-Adresse und Verbindung konfigurieren',
    visible: () => true
  }
];
