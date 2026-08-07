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
  | 'curation-preview'
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
  | 'curation-preview'
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
  /** A session of the user's own. Narrower than {@link loggedIn}: ask this about *signing in*. */
  hasSession: boolean;
  /** An active node exists — a curated content OR a node received from OnlyOffice. */
  hasActiveNode: boolean;
  /** The active node arrived on its own (a DOCUMENT_INFO / PREVIEW_NODE), rather than being picked. */
  hasDetectedNode: boolean;
  /** Editable metadata exists: an active node OR a fresh /generate result not yet saved.
   *  (The node is created on the first save, so the metadata tab opens on a result too.) */
  hasEditableMetadata: boolean;
  /** A fresh /generate result that has not been written to a node yet — a content still being
   *  curated. Narrower than {@link hasEditableMetadata}, which a saved node satisfies too. */
  hasCuratedDraft: boolean;
  /** The metadata editor is currently open. */
  editMode: boolean;
  /** The recognition has not answered yet what this page's content is (PageRecognitionService).
   *  Only once this is false does "no content" mean there is none. */
  recognizingContent: boolean;
}

/** A text that may depend on the conditions — for an entry that names its own state. */
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
   * Why the section cannot be entered. Written out in place of the description while it is disabled
   * — a tooltip would never be seen, as a disabled control takes no pointer events. A function when
   * it is disabled for more than one reason and the user is owed the one that applies.
   */
  disabledHint?: string | ((conditions: Conditions) => string);
  /** The section's sub steps, in tab order. Never empty. */
  tabs: readonly SectionTab[];
  /** Listed as an entry of the main menu. Without it the section is only reachable from the flow. */
  menu?: boolean;
  /**
   * The screen is a plain list of rows or entries — no form, no embedded editor or selector, no
   * footer action. Its bottom edge is free, which is where the session bar shows (UserBarComponent).
   */
  plain?: boolean;
  /**
   * The menu's centre, rendered as a card of its own instead of as one of the rows (MenuComponent).
   * Independent of the conditions, so the entry keeps its shape in every state it reports.
   */
  focal?: boolean;
  /**
   * The section is waiting on an answer that its own entry will report. The menu shows a spinner and
   * the entry stays disabled meanwhile.
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
    // On the session, not on `loggedIn`: a guest may sign in although nothing demands it. Reached
    // from the user bar; the landing logic uses `loggedIn`, so a guest is never sent here.
    visible: (c) => !c.hasSession,
    tabs: [{ id: 'login', label: 'Anmelden' }]
  },

  // ---- Main menu ----------------------------------------------------------
  {
    id: 'content-options',
    // The entry is the recognition's report, so it stays listed in all three outcomes and names the
    // one that holds: a content was found, none was, or the answer is still outstanding.
    label: (c) =>
      c.hasActiveNode
        ? 'Inhalt erkannt'
        : c.recognizingContent
          ? 'Geöffneter Inhalt wird erkannt …'
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
    // Any active node, so picking one from the Verlauf or den eigenen Inhalten leads here too.
    // Without one there is nothing to choose between — see AppSection.enabled.
    enabled: (c) => c.hasActiveNode,
    disabledHint: (c) =>
      c.recognizingContent
        ? 'Die aktuelle Seite wird mit „edu-sharing“ abgeglichen.'
        : 'Zu dieser Seite wurde kein Inhalt erkannt — sie kann über „Inhalt erschließen“ erschlossen werden.',
    loading: (c) => !c.hasActiveNode && c.recognizingContent,
    // Its screen offers the same kind of rows as the menu — a choice of what to do with the content.
    plain: true,
    // The panel exists for the content of the open page; everything below is what else can be done.
    focal: true,
    tabs: [{ id: 'content-options', label: 'Inhaltsoptionen' }]
  },
  {
    id: 'add-content',
    label: 'Inhalt hinzufügen',
    description: 'Inhalt erstellen oder hochladen',
    visible: requiresLogin(),
    menu: true,
    // Two rows to pick from — the ways of adding something. The forms are behind them.
    plain: true,
    tabs: [{ id: 'add-content', label: 'Hinzufügen' }]
  },
  {
    id: 'curation',
    label: 'Inhalt erschließen',
    description: 'Aktuelle Seite als Inhalt erfassen',
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
    label: 'Meine Inhalte',
    description: 'Eigene Inhalte und Status aufrufen',
    visible: requiresLogin(),
    menu: true,
    tabs: [{ id: 'own-content', label: 'Auswählen' }]
  },
  {
    id: 'history',
    label: 'Verlauf',
    description: 'Letzte Aktivitäten anzeigen',
    visible: requiresLogin(),
    menu: true,
    // The saved contents, as a list to look through.
    plain: true,
    tabs: [{ id: 'history', label: 'Verlauf' }]
  },

  // ---- Reached from a menu section ---------------------------------------
  {
    id: 'curation-preview',
    label: 'Vorschau und Titel',
    description: 'Vorschaubild und Titel des erschlossenen Inhalts prüfen',
    // The second step of "Inhalt erschließen", reached the moment its run succeeded: a curated
    // result that has no node yet is exactly the state this step is about (see
    // CurationPreviewScreenComponent). Once the content is saved it falls away — the picture and the
    // title are then the node's own, and the Qualitätssicherung is where they are edited.
    visible: requiresLogin((c) => c.hasCuratedDraft),
    tabs: [{ id: 'curation-preview', label: 'Vorschau' }]
  },
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
