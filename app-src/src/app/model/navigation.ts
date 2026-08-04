// The navigation registry: the flow is a list of *sections*, each with one or more *tabs* (sub
// steps). Visibility is driven purely by the current conditions — no section is "owned" by a
// flow. The same registry feeds the main menu, the tab bar, the navigation guards and the
// landing logic.
//
// Three of the sections are the big steps of the content flow — Bearbeitungsmodus →
// Qualitätssicherung → Inhaltsübersicht. They are not listed in the main menu: they are entered
// from a node (created, selected or detected), see ContentFlowService.

/** A leaf screen: exactly one component is rendered for it. */
export type ScreenId =
  | 'login'
  | 'settings'
  | 'add-content'
  | 'new-document'
  | 'search'
  | 'curation'
  | 'own-content'
  | 'history'
  | 'content-options'
  | 'find-content'
  | 'metadata'
  | 'collections'
  | 'preview'
  | 'usages'
  | 'share';

/** A navigable section: the main menu itself, a menu entry, or a step of the content flow. */
export type SectionId =
  | 'menu'
  | 'login'
  | 'settings'
  | 'add-content'
  | 'new-document'
  | 'search'
  | 'curation'
  | 'own-content'
  | 'history'
  | 'content-options'
  | 'editing'
  | 'quality'
  | 'overview';

/** A snapshot of the world a section's (or tab's) visibility is decided against. */
export interface Conditions {
  /** OnlyOffice (or another insert host) detected on the active page. */
  onlyOfficePresent: boolean;
  /** The active page is Edu-Sharing itself (host match or `/edu-sharing` path). */
  onEduSharing: boolean;
  /** A valid, non-guest repository login exists — or none is required (see AuthService.authorized). */
  loggedIn: boolean;
  /** An active node exists — a curated content OR a node received from OnlyOffice. */
  hasActiveNode: boolean;
  /** The active node arrived on its own (a DOCUMENT_INFO / PREVIEW_NODE), rather than being picked. */
  hasDetectedNode: boolean;
  /** Editable metadata exists: an active node OR a fresh /generate result not yet saved.
   *  (The node is created on the first save, so the metadata tab opens on a result too.) */
  hasEditableMetadata: boolean;
  /** The metadata editor is currently open. */
  editMode: boolean;
}

/** One sub step of a section, offered as a tab. */
export interface SectionTab {
  id: ScreenId;
  label: string;
  /** Defaults to always visible; a section renders a tab bar only for 2+ visible tabs. */
  visible?: (conditions: Conditions) => boolean;
  /**
   * Whether the tab can be opened right now; defaults to always. A sub step that a *later* state
   * unlocks stays **visible and disabled** rather than appearing out of nowhere — the section's
   * steps are then the same set throughout, so reaching one never re-frames the section.
   */
  enabled?: (conditions: Conditions) => boolean;
  /** Why the tab is disabled, shown as its tooltip. */
  disabledHint?: string;
}

export interface AppSection {
  id: SectionId;
  /** How the section is named where it is *entered* — the main-menu row, the topbar icon. */
  label: string;
  /** Heading shown while the section is open; defaults to {@link label} when unset. */
  title?: string;
  description: string;
  visible: (conditions: Conditions) => boolean;
  /** The section's sub steps, in tab order. Never empty. */
  tabs: readonly SectionTab[];
  /** Listed as an entry of the main menu. Without it the section is only reachable from the flow. */
  menu?: boolean;
  /**
   * Extra condition for *listing* the section in the main menu, on top of {@link visible}, which
   * governs reachability. For a section that stays open-able from within the flow while only being
   * *offered* in the menu under narrower circumstances.
   */
  listed?: (conditions: Conditions) => boolean;
  /** Highlighted in the main menu — for the entry the current page makes the obvious next step. */
  prominent?: boolean;
  /**
   * Offered as an icon in the topbar instead of as a menu entry — for Einstellungen, which is not
   * an action on content but an always-available utility. It stays in this registry, so visibility,
   * guards and the section title work exactly like for a menu entry.
   */
  topbar?: boolean;
}

/** Everything except login and settings requires a valid login. */
const requiresLogin =
  (extra: (conditions: Conditions) => boolean = () => true) =>
  (conditions: Conditions): boolean =>
    conditions.loggedIn && extra(conditions);

/** Every section, in main-menu order (the flow steps and the utilities last). */
export const SECTIONS: readonly AppSection[] = [
  {
    id: 'login',
    label: 'Login',
    description: 'Bei der Edu-Sharing-Instanz anmelden',
    visible: (c) => !c.loggedIn,
    tabs: [{ id: 'login', label: 'Anmelden' }]
  },

  // ---- Main menu ----------------------------------------------------------
  {
    id: 'content-options',
    label: 'Inhalt erkannt',
    // The menu row announces the *finding*; the screen it opens is the choice of what to do with
    // it — and that choice is also where the Verlauf and die eigenen Inhalte lead.
    title: 'Inhaltsoptionen',
    description: 'Der geöffnete Inhalt wurde erkannt — bearbeiten oder ansehen',
    // Reachable for any active node: picking one from the Verlauf or den eigenen Inhalten leads
    // here too.
    visible: requiresLogin((c) => c.hasActiveNode),
    menu: true,
    // …but *offered* in the menu only for a node that was detected on its own (a DOCUMENT_INFO from
    // the OnlyOffice plugin, a PREVIEW_NODE). Only then is it a finding about the open page rather
    // than something the user navigated to — and a picked node is released again when the user
    // returns to the menu (see CurationService.releaseChosenContent). Further ways of detecting a
    // content are to follow, and each one widens exactly this condition.
    listed: (c) => c.hasDetectedNode,
    // It leads the menu and is highlighted: a recognised content is what the user came for.
    prominent: true,
    tabs: [{ id: 'content-options', label: 'Inhaltsoptionen' }]
  },
  {
    id: 'add-content',
    label: 'Inhalt hinzufügen',
    description: 'Einen neuen Inhalt erstellen oder einen vorhandenen einfügen',
    visible: requiresLogin(),
    menu: true,
    tabs: [{ id: 'add-content', label: 'Hinzufügen' }]
  },
  {
    id: 'curation',
    label: 'Inhalt erschließen',
    description: 'Aus der aktuellen Webseite Metadaten erzeugen',
    visible: requiresLogin(),
    menu: true,
    tabs: [{ id: 'curation', label: 'Erschließen' }]
  },
  {
    id: 'own-content',
    label: 'Eigene Inhalte',
    description: 'Einen eigenen Inhalt im Repository auswählen',
    visible: requiresLogin(),
    menu: true,
    tabs: [{ id: 'own-content', label: 'Auswählen' }]
  },
  {
    id: 'history',
    label: 'Verlauf',
    description: 'Zuletzt erstellte oder bearbeitete Inhalte erneut öffnen',
    visible: requiresLogin(),
    menu: true,
    tabs: [{ id: 'history', label: 'Verlauf' }]
  },

  // ---- Reached from a menu section ---------------------------------------
  {
    id: 'new-document',
    label: 'Inhalt erstellen',
    description: 'Ein neues OnlyOffice-Dokument im Repository anlegen',
    visible: requiresLogin(),
    tabs: [{ id: 'new-document', label: 'Erstellen' }]
  },
  {
    id: 'search',
    label: 'Inhalt suchen',
    description: 'Inhalte suchen und in das geöffnete Dokument einfügen',
    visible: requiresLogin((c) => c.onlyOfficePresent),
    tabs: [{ id: 'search', label: 'Suchen' }]
  },

  // ---- The big steps of the content flow ---------------------------------
  {
    id: 'editing',
    label: 'Bearbeitungsmodus',
    description: 'Der Inhalt ist im Connector geöffnet und wird dort bearbeitet',
    visible: requiresLogin((c) => c.hasActiveNode),
    tabs: [{ id: 'find-content', label: 'Passende Inhalte' }]
  },
  {
    id: 'quality',
    label: 'Qualitätssicherung',
    description: 'Metadaten prüfen und den Inhalt einsortieren',
    // An active node OR a fresh /generate result (the node is created on the first save).
    visible: requiresLogin((c) => c.hasEditableMetadata),
    tabs: [
      { id: 'metadata', label: 'Metadaten bearbeiten' },
      // Assigning needs a node, which a freshly curated content only gets on its first save. The
      // tab is shown from the start anyway — disabled it says "save first", whereas appearing only
      // after the save would make the editor look like a different screen before and after saving.
      {
        id: 'collections',
        label: 'Inhalte zuordnen',
        enabled: (c) => c.hasActiveNode,
        disabledHint: 'Erst die Metadaten speichern — danach kann der Inhalt zugeordnet werden.'
      }
    ]
  },
  {
    id: 'overview',
    label: 'Inhaltsübersicht',
    description: 'Vorschau, Aufrufe und Nutzung des Inhalts',
    visible: requiresLogin((c) => c.hasActiveNode),
    tabs: [
      { id: 'preview', label: 'Vorschau' },
      { id: 'usages', label: 'Nutzung' },
      { id: 'share', label: 'Inhalt teilen' }
    ]
  },

  // ---- Utilities ----------------------------------------------------------
  {
    id: 'settings',
    label: 'Einstellungen',
    description: 'Repository-Adresse und Verbindung konfigurieren',
    visible: () => true,
    topbar: true,
    tabs: [{ id: 'settings', label: 'Einstellungen' }]
  }
];
