// The single, flow-agnostic list of options (menu items). Visibility is driven purely by
// the current conditions — no option is "owned" by a flow. The same registry feeds the
// options menu, the navigation guards, and the landing logic.

export type OptionId =
  | 'login'
  | 'erschliessen'
  | 'metadaten'
  | 'vorschau'
  | 'einsortieren'
  | 'suchen'
  | 'verlauf'
  | 'einstellungen';

// A snapshot of the world an option's visibility is decided against.
export interface Conditions {
  /** OnlyOffice (or another insert host) detected on the active page. */
  onlyOfficePresent: boolean;
  /** The active page is Edu-Sharing itself (host match or `/edu-sharing` path). */
  onEduSharing: boolean;
  /** A valid, non-guest repository login exists. */
  loggedIn: boolean;
  /** An active node exists — an erschlossener Inhalt OR a node received from OnlyOffice. */
  hasActiveNode: boolean;
  /** Editable metadata exists: an active node OR a fresh /generate result not yet saved.
   *  (The node is created on the first save, so Metadaten opens on a result too.) */
  hasEditableMetadata: boolean;
  /** The metadata editor is currently open. */
  editMode: boolean;
}

export interface AppOption {
  id: OptionId;
  label: string;
  description: string;
  /** Icon key resolved to an inline SVG in menu.component. */
  icon: string;
  visible: (c: Conditions) => boolean;
}

// All options except Login and Einstellungen require a valid login (requirement 2).
const requiresLogin =
  (extra: (c: Conditions) => boolean = () => true) =>
  (c: Conditions): boolean =>
    c.loggedIn && extra(c);

export const OPTIONS: AppOption[] = [
  {
    id: 'login',
    label: 'Login',
    description: 'Bei der Edu-Sharing-Instanz anmelden',
    icon: 'login',
    visible: (c) => !c.loggedIn
  },
  {
    id: 'erschliessen',
    label: 'Inhalt erschließen',
    description: 'Aus der aktuellen Webseite Metadaten erzeugen',
    icon: 'erschliessen',
    // Not on Edu-Sharing itself, and not on an insert host (there the intent is "suchen").
    visible: requiresLogin((c) => !c.onEduSharing && !c.onlyOfficePresent)
  },
  {
    id: 'metadaten',
    label: 'Metadaten editieren',
    description: 'Die Metadaten des Inhalts prüfen und bearbeiten',
    icon: 'metadaten',
    // Available for an active node OR a fresh /generate result (saved on first Speichern).
    visible: requiresLogin((c) => c.hasEditableMetadata)
  },
  {
    id: 'vorschau',
    label: 'Vorschau',
    description: 'Eine Vorschau des Inhalts inkl. der wichtigsten Metadaten anzeigen',
    icon: 'vorschau',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: 'einsortieren',
    label: 'Einsortieren in Sammlungen',
    description: 'Den Inhalt einer oder mehreren Sammlungen hinzufügen',
    icon: 'einsortieren',
    visible: requiresLogin((c) => c.hasActiveNode)
  },
  {
    id: 'suchen',
    label: 'Inhalt suchen',
    description: 'Inhalte suchen und in OnlyOffice einfügen',
    icon: 'suchen',
    visible: requiresLogin((c) => c.onlyOfficePresent)
  },
  {
    id: 'verlauf',
    label: 'Verlauf',
    description: 'Zuletzt erstellte oder bearbeitete Inhalte erneut öffnen',
    icon: 'verlauf',
    visible: requiresLogin()
  },
  {
    id: 'einstellungen',
    label: 'Einstellungen',
    description: 'Repository-Adresse und Verbindung konfigurieren',
    icon: 'einstellungen',
    visible: () => true
  }
];

export function optionById(id: OptionId): AppOption {
  return OPTIONS.find((o) => o.id === id)!;
}
