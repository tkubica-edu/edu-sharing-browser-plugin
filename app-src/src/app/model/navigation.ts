// The navigation registry: sections, each with one or more tabs (sub steps). Visibility is driven purely
// by the current conditions, and the same registry feeds the main menu, the tab bar, the guards and the
// landing logic. The big steps of the content flow are not listed in the menu — they are entered from a
// node, see ContentFlowService.

/** A leaf screen: exactly one component is rendered for it. */
export type ScreenId =
  | 'login'
  | 'ai-assistant'
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
  | 'quality-check'
  | 'metadata'
  | 'editorial-forward'
  | 'personal-storage'
  | 'select-collection'
  | 'flow-choice'
  | 'ai-quality'
  | 'preview'
  | 'usages'
  | 'share'
  | 'interactions';

/** A navigable section: the main menu itself, a menu entry, or a step of the content flow. */
export type SectionId =
  | 'menu'
  | 'login'
  | 'ai-assistant'
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
  | 'editorial-forward'
  | 'personal-storage'
  | 'select-collection'
  | 'flow-choice'
  | 'ai-quality'
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
  /** A content this session read off a page: a metadata agent run that succeeded. It still holds once
   *  that content has been written to a node, which is what keeps the Erschließung's own steps
   *  returnable after the first save. */
  hasCuratedContent: boolean;
  /** The recognition has not answered yet what this page's content is (PageRecognitionService).
   *  Only once this is false does "no content" mean there is none. */
  recognizingContent: boolean;
  /** The repository config enabled the browser extension custom web component — see
   *  BrowserExtensionCustomWebComponentService. */
  browserExtensionCustomWebComponent: boolean;
  /** The Qualitätsprüfung's knock-out criteria are answered, so the quality may be confirmed
   *  (QualityCriteriaComponent reports it, CurationService holds it). */
  qualityCriteriaMet: boolean;
  /** The active content is past what this session may still write: it saves through the metadata
   *  agent, whose window for editing a node closes two hours after that node was created. A login
   *  lifts it, because a signed-in user writes the node themselves
   *  (CurationService.agentEditWindowClosed). */
  agentEditWindowClosed: boolean;
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
   * Whether the section can be entered right now; defaults to always. A section that does not apply at
   * the moment stays visible and disabled rather than disappearing: a row that vanishes takes its
   * explanation with it.
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
   * The section cannot be served by a guest session — because it acts as a person (writing into their
   * storage, listing what is theirs), or because it writes to a content that only a session of the
   * user's own may still write to. It stays enterable: what a guest gets there is the login
   * (LoginGateComponent) rather than a row that only says no. A function where it depends on the
   * state rather than on what the section is.
   */
  requiresSession?: boolean | ((conditions: Conditions) => boolean);
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
   * A section that must never be returned to, because entering it starts something rather than showing
   * something. Back and resume walk past it to the step behind; it is still entered normally.
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
  {
    id: 'ai-assistant',
    label: 'Boerdi - KI-Assistent',
    description: 'Eine Frage an den KI-Assistenten stellen',
    // The assistant belongs to the WLO bundle, on the same condition its canvas does: where the
    // browser extension custom web component is off there is no assistant to offer.
    //
    // Reached from the offer above the session bar rather than from the menu, the way "Anmelden" is
    // — both are about the panel itself rather than about the open content (AiAssistantBarComponent).
    visible: requiresLogin((c) => c.browserExtensionCustomWebComponent),
    // Nothing but text so far, so the bottom edge stays the session bar's — see AppSection.plain.
    plain: true,
    tabs: [{ id: 'ai-assistant', label: 'Frage stellen' }]
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
    // Both ways of adding something write into the user's own storage, which a guest session has
    // none of — see AppSection.requiresSession.
    requiresSession: true,
    // Two rows to pick from — the ways of adding something. The forms are behind them.
    plain: true,
    tabs: [{ id: 'add-content', label: 'Hinzufügen' }]
  },
  {
    id: 'curation',
    label: 'Inhalt erschließen',
    description: 'Aktuelle Seite als Inhalt erfassen',
    visible: requiresLogin(),
    // Nothing to erschließen on two kinds of page, and the entry stays listed to say which: edu-sharing's
    // own pages show what the repository already holds, and a page whose content was already detected is
    // offered under "Inhalt erkannt" — curating it again would produce a second node for it. Not while the
    // recognition runs either: that is what answers whether this page is the second kind.
    enabled: (c) => !c.onEduSharing && !c.hasDetectedNode && !c.recognizingContent,
    disabledHint: (c) =>
      c.onEduSharing
        ? 'Edu-Sharing-Seiten werden nicht erschlossen — sie zeigen, was das Repository schon hat.'
        : c.recognizingContent
          ? 'Es wird noch geprüft, ob das Repository diese Seite schon als Inhalt hat.'
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
    // "Eigene" is what a guest session has nothing of: it belongs to no person, so there is no such
    // list to show — see AppSection.requiresSession.
    requiresSession: true,
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
    // Named after the step it belongs to, not after what it shows: the Erschließung runs and then
    // asks for the picture and the title, and the user never left "Inhalt erschließen" for that.
    label: 'Inhalt erschließen',
    description: 'Vorschaubild und Titel des erschlossenen Inhalts prüfen',
    // The second step of "Inhalt erschließen", and the one that writes the content: confirming picture and
    // title creates the node. The condition is the curated content rather than the unsaved draft, so the
    // step stays returnable once that node exists and then works on it.
    visible: requiresLogin((c) => c.hasCuratedContent),
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
    // Two ways to reach content for the document being edited: the nodes selector to go and find something,
    // the extended search to be offered what fits the document's text. Searching comes first — it works
    // without reading the document.
    tabs: [
      { id: 'search', label: 'Inhalt auswählen' },
      { id: 'find-content', label: 'Passende Inhalte' }
    ]
  },
  {
    id: 'editorial-forward',
    label: 'An Redaktionen weiterleiten',
    description: 'Den Inhalt an eine oder mehrere Redaktionen weiterleiten',
    // Editable metadata, not a node: where the content goes is decided before it is written. The forwarding
    // exists for the browser extension custom web component — the groups are the editorial teams a
    // submitted content is judged by, so without it the step falls away.
    visible: requiresLogin((c) => c.hasEditableMetadata && c.browserExtensionCustomWebComponent),
    // The way on out of the step writes what it picked, which a guest session may no longer do for a
    // content past its editing window — see AppSection.requiresSession.
    requiresSession: (c) => c.agentEditWindowClosed,
    tabs: [{ id: 'editorial-forward', label: 'An Redaktionen weiterleiten' }]
  },
  {
    id: 'select-collection',
    label: 'Sammlung auswählen',
    description: 'Die Sammlung wählen, in die der Inhalt bei dieser Redaktion einsortiert wird',
    // A step of the forwarding rather than one of the flow: it is entered from a group's row and
    // returns to it, so it applies exactly where the forwarding does.
    visible: requiresLogin((c) => c.hasEditableMetadata && c.browserExtensionCustomWebComponent),
    // As for the forwarding it is a step of: what is picked here is written with it.
    requiresSession: (c) => c.agentEditWindowClosed,
    tabs: [{ id: 'select-collection', label: 'Sammlung auswählen' }]
  },
  {
    id: 'personal-storage',
    label: 'Persönliche Ablage',
    description: 'Den Inhalt in der eigenen Ablage einsortieren',
    // A session of the user's own, not `loggedIn`: a private filing place is one a *person* has —
    // the guest session the browser extension custom web component brings has none. Like the
    // forwarding it works on editable metadata rather than on a node; see there.
    visible: requiresLogin((c) => c.hasEditableMetadata && c.hasSession),
    tabs: [{ id: 'personal-storage', label: 'Persönliche Ablage' }]
  },
  {
    id: 'flow-choice',
    label: 'Prüfprozess auswählen',
    description: 'Wählen, wie der Inhalt geprüft wird',
    // The junction the filing steps lead into: where the content goes is settled, and what is left to
    // decide is how it is checked (see FlowChoiceScreenComponent). It applies wherever the steps around
    // it do — for a content there is something to check about, saved or not — and only where there are
    // two processes to choose between: both belong to the browser extension custom web component, so
    // without it the one way on is the Metadaten view and the filing leads straight there.
    visible: requiresLogin((c) => c.hasEditableMetadata && c.browserExtensionCustomWebComponent),
    tabs: [{ id: 'flow-choice', label: 'Prüfprozess' }]
  },
  {
    id: 'ai-quality',
    label: 'Individuelle Qualitätsprüfung mit KI',
    description: 'Den Inhalt von der KI gegen die Anforderungen der Sammlung prüfen lassen',
    // One of the two processes the choice above leads into; the other is the Qualitätsprüfung below,
    // which is the guided walk through criteria and metadata. This one is a dialogue with the
    // assistant about the content and the collection it was filed in — see AiQualityScreenComponent.
    // The assistant belongs to the browser extension custom web component, as does the criteria view
    // it judges against, so without it there is no such dialogue to hold.
    visible: requiresLogin((c) => c.hasEditableMetadata && c.browserExtensionCustomWebComponent),
    tabs: [{ id: 'ai-quality', label: 'KI-Analyse' }]
  },
  {
    id: 'quality',
    label: 'Qualitätsprüfung',
    description: 'Qualität prüfen und Metadaten bearbeiten',
    // An active node OR a fresh /generate result (the node is created by this step's own save).
    visible: requiresLogin((c) => c.hasEditableMetadata),
    // Both views write: the Qualität view confirms the quality onto the content, the Metadaten view
    // describes it. For a content past its editing window a guest session gets neither through, so
    // the login stands in front of them — see AppSection.requiresSession.
    requiresSession: (c) => c.agentEditWindowClosed,
    // Two views of the same content in the order they are worked through, walked between by the footer, so
    // the two are one step. The last step before the Inhaltsübersicht and therefore the one that writes the
    // content. The quality view belongs to the browser extension custom web component, like the forwarding
    // does; without it the step is the Metadaten view alone, which is why the section needs no condition.
    tabs: [
      { id: 'quality-check', label: 'Qualität', visible: (c) => c.browserExtensionCustomWebComponent },
      {
        id: 'metadata',
        label: 'Metadaten',
        // Behind the Qualität view's own gate, and only where that view exists: the criteria decide
        // whether the content may be published at all, so they are answered before it is described.
        // Visible and disabled meanwhile — the tab is the step that is still to come, not one that
        // appears out of nowhere once the boxes are ticked (see SectionTab.enabled).
        enabled: (c) => !c.browserExtensionCustomWebComponent || c.qualityCriteriaMet,
        disabledHint: 'Zuerst die Kriterien für die Such-Veröffentlichung erfüllen.'
      }
    ]
  },
  {
    id: 'overview',
    label: 'Inhaltsübersicht',
    description: 'Vorschau, Nutzung, Teilen und Interaktionen des Inhalts',
    visible: requiresLogin((c) => c.hasActiveNode),
    tabs: [
      { id: 'preview', label: 'Vorschau' },
      { id: 'usages', label: 'Nutzung' },
      { id: 'share', label: 'Inhalt teilen' },
      {
        id: 'interactions',
        label: 'Interaktionen',
        // What the editorial teams answered to a forwarded content, so the view belongs to the
        // browser extension custom web component exactly as the forwarding itself does: without it
        // no content is proposed to a Redaktion and there is no exchange to show.
        visible: (c) => c.browserExtensionCustomWebComponent
      }
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
