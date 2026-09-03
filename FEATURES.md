# Features — what the panel offers, option by option

Every entry of the main menu is an **option** (`app-src/src/app/model/options.ts`). An option is
offered whenever its preconditions hold; nothing opens itself from a page match. How that registry,
its guards and the surrounding chrome work is [UI-SHELL.md](UI-SHELL.md); this file is the catalogue
of what the options *do*.

- [Reading and curating a page](#reading-and-curating-a-page)
  - [Metadata without a model](#metadata-without-a-model)
- [Working on a node](#working-on-a-node)
- [Filing and handing on](#filing-and-handing-on)
- [OnlyOffice-only options](#onlyoffice-only-options)
- [Utilities](#utilities)
- [Two flows end to end](#two-flows-end-to-end)

---

## Reading and curating a page

- **Login** — the shared `es-login` gate; shown while logged out and reused inline by the
  screens that need a session.
- **Inhalt erschließen** — reads the active tab and advances to the metadata screen. What it does
  with the page depends on the WLO functions (*Einstellungen → WLO-Funktionen verwenden*, and the
  repository's `browserExtensionCustomWebComponent`): **with them on** it calls
  `POST {apiUrl}/generate` through the background worker. **With them off no `/generate` is called at
  all** — the worker's `page.read` reads the page and `PageDerivationService` describes the content
  from what the page says about itself (`MetadataAgentService.readPage`); see
  [§ Metadata without a model](#metadata-without-a-model). It stays listed but is **disabled** on two
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
- **Metadaten editieren** — has the repository generate what the content does not say about itself
  yet, then loads the metadata into `edu-sharing-mds-editor-wrapper`. The generation is the MDS
  editor's own „Vorschläge erzeugen", asked for by the panel through the b-API client
  (`ngx-edu-sharing-b-api`, `EduSharingLlmService.suggestions`) with inputs of its own — the
  content's title and the text of its page — and its findings are read back as KI-Vorschläge, see
  [SUGGESTION-API.md](SUGGESTION-API.md). Saving
  creates a `ccm:io` node in the **inbox** the first time (`NodeService.createChild`) and
  updates it in place thereafter (`editNodeMetadata`), then advances to the preview. Available
  for an active node or a fresh result that was never saved. Extracted fields and the raw JSON
  stay in collapsibles.

Which editor renders that screen, and which route the save takes, is
[WEB-COMPONENTS.md](WEB-COMPONENTS.md) and [ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content).

### Metadata without a model

Where the WLO functions are off, no model describes the content: neither `/generate` nor the
repository's own generation is available, and the form would otherwise open with a title and nothing
else. `PageDerivationService` fills it from the page's own declarations instead — the meta tags, Open
Graph, Dublin Core, LRMI, the `ld+json` blocks, the licence link, the page's tags and breadcrumbs,
all of which `content/content.js` already reads and `PageData` carries.

The split between a statement and a derivation is what the whole path turns on, and it decides how a
field appears (`util/derived-metadata.ts`). What the page **declares** enters the form as a **value**,
because it is as much a fact as the page's title: the description out of `meta[description]`/Open
Graph/Dublin Core/`ld+json`, the keywords out of `meta[keywords]`/`rel=tag`/`DC.subject`, the language
out of `html lang`, the author, the publisher, the publication date, an identifier, and the licence —
the last only from a `link[rel=license]` or `meta[DC.rights]` naming a Creative Commons address, which
`util/page-license.ts` maps back to `ccm:commonlicense_key` plus its version (the mirror of
`licenseUri` in `util/amb-event.ts`). What is **derived** from the page enters as a **pending
proposal** the widgets offer for acceptance: keywords counted out of its text
(`util/text-keywords.ts`, ranked by `KeywordRankingService`), a description taken from its first
paragraph, the learning time out of an ISO-8601 duration. A licence found only in the running text is
reported as found and **never written** — a wrongly recorded licence is the most damaging thing this
path could do.

A property is one or the other, never both: a widget offers a suggestion only while its own value is
empty, and `MdsEditorComponent` withholds every proposed property from the node to make that so — so
where the page states something, the derivations for that property are dropped and the report says
which. The marking rides on `_origins`, whose third value `'page'` distinguishes a page-derived
proposal from a model's `'ai'` (`fieldOrigins` in `util/curation-node.ts`). Only `'ai'` is written to
the repository's suggestion store, so this path asks the store for nothing; the form's offer is built
in memory by `aiSuggestionsFor`, over the wider reading `proposedFieldsOf`.

Two things beyond the page are used. `getWebsiteInformation` is the lookup *Inhalt erkannt* makes
anyway, and four of its six fields were being discarded: `WebsiteInformationService` holds the answer
per address so both callers share the one request, and its description and keywords fill what the page
left empty. Because the repository fetches the address from its own side — no session, no cookies, no
JavaScript — an answer from behind a login or a cookie wall describes that wall; `describesSamePage`
(`util/website-information.ts`) requires a shared content word with the page's title, or three with
its text, before anything from it is used. And the page's own words for the vocabulary-bound fields
travel along under the envelope key `_page_terms` until a metadata set can resolve them: in the
metadata step `MdsValuespaceService` matches them against the `values` of the widgets the rendered
group actually places, by id, by `alternativeIds`, by folded caption or by the last segment of the
value URI, and **never** by prefix or similarity — „Deutsch" must not resolve to „Deutsch als
Zweitsprache" (`util/vocabulary-match.ts`). A term that names no value of the widget yields nothing,
since a value outside a widget's valuespace shows as a blank in the editor and is found by no search.

The form's offer is merged per property rather than per source, so each source fills only what the
ones before it left empty: what the repository stores for the node, then what a generation run
reported, then the run's own findings, and last the values matched from the page's words. That
ordering is also what confines this path to the case it is for — where a model answered, its proposals
stand.

What lands on the node is bounded by the rendered form, which for the core set's `io` group is
`ccm:wwwurl`, `cm:name`, `cclom:title`, `cclom:general_description`, `cclom:general_keyword`,
`ccm:educationallearningresourcetype` and the native `author`/`license` widgets. A derived field no
widget carries — the language, the date, the identifier, the publisher, the learning time — stays in
the payload, visible in the metadata screen's collapsibles and carried into `ccm:oeh_extendedData`
where the WLO functions write it, but no save puts it on the node by itself.

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
- **Interaktionen** — what became of the content at the editorial teams it was proposed to: one card
  per forwarding (`CurationService.contentForwardings`, so the team plus the collection picked inside
  it; the *Persönliche Ablage*'s own collections are no part of it), with the exchange under it as a
  timeline. The forwardings a save carried out are kept in the *Verlauf* entry, so a content taken up
  again names its teams too instead of reading as one that was never forwarded — the picks of the
  forwarding step and the recorded ones are shown as one list, each team once. The cards need the browser
  extension custom web component, since without it no content is proposed to a Redaktion. Where the
  content was published to a nostr relay as well, the receipt of that publication stands under the
  cards as itself: not an exchange but what went out and how to fetch it back, see
  [An Nostr Relay weiterleiten](#an-nostr-relay-weiterleiten). Under its own heading beside the teams'
  stands **Nostr-Anbindung**: `es-nostr-standing`, which answers for every content whether it is
  published — by this installation or by another — refused, in flight, being looked up, unknown, merely
  ticked or untouched, and names the relay and the `npub` behind that answer in each case — so the view has something to say even where nothing was ever forwarded.
  That half needs the relay to be switched on (*Einstellungen → Nostr-Relay verwenden*), and the view
  itself is offered while either half applies: with no teams and no relay there is nothing left to
  report and the tab falls away. Only reported there; the step that acts on it is
  [An Nostr Relay senden](#an-nostr-relay-senden). Marked
  **Entwurf** wherever the teams apply: the repository hands out no communication history yet, so the
  cards name the real forwardings while the steps under them are an example ending in „Noch keine
  Entscheidung erhalten". The teams' logos come from the groups the forwarding step loaded
  (`EditorialGroupsService`), and the submission date is the node's creation — the forwarding is
  carried out by the very save that creates it.
- **Neues OnlyOffice-Dokument** — mounts `edu-sharing-add-with-connector`, which opens the
  OnlyOffice create dialog; the new node is hydrated into the flow and opens in the preview.

A node double-clicked in the OnlyOffice plugin arrives as a `PREVIEW_NODE` message (relayed by
`content/panel-host.js`, or replayed from storage if the sidebar was closed) and opens in the
preview; while logged out it is held until the login succeeds. The message contract is
[content/HOST-EVENTS.md](content/HOST-EVENTS.md).

---

## Filing and handing on

**An Redaktionen weiterleiten** / **Persönliche Ablage** are where the content is filed and handed
on, and **An Nostr Relay senden** is the one of these steps the flow never walks through — it is
entered from the *Inhaltsoptionen* for a content that is past the forwarding: the flow runs *Inhalt erschließen* → Vorschau → **An Redaktionen weiterleiten** →
**Persönliche Ablage** → *Prüfprozess auswählen* → *Qualitätsprüfung* → *Inhaltsübersicht*. Two steps
of their own, each offered only where it applies: the forwarding wherever a content can be forwarded
at all — it holds two kinds of target and only the editorial teams belong to the browser extension
custom web component, so without that flag it shows the nostr relay alone — and the *Persönliche
Ablage* for a session of the user's own. That step offers both of the user's own filing places: the folder, through the repository's
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

The step holds two kinds of target and shows each where it applies: the editorial teams below, which
are the browser extension custom web component's, and the
[nostr relay](#an-nostr-relay-weiterleiten) under them, which is every repository's. In the base
version the teams' half is not rendered at all — neither the list nor the requests behind it — and
the step is the relay row plus its receipt. With the relay switched off as well
(*Einstellungen → Nostr-Relay verwenden*) the step has no target left and is not offered at all.

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

### An Nostr Relay weiterleiten

One more row under the editorial groups, and one more target of the same step: ticking it publishes
the content's metadata to a **nostr relay** as an AMB record — the *Allgemeines Metadatenprofil für
Bildungsressourcen* (<https://w3id.org/kim/amb/latest/>), which the edufeed network carries as nostr
events of **kind 30142**. Unlike a forwarding to a Redaktion this is a publication into an open
network: the row says so before it is acted on, and the footer's way on is labelled *An Relay senden*
rather than *Weiter* while it would publish. It is offered in the base version too — publishing an AMB
record needs nothing of the repository beyond the metadata — and is what keeps *An Redaktionen
weiterleiten* a step of the flow there.

The whole connection is a setting: **Nostr-Relay verwenden** in *Einstellungen*
(`eduSharingNostrEnabled`, on by default, `NostrForwardService.enabled`). Switched off, the panel has
nothing to do with the network at all — this row is not rendered, *An Nostr Relay senden* is not
offered in the *Inhaltsoptionen*, the *Nostr-Anbindung* half of the *Interaktionen* falls away with
it, and neither `publish` nor `lookup` reaches a relay, so nothing is sent and nothing asked. Two
steps then rest on it: *An Redaktionen weiterleiten* is offered only while it has a target — the
editorial teams or the relay — and the *Interaktionen* view only while one of the two has something
to report. Switching it off also drops what the content in hand had with the relay (the tick and the
receipt), so switching it back on carries nothing into a step as though it had just happened.

The mapping lives in `util/amb-event.ts` and follows the reference converter
(`edufeed-org/amb-nostr-converter`): the record's `id` — and with it the event's `d` tag — is the
address the resource lives at (`ccm:wwwurl`, else the page the Erschließung ran on), which is what
makes a later publication of the same content replace the record rather than add a second one. A
scalar field is one tag of its own name (`name`, `description`, `inLanguage`, `image`,
`datePublished`), a nested one is flattened into colon-delimited keys (`about:id`,
`learningResourceType:prefLabel:de`, `creator:name`), keywords go as the nostr-native `t` tags, and
the node the record was read off travels as `mainEntityOfPage:*` plus a plain `r` tag. The WLO
vocabulary properties (`ccm:taxonid`, `ccm:educationalcontext`, `ccm:oeh_lrt` /`oeh:new_lrt`,
`ccm:educationalintendedenduserrole`) already hold URIs and are written as term ids; a value that is
no URI is written as a German `prefLabel` instead. `ccm:commonlicense_key` plus
`ccm:commonlicense_cc_version` become the licence's own address (`CC_BY_SA` + `4.0` →
`https://creativecommons.org/licenses/by-sa/4.0/`); a key that cannot be named as one is left off
rather than stated wrongly. The relay itself requires only `d` and `name`, so every other field is
written only where the content states it.

`NostrForwardService` signs the event and publishes it over one WebSocket per publication
(`util/nostr-relay.ts`: `["EVENT", …]`, awaiting the relay's `["OK", <id>, <accepted>, <reason>]`).
Nostr identifies a publisher by a key pair and by nothing else, so the panel holds one of its own: 64
hex characters generated on the first publication and kept under `eduSharingNostrSecretKey`, never
leaving the browser. Its public half is shown in *Einstellungen* as the `npub…` a relay knows this
installation by. Which relay is published to is a setting too (`eduSharingNostrRelayUrl`, falling
back to `APP_CONFIG.nostrRelayUrl`, `wss://amb-relay.edufeed.org`); an address that is not a
WebSocket one is refused before anything is sent, since nostr has no other transport.

A publication happens once per content however often the step is walked through, and the step is
**kept open** after it so the receipt can be read: `es-nostr-receipt` names the relay, the kind, the
`d` tag, the `npub`, the event id and the relay's own verdict, lists **every tag that went out** and
the raw event JSON beside them, and gives the commands that fetch the record back — `nak fetch
<nevent…>` for this event, `nak fetch <naddr…>` for the record's standing address, `nak req -k 30142
-a <pubkey> <relay>` for everything this installation published, the raw `REQ` frame for a plain
WebSocket, and the `njump.me` page for a browser. The same receipt is shown under the *Interaktionen*
view and by *An Nostr Relay senden*, so what was published stays findable after the step is left. A
refusal is kept as a receipt as well — it says what was offered and what the relay answered — and
holds the step open.

**Nothing about a publication is kept in this browser.** The panel does not remember which content it
published; it asks the relay (`NostrForwardService.lookup`, opened by both screens that speak about it,
once per content). Two filters in one `REQ`, which a relay reads as an *or*: `{kinds:[30142], "#d":[<the
AMB id>]}` — the record under the identifier this content would be published as — and `{kinds:[30142],
"#r":[<the node's page>]}`, which still finds it after the content's own address has changed. Both are
single-letter tags and therefore indexed (NIP-01). This answers more than a stored id could: it holds
after a reload and after the *Verlauf* is cleared, it sees a publication made from another installation,
and it cannot claim a record that has since been replaced or removed. What it cannot recover is a
*refusal* — that is an event of this session, not a record on the relay, and needs no longer life.

A record read back this way is marked as such (`NostrReceipt.origin: 'relay'`), so the receipt says
„Beim Nostr-Relay hinterlegt" rather than „gesendet", carries the event's own `created_at` in place of a
relay verdict there was no exchange for, and dates it from the event rather than from the lookup. It also
says whose it is (`NostrReceipt.own`): an addressable event is addressed by kind, **publisher** and
identifier, so a record for the same resource under a foreign key is a second record and not an older
version of this panel's — publishing would put one beside it, which is why the state is named separately
and the button keeps saying *An Relay senden* there. A lookup that does not get through is its own state,
**Unbekannt**: not knowing is not the same as knowing there is nothing, and only the second may read as
„nicht gesendet".

### An Nostr Relay senden

A step of its own rather than a view of the Inhaltsübersicht, entered from the *Inhaltsoptionen* (between
*Inhalt teilen* and *Interaktionen anzeigen*) and left again by the way back
(`ContentFlowService.showNostrForward`). It publishes a content the panel already has — one taken up from
the *Verlauf* or from *Meine Inhalte*, or detected on the open page — which is the same publication the
forwarding step makes on its way on, for a content that is past that step. It applies to any active node
and asks for nothing else of the repository: an AMB record needs nothing of it beyond the metadata, and
unlike the steps around it this one writes nothing to the repository, so it needs no session of the
user's own either. What it does need is the settings' switch — with *Nostr-Relay verwenden* off the row
is not offered in the *Inhaltsoptionen* at all.

The mapping, the relay and the receipt are as in
[An Nostr Relay weiterleiten](#an-nostr-relay-weiterleiten); what differs is that nothing is ticked — the
footer's *An Relay senden* publishes there and then (`CurationService.sendToNostr` →
`NostrForwardService.publish`, which unlike `forward` neither asks for a tick nor stops at an existing
receipt). Above it stands `es-nostr-standing`, the state card the *Interaktionen* view carries too; under
that, the screen names what would go out before it does — the `d` tag, the name, and how many further
fields the content fills — and refuses in advance where AMB's two required fields are missing, since that
is answerable without sending. A content already on the relay is sent **again**: the button reads *Erneut
senden*, and because a kind-30142 event is addressable the second publication replaces the record rather
than adding one beside it. A re-publication that fails leaves the previous receipt standing, because what
the relay holds is unchanged by it. Opening the step asks the relay what it already holds, so a content
published in an earlier session shows its record here rather than reading as untouched — see
[An Nostr Relay weiterleiten](#an-nostr-relay-weiterleiten).

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
apply — and only where the repository config enables the browser extension custom web component:
both processes belong to it (the criteria view and the assistant), so without it there is nothing to
choose between and the filing leads straight into the Metadaten view. Two cards, each with the button
that starts its process: *Strukturierte Qualitätsprüfung*, which
is the *Qualitätsprüfung* as it stands (criteria, then metadata), and *Individuelle
Qualitätsprüfung mit KI*, the analysis against the chosen collection's requirements as a dialogue with
the assistant (see [CHATBOT.md](CHATBOT.md)). Clicking a card marks it and the footer's *Weiter* starts
the marked one, so the two ways on say the same thing (`FlowChoiceScreenComponent`, which registers the
choice as the footer's `ApplyHandler`).

Starting the KI check **ends whatever chat conversation is stored**, so it opens on an empty dialogue
instead of on the previous one; walking back out of it asks before that dialogue is lost.

---

## OnlyOffice-only options

Both need the page-side edu-sharing plugin; the round trips they use are specified in
[content/HOST-EVENTS.md](content/HOST-EVENTS.md). Without an OnlyOffice page they can still be
exercised — see [TESTING.md § Debug mode](TESTING.md#debug-mode-onlyoffice-without-onlyoffice).

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
(`topbar: true`, `NavigationService.topbarSections`) — otherwise ordinary options, with the same
visibility, guards and view title. Such an icon lays its view **over** the open step instead of
navigating to it, and closes it again where it stands; the step keeps running behind it, see
[UI-SHELL.md](UI-SHELL.md#chrome-topbar-status-bar-footer).

- **Verlauf** *(with the entry count as a badge)* — the **saved nodes**, newest first. An entry is
  recorded only when a node is actually saved, so every row carries a `nodeId` (legacy pre-node
  entries are dropped on load, and re-saving a node moves its row to the top instead of
  duplicating). *Inhaltsoptionen öffnen* fetches the live node by id (`CurationService.openFromHistory` →
  `RepositoryNodeService.get`) and takes the content up at the *Inhaltsoptionen*; if there is unsaved
  work the shell confirms first, and a failed fetch is surfaced via an alert. Beside the metadata an
  entry carries what the flow needs to go on with the content: the Erschließung it was written from,
  how far the Qualitätsprüfung got, the step it was left on, whether it was handed over, and the
  editorial teams it was forwarded to (`HistoryEntry.forwardings`, read back by the *Interaktionen*
  view). All of them optional — an entry written before one of them was kept says nothing about it,
  which is not the same as saying no.
- **Einstellungen** *(dotted while a change waits to be applied)* — the Repository-URL (used for
  login and every embedded element) at the top, then *SSO-Anmeldung* and **Darstellung**, and below
  those five folded groups, one open at a time:
  *Entwickler-Optionen* (the switch **WLO-Funktionen verwenden**, plus the dev and the debug mode, see
  [TESTING.md](TESTING.md)), *KI- und
  Chatbot-Optionen* (the corrections to the chat widget's display, the chatbot's master skill as
  *Vorgabe des Betreibers* / *An* / *Aus* — see
  [CHATBOT.md](CHATBOT.md#the-attributes-set-on-mount)),
  *Zugehörige Sammlungen empfehlen*, *Qualitätsprüfung* and *Nostr-Relay* (the relay
  [An Nostr Relay weiterleiten](#an-nostr-relay-weiterleiten) publishes to, plus the `npub` this
  installation publishes under, and above both the switch **Nostr-Relay verwenden** that takes the
  connection out of the panel altogether). *KI- und Chatbot-Optionen*, *Zugehörige Sammlungen empfehlen* and
  *Qualitätsprüfung* configure steps that only the WLO panel has and are shown only there
  (`browserExtensionCustomWebComponent`); *Entwickler-Optionen*, *SSO-Anmeldung* and *Nostr-Relay*
  are shown in every
  panel, the latter because the step it configures is offered in every panel too — an AMB record is
  published from any repository and the relay belongs to none. **WLO-Funktionen verwenden** is what
  decides that: on by default, and off it reads `browserExtensionCustomWebComponent` as unset whatever
  the repository answers, so the panel offers the MDS editor, the login and a save without
  `ccm:oeh_*` fields — the ordinary flow, walkable through against a WLO repository. It sits in
  *Entwickler-Optionen* because the three groups it hides are behind the flag themselves, see
  [WEB-COMPONENTS.md § Refusing the variable](WEB-COMPONENTS.md#refusing-the-variable). Each group's
  head carries a pill counting the settings inside it that stand away from their default (`… geändert`),
  so a folded group says whether anything in it was touched; a group holding nothing but defaults carries
  none. Every default is compared where it is defined — each service answers for its own settings
  (`changedSettings`), the screen only sums them per group.

  *SSO-Anmeldung* is folded like the tuning groups but sits above them, next to the repository — and
  unlike them it holds no settings at all, which is why its head carries no `… geändert` pill. What
  it reports is the repository's own answer: the panel asks for
  `<Repository>/.well-known/oauth-authorization-server` (RFC 8414) on startup, as the client
  `browser-plugin` with the scope `profile`, and the group states that address, whether a server was
  described there, what it calls itself, and what logging out will be able to do — whether it names a
  revocation endpoint and whether it names one for ending its own session, since without the latter
  the provider's cookie survives *Abmelden* and the next sign-in does not ask again. A scope the
  server does not define is named here too: a provider refuses an unknown one on an error page of its
  own rather than by redirecting, so the flow would otherwise hang with nothing to read. *Erneut
  fragen* asks again without reloading the panel, which is what whoever has just enabled the server
  on the repository wants. The one value that has to be *entered* somewhere is entered at the
  provider, not here: the redirect address the client must have registered, which with the browsers'
  own `identity` API is an address the browser makes up per installation and nobody could look up —
  so the group shows the one *this* browser will use (Safari, having no such API, uses
  `<Repository>/oauth/extension-callback`), and a deployment across several browsers registers all of
  them. Where the repository describes a server, the login card leads through it **instead of**
  asking for username and password; where it does not — the ordinary case — the card is the
  credential form alone. See
  [UI-SHELL.md § Login, session restore and the guest gate](UI-SHELL.md#login-session-restore-and-the-guest-gate)
  and [ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow).

  *Darstellung* is not folded away, because it is about the panel rather than about a step in it:
  *System folgen* / *Hell* / *Dunkel*, persisted under `eduSharingTheme` and resolved by
  `ThemeService`, which stamps `data-theme="light|dark"` and `color-scheme` on the document element
  for `styles/_tokens.scss` to read. *System folgen* is the default and answers
  `prefers-color-scheme`, so a browser set to dark gets a dark panel without the setting being
  visited. Hell and Dunkel are also one press away from every screen, through the switch in the
  topbar (see [UI-SHELL.md](UI-SHELL.md#chrome-topbar-status-bar-footer)) — which is why *System
  folgen* is reached here and nowhere else: it is what the switch cannot say. The embedded elements
  are switched with it and follow a change without a reload — the
  edu-sharing bundle and the assistant's chat widget both take the theme as a parameter, see
  [WEB-COMPONENTS.md § Handing the theme to a bundle](WEB-COMPONENTS.md#handing-the-theme-to-a-bundle);
  the WLO canvas is the one screen pair that stays light, see
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-wlo-canvas-has-no-dark-theme).
- **WLO Metadaten-Agent** — only when the repository config enables it, see
  [WEB-COMPONENTS.md](WEB-COMPONENTS.md#the-optional-wlo-metadata-editor).
- **Boerdi — KI-Assistent** — the assistant's chat widget, embedded as the real `<boerdi-chat>`
  element the packaged `boerdi/` bundle defines. On the same condition as the WLO canvas
  (`browserExtensionCustomWebComponent`), since it comes with that bundle. The panel is not the page,
  so the widget's own context detection is off and the page is handed over explicitly — including to a
  chat session that outlived a page change. One component (`AiAssistantScreenComponent`) serves two
  screens, which differ only in the context they state and in whether they put a task with it: *Frage
  stellen* above the session bar states the open tab, and *Individuelle Qualitätsprüfung mit KI* states
  the curated content and leads through the check. Both are [CHATBOT.md](CHATBOT.md); what the check
  asks and records is [CHATBOT-IO.md](CHATBOT-IO.md).

---

## Two flows end to end

**Curating an open page.** *Inhalt erschließen* → the metadata screen with the generated fields →
*Speichern* creates the node in the inbox → *Vorschau* → the filing steps that apply → *Prüfprozess
auswählen* → *Qualitätsprüfung* → *Inhaltsübersicht*.

**Enriching an open OnlyOffice document.** The document is already the active node (`DOCUMENT_INFO`
on boot) → *Metadaten anreichern* reads it through the plugin → the metadata screen → *Speichern*
updates **that** node, never creating a second one → the same filing and checking steps.

**Adding a file or a link.** *Inhalt hinzufügen* → *Datei oder Link* → the repository's own dialog
reports the picked file or the entered link → `MaterialUploadService` creates the node in the picked
folder (the inbox without a login) → the Erschließung's **Vorschau** step, where the new node's
picture and title are checked (`ContentFlowService.showCurationPreview`) → *Weiter* writes them onto
that node → the same filing and checking steps. A **link** carries its own source page along: the
metadata view erschließt it when it opens, so the description starts from that page rather than from
the bare URL the node holds.

**Picking a content leaves the tab where it is**: a node chosen in *Meine Inhalte* or im *Verlauf*
becomes the panel's content and the *Inhaltsoptionen* open on it right away
(`ContentFlowService.showContentOptions`), without the open page being replaced. See
[UI-SHELL.md § Page changes the panel asks for itself](UI-SHELL.md#page-changes-the-panel-asks-for-itself).
