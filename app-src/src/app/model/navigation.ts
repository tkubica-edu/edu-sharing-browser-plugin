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
  | 'add-material'
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
  | 'add-material'
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
  /** Nothing has answered yet what this page's content is — the recognition is still running.
   *  Only once this is false does "no content" mean there is none (see PageRecognitionService). */
  recognizingContent: boolean;
}

/**
 * A text that may depend on the conditions — for an entry that *names its own state* instead of
 * only being disabled by it: "Inhalt erkannt" also has to say "Kein Inhalt erkannt" and "Inhalt
 * wird geprüft", because the row is the one place the finding is reported.
 */
export type SectionText = string | ((conditions: Conditions) => string);

/** Resolve a {@link SectionText} against the conditions that hold right now. */
export function sectionText(text: SectionText, conditions: Conditions): string {
  return typeof text === 'function' ? text(conditions) : text;
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
  label: SectionText;
  /** Heading shown while the section is open; defaults to {@link label} when unset. */
  title?: string;
  description: SectionText;
  visible: (conditions: Conditions) => boolean;
  /**
   * Whether the section can be entered right now; defaults to always. Like a tab's
   * {@link SectionTab.enabled}, a section that does not apply *at the moment* stays **visible and
   * disabled** rather than disappearing: the menu is the list of what the panel can do, and a row
   * that vanishes takes its explanation with it.
   */
  enabled?: (conditions: Conditions) => boolean;
  /**
   * Why the section cannot be entered, shown as its tooltip. A function when it is disabled for more
   * than one reason and the user is owed the one that applies.
   */
  disabledHint?: string | ((conditions: Conditions) => string);
  /** The section's sub steps, in tab order. Never empty. */
  tabs: readonly SectionTab[];
  /** Listed as an entry of the main menu. Without it the section is only reachable from the flow. */
  menu?: boolean;
  /**
   * Highlighted in the main menu — for the entry the current page makes the obvious next step. A
   * predicate when that only holds sometimes: an entry reporting that it found *nothing* is not a
   * next step, so it drops the highlight rather than shouting about an empty finding.
   */
  prominent?: boolean | ((conditions: Conditions) => boolean);
  /**
   * The section is waiting on something and the answer is what the entry reports (see the *Inhalt
   * erkannt* entry while the recognition runs). Rendered as a spinner on the menu row, which stays
   * disabled meanwhile — the row is already the place the answer will appear, so it says "still
   * checking" there instead of appearing out of nowhere once the answer is in.
   */
  loading?: (conditions: Conditions) => boolean;
  /**
   * Offered as an icon in the topbar instead of as a menu entry — for Einstellungen, which is not
   * an action on content but an always-available utility. It stays in this registry, so visibility,
   * guards and the section title work exactly like for a menu entry.
   */
  topbar?: boolean;
  /**
   * A section that must never be *returned* to: entering it starts something rather than showing
   * something, so re-entering it would start that again — for "Inhalt erstellen", whose screen opens
   * the OnlyOffice create-dialog the moment it mounts. Back (and a resume after a page change) walks
   * past such a step to the one behind it, so the user cannot be caught in the dialog they just left.
   * It is still entered normally; only the way back skips it.
   */
  oneWay?: boolean;
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
    // The row is the recognition's *report*, so it is listed in every one of its three outcomes and
    // names the one that holds: a content was found, none was, or the answer is still outstanding.
    // Reporting all three is what makes the finding trustworthy — an entry that is simply absent
    // leaves the user guessing whether the panel looked at this page at all.
    label: (c) =>
      c.hasActiveNode
        ? 'Inhalt erkannt'
        : c.recognizingContent
          ? 'Inhalt wird geprüft'
          : 'Kein Inhalt erkannt',
    // The menu row announces the *finding*; the screen it opens is the choice of what to do with
    // it — and that choice is also where the Verlauf and die eigenen Inhalte lead.
    title: 'Inhaltsoptionen',
    description: (c) =>
      c.hasActiveNode
        ? 'Der geöffnete Inhalt wurde erkannt — bearbeiten oder ansehen'
        : c.recognizingContent
          ? 'Es wird geprüft, ob das Repository diese Seite schon als Inhalt hat'
          : 'Das Repository hat zu dieser Seite keinen Inhalt',
    visible: requiresLogin(),
    menu: true,
    // Enterable for any active node: picking one from the Verlauf or den eigenen Inhalten leads
    // here too. Without one there is nothing to choose between, so the row stays visible and
    // disabled and says why — see AppSection.enabled.
    enabled: (c) => c.hasActiveNode,
    disabledHint: (c) =>
      c.recognizingContent
        ? 'Es wird noch geprüft, ob diese Seite bereits ein Inhalt im Repository ist.'
        : 'Zu dieser Seite wurde kein Inhalt erkannt — sie kann über „Inhalt erschließen“ erschlossen werden.',
    loading: (c) => !c.hasActiveNode && c.recognizingContent,
    // It leads the menu and is highlighted while there *is* a content: a recognised content is what
    // the user came for. With nothing found the row is a report, not an offer.
    prominent: (c) => c.hasActiveNode,
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
    // Two kinds of page have nothing to erschließen, and the entry stays listed on both to say which:
    //
    // - Edu-Sharing itself: its pages are the repository showing what it already holds, never a
    //   source to read metadata off. That holds for the whole of it, so the option is off there for
    //   good — not just where a node was recognised.
    // - any page whose content was already detected: the repository holds it (PageRecognitionService
    //   found it by URL) or the host has it open, and *that* content is what the panel offers to work
    //   on under "Inhalt erkannt". Curating again would produce a second node for the same page.
    enabled: (c) => !c.onEduSharing && !c.hasDetectedNode,
    disabledHint: (c) =>
      c.onEduSharing
        ? 'Edu-Sharing-Seiten werden nicht erschlossen — sie zeigen, was das Repository schon hat.'
        : 'Dieser Inhalt ist bereits erschlossen — er wird unter „Inhalt erkannt“ angeboten.',
    // Opening the screen starts the Erschließung (see CurationScreenComponent), so stepping back
    // into it would run it again and carry the user straight forward — see AppSection.oneWay.
    oneWay: true,
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
    // Mounting the screen opens the create-dialog, so coming back here would ask the user to create
    // yet another document instead of letting them out — see AppSection.oneWay.
    oneWay: true,
    tabs: [{ id: 'new-document', label: 'Erstellen' }]
  },
  {
    id: 'add-material',
    label: 'Datei oder Link',
    description: 'Eine Datei hochladen oder einen Link als Inhalt speichern',
    visible: requiresLogin(),
    tabs: [{ id: 'add-material', label: 'Hinzufügen' }]
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
    // Two ways to reach content for the document being edited, because they answer different
    // questions: the nodes selector lets the user go and find something themselves (Suche,
    // Sammlungen, Workspace), the extended search *suggests* what fits the document (keywords
    // derived from its text). Both hand the chosen node to the host page, so either can be used at
    // any point. Searching comes first — it is the one that works without reading the document,
    // and it is what the user is here for; the suggestions are the offer on top.
    tabs: [
      { id: 'search', label: 'Inhalt auswählen' },
      { id: 'find-content', label: 'Passende Inhalte' }
    ]
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
    description: 'Vorschau, Nutzung und Teilen des Inhalts',
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
