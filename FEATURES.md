# Features — what the panel offers, option by option

Every entry of the main menu is an **option** (`app-src/src/app/model/options.ts`). An option is
offered whenever its preconditions hold; nothing opens itself from a page match. How that registry,
its guards and the surrounding chrome work is [UI-SHELL.md](UI-SHELL.md); this file is the catalogue
of what the options *do*.

- [Reading and curating a page](#reading-and-curating-a-page)
- [Working on a node](#working-on-a-node)
- [Filing and handing on](#filing-and-handing-on)
- [OnlyOffice-only options](#onlyoffice-only-options)
- [Utilities](#utilities)
- [Two flows end to end](#two-flows-end-to-end)

---

## Reading and curating a page

- **Login** — the shared `es-login` gate; shown while logged out and reused inline by the
  screens that need a session.
- **Inhalt erschließen** — reads the active tab, calls `POST {apiUrl}/generate` through the
  background worker and advances to the metadata screen. It stays listed but is **disabled** on two
  kinds of page, saying which in its tooltip: **on Edu-Sharing itself**, whose pages show what the
  repository already holds and are never a source to read metadata off — so there for good, not only
  where a node was recognised; and **while a content was detected for the page** (see *Inhalt
  erkannt*), since curating it again would produce a second node for the same page.
- **Inhalt erkannt** — a node that turned up on its own, offered as the prominent menu entry.
  Two ways it does: the OnlyOffice plugin announcing the document it has open (`DOCUMENT_INFO`),
  and — on every other page — `getWebsiteInformation` (`ClientutilsV1Service`, the lookup the
  repository's own *Datei oder Link* dialog uses), whose `duplicateNodes` say the URL is already
  in the repository. The first of them becomes the active node (`PageRecognitionService` →
  `CurationService.adoptDetectedNode`). Nothing navigates for the user — the finding surfaces as
  a menu entry, never as a jump.
- **Metadaten editieren** — loads the metadata into `edu-sharing-mds-editor-wrapper`. Saving
  creates a `ccm:io` node in the **inbox** the first time (`NodeService.createChild`) and
  updates it in place thereafter (`editNodeMetadata`), then advances to the preview. Available
  for an active node or a fresh result that was never saved. Extracted fields and the raw JSON
  stay in collapsibles.

Which editor renders that screen, and which route the save takes, is
[WEB-COMPONENTS.md](WEB-COMPONENTS.md) and [ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content).

---

## Working on a node

- **Vorschau** — the node's name and link plus a live `edu-sharing-preview-sidebar`. Its `node`
  input takes the full hydrated node, so the node is (re)loaded after a save. Above both sits the
  share offer (`ShareTeaserComponent`): `edu-sharing-share-qr` in its `compact` variant — the code as
  a thumbnail beside the link and its copy control.
- **Inhalt teilen** — the same element in its `full` variant: the code above the link field, which
  carries the copy button. The code can be laid enlarged over the panel (a second element with
  `show-link="false"`), since the card's size is scanned from arm's length.

  Both hand the address in as `link` instead of letting the element resolve one from `node-id`:
  resolving loads the node, and a content written by the metadata agent is one the panel session may
  not read (403) — the card then stayed empty although the address had been known since the save. The
  flow holds it as `ActiveNode.link`, so nothing is requested at all. `mode` stays at `permalink` for
  the same reason it always did: a share link would set an unlimited expiry as a side effect, which
  sharing a view of the content must not do.
- **Aufrufe & Nutzung** — the node's usage statistics, rendered by `edu-sharing-usages` (views,
  downloads, plays, and the embeddings/collections the node is used in). Its `nodes` input is a
  *selection*, so the hydrated node goes in as a single-element array; the element fetches the
  numbers itself through the repository session. Shown for an active node, like the preview.
- **Neues OnlyOffice-Dokument** — mounts `edu-sharing-add-with-connector`, which opens the
  OnlyOffice create dialog; the new node is hydrated into the flow and opens in the preview.

A node double-clicked in the OnlyOffice plugin arrives as a `PREVIEW_NODE` message (relayed by
`content/panel-host.js`, or replayed from storage if the sidebar was closed) and opens in the
preview; while logged out it is held until the login succeeds. The message contract is
[content/CLAUDE.md](content/CLAUDE.md).

---

## Filing and handing on

**An Redaktionen weiterleiten** / **Persönliche Ablage** are where the content is filed and handed
on: the flow runs *Inhalt erschließen* → Vorschau → **An Redaktionen weiterleiten** →
**Persönliche Ablage** → *Prüfprozess auswählen* → *Qualitätsprüfung* → *Inhaltsübersicht*. Two steps
of their own, each offered only where it applies: the forwarding while the repository config enables
the browser extension custom web component, the *Persönliche Ablage* for a session of the user's
own. That step offers both of the user's own filing places: the folder, through the repository's
own Ablageort control (`edu-sharing-location-picker`, wrapped as `es-storage-location-picker`,
seeded with the user's `defaultInboxFolder` setting and otherwise with `-inbox-`), and — optionally
— a collection, through the same `es-collection-selector` the forwarding uses. The collection has
no confirmation of its own; the footer's *Weiter* takes the ticked one over as it leads on. Where
neither applies they fall away and the preview leads straight into the choice of process.

**The content is written early and edited from there on** (`CurationService.save`): the *Vorschau*
step creates the node with the picture and the title it confirmed and nothing else, and every step
behind it adds what *it* decided — the collections it picked, the criteria it recorded with the
quality workflow, and finally the whole of the generated metadata with the extended fields and the
handover for review. So each step's *Weiter* is a write (*Speichern…* on the button), it leads on
only once that write held, and a step that decided nothing is passed without a request
(`CurationService.saveCollected`). The footer's *Weiter* walks from each step to the next one that
applies.

### An Redaktionen weiterleiten

Lists the editorial groups the repository config names in **`browserExtensionEditorialGroups`**
(`['ID1', 'ID2']`, read once per session by `EditorialGroupsService` →
`CollectionService.getCollection`). Ticking a group forwards the content to it; where the group's
collection has child collections (`NodeService.getChildren`, folders only) one of them can be picked
instead — the group's row leads into the **Sammlung auswählen** step for that, and the content then
goes into the picked collection *only*. A group without children says „Keine Sammlungsauswahl
erforderlich".

The choice is held by the flow (`CurationService.editorialTargets`) and carried out by the write the
step's *Weiter* makes, together with the collections the *Persönliche Ablage* picked
(`CurationService.filedCollections`, each collection once however many steps reached it):
`CollectionServiceUnwrapped.addToCollection` per collection, and along the agent route the IDs
travel in `/nodes`' `collection_id` instead. Only collections the content is not in yet, so a later
write does not file it twice.

A collection the topic assistant proposed for the content is taken over here as well — the group it
sits in is ticked and the collection is picked inside it, until the user picks another
(`EditorialGroupsService.recommendCollection`, `CollectionRecommendationService`).

### Sammlung auswählen

A step of its own, entered from a group's row and returning to it. It names the group it belongs to
(`EditorialGroupsService.picking`) and what is recorded for it so far, and shows the collection
picker (`es-collection-selector`, `edu-sharing-nodes-selector` in `collections` mode) underneath.
The picker gets that one group's collection as `collectionTree` — the group's collection node
followed by the ones inside it, which is what keeps the choice inside the group it is recorded for.
Tree *data*, not a list of ids: the element hands the value straight to its tree data source, which
builds the hierarchy from each node's `parent.id`, and shows it in place of the roots it would build
itself. Its own apply bar is hidden and the confirmation sits in the panel's action bar as
**Sammlung übernehmen**: the screen registers an `ApplyHandler` with `ActionBarService`, and the
footer reads and clicks the element's button through it (the element offers no API for confirming
from outside).

### Prüfprozess auswählen

The junction between the filing and the checking, entered from whichever filing step was the last to
apply. Two cards, each with the button that starts its process: *Geführte Qualitätsprüfung*, which
is the *Qualitätsprüfung* as it stands (criteria, then metadata), and *Individuelle
Qualitätsprüfung mit KI*, the analysis against the chosen collection's requirements as a dialogue with
the assistant (see [chatbot.md](chatbot.md)). Clicking a card marks it and the footer's *Weiter* starts
the marked one, so the two ways on say the same thing (`FlowChoiceScreenComponent`, which registers the
choice as the footer's `ApplyHandler`).

Starting the KI check **ends whatever chat conversation is stored**, so it opens on an empty dialogue
instead of on the previous one; walking back out of it asks before that dialogue is lost.

---

## OnlyOffice-only options

Both need the page-side edu-sharing plugin; the round trips they use are specified in
[content/CLAUDE.md](content/CLAUDE.md). Without an OnlyOffice page they can still be exercised —
see [TESTING.md § Debug mode](TESTING.md#debug-mode-onlyoffice-without-onlyoffice).

- **Metadaten anreichern** — the same erschließen flow, but the content comes from the **edited
  document** instead of the page. The sidebar asks the page-side plugin for the document content
  (`REQUEST_DOCUMENT_CONTENT` → `DOCUMENT_CONTENT`, correlated by `requestId` and bounded by a
  timeout), sends the answer's `markdown` through the background worker to `POST {apiUrl}/generate`
  and opens the result in the metadata editor. The answer's `document` makes the edited document the
  **active node**, so **Speichern** writes the enriched metadata onto that node (`editNodeMetadata`)
  rather than creating a new one in the inbox — the node's name is kept, so the document is never
  renamed.
- **Passende Inhalte finden** — searches the repository for content matching the **edited
  document**. The query is not typed but derived: the same `REQUEST_DOCUMENT_CONTENT` →
  `DOCUMENT_CONTENT` round trip as *Metadaten anreichern*, then `POST {apiUrl}/extract-field` on the
  answer's `markdown` — the single-field endpoint, asked for `field_id: cclom:general_keyword` out of
  the agent's `core.json`, because a full `/generate` would extract a whole metadata set of which
  only the keywords are used here.

  The generated `cclom:general_keyword` values (deduplicated, capped) become the `initial-values` of
  **`edu-sharing-search`** — the embedded search that adds the metadata filters of the search page to
  a node list. `initial-values` is a map of MDS widget id → values (here
  `{"cclom:general_keyword": [...]}`), i.e. the keywords are used as a **filter**, not as the
  `search-string`: `search-string` goes in as an extra `ngsearchword` criterion that is **AND**-ed
  with the filters, so it only narrows further, while as filter values the keywords are matched
  against the indexed keywords of the nodes. Re-setting them (*Neu aus Dokument*) makes the element
  rebuild its filter editor, whose init re-runs the query.

  Only the **first two** keywords are queried: all values of one widget land in a single criterion
  whose join narrows the result set, so the full agent-generated list matches nothing while the two
  most relevant ones still find content. Agent-invented keywords are often carried by no node at all,
  so the screen watches the element's `totalResults`: an empty result widens the search once (a
  single keyword), and if that is empty too, a notice offers *Ohne Schlagworte suchen* — the filter
  is dropped entirely, which shows the repository's content (the user's call, since it is
  everything). The chips show all derived keywords, struck through where they are not part of the
  current query. Results are sorted by relevance (`sort-properties="score"`, descending); vocabulary
  widgets would need valuespace keys instead of labels, `cclom:general_keyword` is free text so the
  values go in verbatim.

  That run is deliberately *not* kept as the app's last analysis (`ContentSuggestionsService`, not
  `MetadataAgentService.lastRun`), so it neither shows up in the metadata editor nor counts as
  unsaved work. Opening the option starts the derivation; *Neu aus Dokument* repeats it after edits.
  A double-clicked result (`nodeActivated`) is posted to the host page for insertion, like the
  selector on *Inhalt suchen*.
- **Inhalt suchen** — only on an insert host (URL matches `/src/tools/onlyoffice`): the same
  selector in search mode, posting the chosen nodes to the host page.

On an OnlyOffice page **the edited document is the active node from the start**: the sidebar asks the
page-side plugin once on boot for its identity (`REQUEST_DOCUMENT_INFO` → `DOCUMENT_INFO`), loads
that node and adopts it (`CurationService.adoptDetectedNode`). So *Vorschau*, *Metadaten editieren*
and *Einsortieren in Sammlungen* are available immediately, without an erschließen run. It is best
effort and silent: the plugin is optional and may never answer, and when the panel was opened logged
out the node is adopted once the user logs in. No *Verlauf* entry is written — the user did not pick
this node. An explicitly loaded node (`PREVIEW_NODE`, a history entry) always wins over it.

---

## Utilities

Not actions on content, so they render as **icons in the topbar** next to the close button
(`topbar: true`, `NavigationService.topbarOptions`) — otherwise ordinary options, with the same
visibility, guards and view title.

- **Verlauf** *(with the entry count as a badge)* — the **saved nodes**, newest first. An entry is
  recorded only when a node is actually saved, so every row carries a `nodeId` (legacy pre-node
  entries are dropped on load, and re-saving a node moves its row to the top instead of
  duplicating). *In Vorschau öffnen* fetches the live node by id (`CurationService.openFromHistory` →
  `RepositoryNodeService.get`) and opens it; if there is unsaved work the shell confirms first, and a
  failed fetch is surfaced via an alert.
- **Einstellungen** *(dotted while a change waits to be applied)* — the Repository-URL (used for
  login and every embedded element), the debug mode and the recommendation settings.
- **WLO Metadaten-Agent** — only when the repository config enables it, see
  [WEB-COMPONENTS.md](WEB-COMPONENTS.md#the-optional-wlo-metadata-editor).
- **Boerdi — KI-Assistent** — the assistant's chat widget, offered as a row above the session bar
  and embedded as the real `<boerdi-chat>` element the packaged `boerdi/` bundle defines. On the
  same condition as the WLO canvas (`browserExtensionCustomWebComponent`), since it comes with that
  bundle. The panel is not the page, so the widget's own context detection is off and the open tab's
  page is handed over explicitly — including to a chat session that outlived a page change
  (`AiAssistantScreenComponent`).

---

## Two flows end to end

**Curating an open page.** *Inhalt erschließen* → the metadata screen with the generated fields →
*Speichern* creates the node in the inbox → *Vorschau* → the filing steps that apply → *Prüfprozess
auswählen* → *Qualitätsprüfung* → *Inhaltsübersicht*.

**Enriching an open OnlyOffice document.** The document is already the active node (`DOCUMENT_INFO`
on boot) → *Metadaten anreichern* reads it through the plugin → the metadata screen → *Speichern*
updates **that** node, never creating a second one → the same filing and checking steps.

**Picking a content takes the tab with it**: a node chosen in *Meine Inhalte* or im *Verlauf* opens
its own page in the repository (`…/components/render/<id>`) and the panel comes back there on
*Inhaltsoptionen*, working on that same node (`ContentFlowService.showContentOptions`). See
[UI-SHELL.md § Page changes the panel asks for itself](UI-SHELL.md#page-changes-the-panel-asks-for-itself).
