# The chatbot — how the KI assistant is embedded

The panel's KI assistant is a **separate project**: `edu-chatbot-sc`. In this repository it is called
**boerdi** throughout — the string `chatbot` appears in no source file, so this document is where a
search for the word lands. Everything named `boerdi-*` belongs to it.

It is embedded as a **real custom element in the sidebar document, not an iframe**, and it is the only
one of the three packaged bundles that talks to a backend of its own.

- [Where it comes from](#where-it-comes-from)
- [How it is embedded](#how-it-is-embedded)
- [The contract surface](#the-contract-surface)
- [The page context](#the-page-context)
- [Where it appears in the UI](#where-it-appears-in-the-ui)
- [Three things called a check](#three-things-called-a-check)
- [The backend side](#the-backend-side)
- [Manifest, CSP, packaging](#manifest-csp-packaging)
- [Refreshing the bundle](#refreshing-the-bundle)
- [Weak points](#weak-points)
- [What is still open in the KI check](#what-is-still-open-in-the-ki-check)

**Keeping this file current.** It describes `app-src/src/app/features/assistant/`,
`app-src/src/app/features/quality/ai-quality-screen/`, `app-src/src/app/util/page-context.ts`,
`app-src/src/app/util/quality-check-request.ts`, the
`boerdi` branch of `app-src/src/app/services/web-component-bundle.service.ts`, `scripts/boerdi/` and
`scripts/fetch-widget.mjs`. A change to any of those belongs here as well. Where
[FEATURES.md](FEATURES.md) and this file disagree about the assistant, this file is the newer one —
see [Weak points](#weak-points).

---

## Where it comes from

| | |
|---|---|
| Repository | `git@github.com:janschachtschabel/edu-chatbot-sc.git` |
| Project name there | boerdi-chat, the WLO chatbot "BadBoerdi 2.0" |
| Deployed backend | `https://87.106.127.225.nip.io` (traefik, TLS, 443 the only published port) |
| Its own reference for our case | `docs/browser-plugin-einbindung.md` — written for embedding the widget in a browser extension |
| The ancestor of this integration | `examples/chrome-plugin/` — a runnable MV3 sidebar, no build, no dependencies |

It is a monorepo shipping **one Docker image for three surfaces**:

- `backend/` — FastAPI + LangGraph, Python 3.12, `uv`, Postgres 17 with pgvector, Valkey for the
  rate-limit counters, LiteLLM, an MCP client
- `frontend/projects/widget` — the Angular 22 custom element `<boerdi-chat>`, zoneless, **shadow
  DOM**, built as a single file of roughly 525 kB
- `frontend/projects/studio` — the editorial web admin under `/studio`
- `frontend/projects/ui` — the shared library: chat shell, cards, stream client, page context, host
  events, session

The container exposes **8100** (`uvicorn boerdi.main:app --port 8100`), and its dev compose serves
`http://localhost:8100/health` — 8100 rather than 8000 because the predecessor system occupies 8000
locally. The widget is built there with `cd frontend && npm run build:widget`.

## How it is embedded

The prebuilt Angular-elements bundle is loaded into the sidebar document and registers the custom
element `<boerdi-chat>`, which is then used as a real tag. It runs with the extension's privileges,
on equal footing with this app's own code — no iframe, no sandbox, no change of origin.

Two things make that the only available shape:

- **Manifest V3 forbids remotely loaded code.** An extension page runs under `script-src 'self'`, so
  a `<script src="https://backend/widget/boerdi-widget.js">` is blocked and the bundle has to sit in
  the package (`scripts/boerdi/boerdi-widget.js`, roughly 530 kB).
- **The backend sends `X-Frame-Options: SAMEORIGIN`** and no `frame-ancestors` policy, so the chat
  cannot be framed at all. The bundle file itself is served with `Access-Control-Allow-Origin: *`.

`WebComponentBundleService` owns the loading. For `boerdi` it declares a single ES module script and
no stylesheet — the widget carries its styles itself. It is also the one bundle whose
`publishEnvironment()` does nothing: the widget reads **no** global variable and is configured
entirely through element attributes, unlike `edu` (`window.__env.EDU_SHARING_API_URL`) and `wlo`
(`window.__ENV.agentUrl`). `installBundleWindowRedirect` is not installed for it either; that is an
`edu` concern. The general mechanics are in [WEB-COMPONENTS.md](WEB-COMPONENTS.md).

## The contract surface

`app-src/src/app/features/assistant/ai-assistant-screen/ai-assistant-screen.component.ts` is the
**only** place in this codebase that knows the chatbot. Everything it depends on is a name from the
other project, held in a constant at the top of that file:

| Constant | Value | What it is |
|---|---|---|
| `CHAT_TAG` | `boerdi-chat` | the custom element |
| `LOG` | `[edu-sharing][boerdi]` | prefix of every chat diagnosis in the console |
| `CHAT_API_URL` | `https://87.106.127.225.nip.io` | the backend, hardcoded |
| `SESSION_KEY` | `boerdi_session_id` | where the widget keeps the session it resumes |
| `SHELL_TAG` | `boerdi-chat-shell` | the element the conversation renders in, looked for in the shadow root |
| `SHELL_TIMEOUT_MS` / `SHELL_POLL_MS` | 10 000 / 50 ms | how long, and how often, that element is waited for |

### The attributes set on mount

`mount()` creates the element **imperatively** and sets every attribute **before** `appendChild`,
because the widget resolves its context as it connects:

```ts
element.setAttribute('api-url', CHAT_API_URL);
element.setAttribute('embed-mode', 'frameless');        // draws no floating button of its own
element.setAttribute('initial-state', 'expanded');       // being on this screen is already the request to chat
element.setAttribute('show-language-buttons', 'false');
element.setAttribute('show-debug-button', 'false');
element.setAttribute('auto-context', 'false');           // its own URL detection stays off
element.setAttribute('page-context', JSON.stringify(this.current));
element.style.cssText = 'display:block;flex:1 1 auto;min-height:420px';
```

That order is load-bearing. The widget divides its attributes into three classes by when they take
effect, and the ones above are the class that is **read only at start**: `api-url`, `page-context`,
`auto-context`, the `persist-session*` family, `size`, `ticket`. A second class takes effect on a
chat restart (`greeting`, `start-replies`, `show-welcome`), a third immediately (`engine`,
`language`, `theme`, `primary-color`, `embed-mode`).

`auto-context='false'` is the heart of it: the panel is not the page, so the widget's own detection
would contribute the extension's address rather than the tab's. Its URL watcher never fires either —
the panel's own address does not change while the tab it shows does.

The element is sized inline rather than from the stylesheet because an imperatively created element
carries no view-encapsulation attribute, so this component's styles would not match it. Frameless it
fills 100 % of its container in both directions, which means a container without a height leaves it
silently 0 px tall — hence `min-height`.

Two more are set where a screen wants an answer it can record — `result-schema` and, with it,
`engine="agent"`. They belong together: under the default engine a schema takes no effect at all, and
the KI check is the one screen that states them, see
[the check as a task](#the-ki-quality-check--about-the-curated-content). With a task stated,
`page-context` is *not* set here at all; the page is handed over afterwards instead, and the reason
is below.

Attributes the widget also understands and this app does not set: `ticket`, `size`, `position`,
`theme`, `show-cards`, `primary-color`, `greeting`, `start-replies`, `show-welcome`, `language`,
`trusted-domains`, `persist-session`, `session-key`, `session-cookie-domain`,
`session-cookie-max-age`, `intercept-edu-sharing-links`, `emit-guide-suggestion`,
`emit-routing-debug`, `inline-result-grouping`.

### The two methods that carry every later page

`ChatElement` types the element for what is used of it, both signatures optional because the methods
exist only once the element has been upgraded:

- **`updateContext(ctx)`** — merge into the current context. No greeting, and what is not named stays
  as it was.
- **`replaceContext(ctx)`** — replace it, as a navigation would: the previous page's ids leave the
  context and the new page is greeted.

`follow()` picks between them with `sameSubject()`: the same page under a changed address is merged,
which keeps a running conversation quiet; another page is replaced. It compares against `current`,
the context the widget is known to hold, so a mere re-read changes nothing. A missing method means
the bundle's API changed and the context silently never arrived — that case is warned about.

Both methods reach the widget through the component it renders, so a call made before that component
exists is dropped without a trace. `whenShellRendered()` therefore polls for `<boerdi-chat-shell>`
before handing anything over, in the shadow root **and** in the light DOM, for up to ten seconds.
Three situations need it:

- **A screen that states a task.** Its context is deliberately not set as an attribute, so it has to
  arrive right after the element is appended, and the task immediately behind it — see
  [the check as a task](#the-check-as-a-task).

- **A resumed session.** The panel is torn down and rebuilt on every page change, so the widget is
  created anew each time while its session outlives it in local storage. A resumed conversation keeps
  the context it was last given, and `page-context` is only read into a conversation that starts
  here — so `openConversation()` replaces the context explicitly whenever
  `localStorage['boerdi_session_id']` holds a session.
- **A page change arriving before the conversation is on screen.** `follow()` records the new page in
  `current` and defers, then hands over the page *as it stands* when the shell appears.

The element is mounted exactly once (`if (this.element) return;`); every later page goes through
those methods.

### The third method: putting a task

`startTask(text)` sends an instruction straight away, shown as its own dashed "Auftrag der Seite"
bubble rather than as something the person said. The KI check uses it; the assistant's own screen
does not.

**It is dropped without a word while the widget is busy.** The widget refuses any message put to it
during a turn (`if (!msg || ctx.isLoading()) return`), and a chat that opens on a page it can address
*is* busy: it greets that page over the network. A task put the moment the conversation appears
therefore never happens, and nothing says so — no error, no log, just a chat that answers a greeting
nobody reads and never the task. What gets it through is doing without the `page-context` attribute,
handing the page over with `replaceContext()` once the shell is there, and calling `startTask()`
**in the same turn of the event loop**: the task is then the turn that runs, and the greeting is the
one that gives way. This was measured against the packaged bundle, not reasoned about.

The other methods the widget forwards — `openChatbot`, `closeChatbot`, `toggleChatbot`,
`isChatbotOpen`, `resetSession` — are unused here. Before the element is upgraded all of them are
no-ops rather than exceptions. There is no `sendMessage`.

The widget also reports back, as `window` CustomEvents with `bubbles: true, composed: true` — needed
because it renders into a shadow root. Only the last of them is listened to here:

| Event | When | Payload |
|---|---|---|
| `boerdi:query-meta` | always | `{queries:[{tool_name, query_type, search_term, criteria[], …}]}` |
| `boerdi:page-action` | always | `{action, payload}`; today `navigate`, `show_results`, `canvas_show_cards` |
| `boerdi:guide-suggestion` | `emit-guide-suggestion` | `{url, title, node_id, node_type, query, alternatives[]}` |
| `boerdi:routing-debug` | `emit-routing-debug` | `{message, pattern, intent, state, persona, tools_called[], …}` |
| `boerdi:agent-result` | `result-schema` **and** `engine="agent"` | `{result, stop_reason}` |

**Every one is dispatched twice** — first `boerdi:…`, then `badboerdi:…` for the predecessor system.
`AiAssistantScreenComponent` listens to the first name only; listening to both would process every
answer twice.

`boerdi:agent-result` is what a stated schema is for. It arrives on **every** turn once a schema is
set, including the turns that submitted nothing, so that a run cut off by a cap is distinguishable
from one that had nothing to add — `stop_reason` says which. The component passes it on as the
`agentResult` output, translated into `{result, stopReason}`.

The only `postMessage` anywhere in the chatbot's code is its own OAuth PKCE popup channel for the MCP
login. It is not a bridge to the extension. The panel's own `postMessage` traffic — the panel host's
iframe, the OnlyOffice plugin channel — has nothing to do with the chat; see
[ARCHITECTURE.md](ARCHITECTURE.md).

## The page context

`app-src/src/app/util/page-context.ts` deliberately mirrors the widget's wire format, snake_case and
all:

```
page_kind: 'topic' | 'collection' | 'content' | 'subject' | 'search' | 'other'
page_url, page_host, node_id, collection_id, topic_page_slug,
subject_slug, search_query, page_text, detection_source
```

The widget additionally knows `search_filters`, and `home` vs. `external` is decided by the **server**
from a host list rather than sent from here.

- `pageContextOf(url, title)` builds the context of an open tab; anything that is not `http:` or
  `https:` yields none.
- `subjectOf()` recognises the page kind from the address: `/components/render/<uuid>` gives a
  `node_id`, `/components/collections?id` a `collection_id` and `search_query`,
  `/components/topic-pages` a topic, plus `?node`, `?collection`, `/themenseite/<slug>`,
  `/fachportal/<slug>`, `/components/search` and a bare `?q`.
- `sameSubject()` is what decides merge against replace.
- `contentContextOf()` builds the context of a curated content instead of a tab, with
  `detection_source: 'panel:content'` and `page_kind` `'content'` where the content has a node,
  `'other'` where it does not.
- Title and text travel together in **`page_text`**, joined by a blank line with the title first so
  it survives the cut.
- Two limits bound what a page can put in front of the model: `TEXT_MAX` of 300 characters for a tab
  title, `CONTENT_TEXT_MAX` of 8000 for a curated content — that text *is* the subject of the
  dialogue.

### Which id is sent decides what gets judged

The most expensive thing to get wrong in this whole integration, because it fails quietly and
plausibly. The backend resolves whichever id the context carries as "the current page"
(`target_id = node_id or collection_id`, `services/page_context.py`) and renders a block from what it
finds. Handed a collection, that block is the *collection*: its title, its editorial compendium text,
how many materials it holds, and its id offered up for `get_collection_contents`. And the content's
own title and text — the `page_text` this panel took such care over — are then **never put in front of
the model at all**: `render_raw_for_prompt()`, the block that carries them, runs only where nothing
could be resolved (`block or render_raw_for_prompt(page_context)`).

Measured against the deployed backend with a text about the *Astronomische Einheit* and the collection
*Geometrische Optik*, one task, two contexts:

| context | tools the assistant called | what it judged |
|---|---|---|
| `page_kind: 'collection'` + `collection_id` | `search_wlo_content`, `get_wlo_content_text`, `get_node_details` | "der **gefundene** Inhalt" — some material it looked up, its reasoning citing a source that appears nowhere in the text handed over |
| `page_kind: 'other'`, no ids | `search_wlo_collections`, `get_skill` | "der **sichtbare Seiteninhalt**" — the text handed over |

So the node leads. With a `node_id` the context is that content — the backend resolves it with
`includeTextContent` and the collection travels beside it as the id the skill is fetched by. Without
one, no id is sent at all: the title and text then reach the model as the page's own text, and the
collection is named in the task rather than in the context. The instruction says the same thing once
more in words ("Gemeint ist genau dieser eine Inhalt … Beurteile NICHT die übrigen Inhalte der
Sammlung"), because saying it twice costs nothing and this is what goes wrong.

## Where it appears in the UI

One widget, one component, two screens that differ only in the context they state.

### The assistant's own screen — about the open tab

`AiAssistantBarComponent` offers it as a row above the session bar: the whole row is the button, with
the `icons/boerdi.svg` avatar and *Frage stellen*, and `ask()` navigates to the `ai-assistant`
section. The row appears only while `browserExtensionCustomWebComponent` is enabled, a session
exists, no login gate is up, and the panel is not already on that screen; it is disabled while a
write is running (`BusyService`).

The section itself is `plain` and carries no `menu: true` — that row is the only way in. Its context
is `pageContextOf(conditions.activeUrl(), conditions.activeTitle())`, so `page_text` is the tab title
and nothing more.

### The KI quality check — about the curated content

*Prüfprozess auswählen* (`flow-choice`) offers two cards, *Strukturierte Qualitätsprüfung* and
*Individuelle Qualitätsprüfung mit KI* ("Lass deinen Inhalt von der KI anhand der Anforderungen der
gewählten Sammlung analysieren und erhalte individuelle Empfehlungen im Dialog."). Picking one is a
radio choice; the footer starts it.

`AiQualityScreenComponent` then states the context itself and embeds the same chat:

```ts
protected readonly collection = computed(() => this.curation.filedCollections()[0] ?? null);

protected readonly context = computed<PageContext>(() => contentContextOf({
  title: this.curation.contentTitle(),
  text: this.curation.contentText(),
  url: this.curation.contentUrl(),
  collectionId: this.collection()?.id ?? null,
  nodeId: this.curation.activeNode()?.nodeId ?? null,
}));
```

The hand-over is a plain Angular signal input — `readonly context = input<PageContext | null>(null)`
on the chat component, no service in between. `subject` falls back to the open tab when it is unset,
which is how the assistant's own screen uses it, and an `effect` feeds every change into `follow()`.
The screen warns above the chat when no collection is picked, because the collection is what the
assistant looks its skill up by.

The values come from `CurationService`: `contentTitle` is `cclom:title`, else the preview node's
title, else the active node's name; `contentText` is `_source_text`, else `ccm:oeh_extendedText`, else
empty; `contentUrl` is the metadata agent's last run — the page that was curated, not the tab that is
open; `filedCollections` are the editorial and personal collections the content was filed in,
deduplicated, as `{ id, name }`.

**Both screens share one conversation.** The session lives in `localStorage['boerdi_session_id']`, so
someone who chatted from the bar and then enters the KI check continues the same conversation — with
a `replaceContext` rather than a fresh start.

#### The check as a task

The dialogue ends in the same record the structured check produces. That is what the criteria of the
metadata set are read for, and they travel to the assistant twice over: as the task, so it knows what
it is judging, and as the shape of its answer, so what comes back can be recorded rather than read.
`util/quality-check-request.ts` is the whole of that translation.

**The criteria.** `criteriaOf()` takes them from the same two widgets the structured check uses —
`virtual:unmetLegalCriteria` for the knock-out ones, `ccm:oeh_buffet_criteria` for the editorial ones.
Each becomes a `QualityCriterion` with a short key, `k1`, `k2`, …: their own ids are node properties
and vocabulary URIs, and as schema keys they would spend the budget on addresses the model has no use
for.

**The check is up to four tasks, one after the other**, and none of them is put until the previous one
has answered:

1. **Begrüßen und fragen, wem der Inhalt gehört** (`originInstructionOf()`) — the greeting, one sentence
   on what is about to happen, and the one question nothing here can answer for itself: is this the
   person's own content, or someone else's? The panel holds who is logged in and who owns the node, but
   whoever checks a content is routinely neither its author nor its owner, and the text says nothing
   about it at all. The task judges nothing and does not read the content. Its schema is a single word,
   `herkunft`, with `enum: ["eigen", "fremd"]` — enums do reach the model through `submit_result`,
   measured — and the assistant is told not to fill it in before the person answered. Measured, three
   turns: the greeting submitted nothing; *„Das ist mein eigener Inhalt"* came back
   `{"herkunft":"eigen"}` and *„Der Inhalt ist nicht von mir, ich ordne ihn nur ein"*
   `{"herkunft":"fremd"}`; *„Weiß nicht so genau"* submitted nothing and asked again, which is what the
   task tells it to do with an unclear answer.

   **The assistant states a guess before it asks**, so the person mostly only has to nod. It is handed
   three facts the panel holds and the text does not carry: the source URL, whom the content names as
   author (`ccm:author_freetext`, else `ccm:oeh_publisher_combined`) and who is signed in
   (`AuthorityNamePipe` over `AuthService.currentUser()`). A foreign host speaks for someone else's
   content, an author matching the signed-in person for one's own. The guess is kept beside the answer
   in `vermutung`, never in its place — measured across three runs: a LEIFIphysik source with a
   LEIFIphysik author guessed `fremd` and was confirmed; an own author with no source guessed `eigen`
   and was confirmed; and *„Nein, der Inhalt ist von mir, ich habe ihn nur dort veröffentlicht"* came
   back `{"herkunft":"eigen","vermutung":"fremd"}` — the person's answer won, and the guess is logged
   beside it so it can be told how often it is worth making.
2. **Sprache durchsehen** (`proofreadInstructionOf()`) — **only where the answer was `eigen`.** Spelling,
   grammar, punctuation and wording, against the collection's skills on language or text quality where
   it has released any. Each finding quotes the passage verbatim and puts the correction beside it,
   because the person has to find the place in their own text and *„einige Kommafehler"* is not a place.
   An empty list is an answer and is taken as one. The step is bound to the ownership question because a
   correction is worth having only where somebody can carry it out: the author of a content can go and
   fix what this finds, while whoever files someone else's can do nothing with a list of its typos but
   read it. This task **quotes the content's own text in full** — what it judges is the wording itself,
   down to the character. Measured on a text with three planted errors: all three found and classified
   (Rechtschreibung, Zeichensetzung, Zeichensetzung), the confirmation turn `submit`. Nothing of it is
   recorded on the node — there is no property that holds a correction — so it is logged and left where
   it is of use, in the chat next to the person's own text.
3. **Qualität bewerten** (`qualityInstructionOf()`) — the criteria, listed by key and caption and named
   as *our check dimensions*, judged against **every** quality-assurance skill the collection has
   released: the assistant is told to fetch the registry (`get_skill_registry`) and then each
   instruction that speaks to one of those dimensions (`get_skill`). Naming the dimensions is what lets
   it pick — asked for "the collection's instruction" it fetches one, or none. What a skill checks that
   we hold no criterion for is not dropped and not invented as one either: it goes into the single
   overall verdict, `geeignet`, and is named in the summary. This task **quotes the content's own text
   in full**.
4. **Metadaten anreichern** (`enrichmentInstructionOf()`) — subject, education level and resource
   type, each looked up in its WLO vocabulary (`lookup_wlo_vocabulary` with `discipline`,
   `educationalContext`, `lrt`) and answered **with the URI**, plus five to ten keywords. A guessed
   URI does not fail; it quietly matches nothing, which is why the schema says a value that cannot be
   looked up is left empty rather than formed. It asks for a released skill for this step too, and
   softly: there may not be one yet, and a skill that does not exist must not read as a step that
   failed — but where one appears it takes precedence over anything the model would do on its own.

**Every step ends with the person, not with the assistant.** Each task has it write its proposal into
the chat, ask the person to go through it and confirm or correct it, and call `submit_result` only in
the turn where they do. So what the panel records is an answer somebody stood behind, and those
confirmations are what carry the check from one step to the next and finally to the footer. The panel
narrates none of it beside the chat: the assistant is the one thing on this screen that can talk, so
leading through the steps is its part. Measured end to end for the judgement and the enrichment, one
session, four turns:

| turn | message | `result` |
|---|---|---|
| 1 | the quality task | none — twelve verdicts in the chat, ending in *„Soll es so stehen bleiben, oder möchtest du einzelne Bewertungen korrigieren?"* |
| 2 | *„Ich bestätige das Urteil zur Linsengleichung."* | `submit`, all twelve criteria |
| 3 | the enrichment task | none — the values in the chat, ending in *„Sollen diese Metadaten so übernommen werden?"* |
| 4 | *„Ja, die Metadaten passen so."* | `submit`, subject, level, type and keywords |

**The confirmation turn only submits under the agent engine.** The `engine` attribute travels to the
backend as the header `X-Boerdi-Engine`, and the routing is decided per message: without it, a short
*„Ich bestätige das Urteil"* is taken for ordinary chat — measured, it was answered by an unrelated
skill (*„[ edu-sharing Skill ] Vertretungsstunde planen"*) and submitted nothing, while the same turn
with the header came back `submit` with all twelve criteria. The panel sets `engine="agent"` together
with the schema, so every turn of the check runs the agent, not only the one that carries the task.

**A side effect worth knowing about: the chips now offer the confirmation.** Prescribing them is
impossible — no widget attribute, no `Environment` field, and an explicit instruction in the task is
ignored by the generator (measured). But the generator reads the answer, and an answer that ends in a
question about confirming produces chips about confirming: *„Ich bestätige das Urteil zur
Linsengleichung."* / *„Bewertung zur Linsengleichung korrigieren"*, and *„Ja, Metadaten so übernehmen"*
/ *„Ich möchte die Metadaten korrigieren"*. Not a guarantee — a consequence of what the answer says.

The opening question benefits from this more than anything else does: it is a question with exactly two
answers, and the generator turns it into exactly two chips — *„Das ist mein eigener Inhalt"* / *„Das ist
ein fremder Inhalt"* in one run, *„Eigener Inhalt, von mir erstellt"* / *„Fremder Inhalt, den ich nur
einordne"* in another. The person taps rather than types, without the panel drawing a control for it.

**So the chip is asked for through the answer, which is the only lever there is.** Each of the three
tasks that end in a confirmation closes with the same line: end on the question, and name the confirming
answer word for word — *„Ich bestätige die Korrekturen."*, *„Ich bestätige die Bewertung."*, *„Ich
bestätige die Metadaten."* The assistant writes that sentence out as an *Antwortvorschlag*, the
generator reads it, and it comes back as the first chip, verbatim:

| step | chips |
|---|---|
| language pass | *„Ich bestätige die Korrekturen."* / *„Ich verwerfe die Korrekturen."* |
| judgement | *„Ich bestätige die Bewertung."* / *„Ich möchte die Bewertung korrigieren."* |
| enrichment | *„Ich bestätige die Metadaten."* / *„Ich möchte die Metadaten korrigieren."* |

**Writing the sentence out is what does it, not asking for it.** Measured against the same task with one
line changed — *„Stell die Frage so, dass „Ich bestätige die Bewertung." wörtlich darauf passt, aber
schreib diesen Satz nicht als Vorschlag aus"* — the answer still ended in **„Soll die Bewertung so
stehen bleiben?"**, and the chips came back *„Zeig mir weitere Infoblätter zur Optik"* / *„Erstelle ein
Arbeitsblatt zur Linsengleichung"*: the confirmation was gone. The generator works from the words in the
answer, so the words have to be there. The panel draws no chip of its own — there would be no way to put
its answer into the conversation as the person's anyway, since the widget forwards no `sendMessage` and
`startTask()` shows up under its own *„Auftrag der Seite"* label.

They are asked in turn rather than together because both run under the same iteration and token caps:
asked at once they compete for them, and whichever the model reaches last is the one that suffers.
Split, each gets a run and a schema of its own, and the second does not repeat the content — it is
the same conversation, and what the first task quoted is still in it. Measured against the deployed
backend, twelve criteria: judgement `submit` with 12 of 12 answered in ~27 s, classification `submit`
in ~10 s with three vocabulary lookups. The classification is the faster half precisely because the
first turn established the subject.

**Both tasks name `submit_result` outright**, and that is not decoration. Measured: the enrichment
task without it came back `stop_reason: "text"` — the run had answered in prose, the chat showed a
perfect enrichment, and `result` was `null`, so the panel had nothing. Asking for the closing tool by
name turned the same task into a `submit`. The extra tool calls a skill lookup costs make the drift
more likely, which is exactly where it showed up. Both tasks now say the same thing twice over: not
before the confirmation, and then in that very turn, because a confirmation answered with nothing but
a friendly acknowledgement leaves the step where it was.

**Switching the schema mid-conversation is supported** — the widget holds it in an effect of its own
and applies it from the next turn on. `AiAssistantScreenComponent.ask()` sets the new schema, then
sends the follow-up task **after a short delay**: the widget refuses anything put to it while it is
busy, and it is still busy at the instant it reports a result — `setLoading(false)` runs on the line
*after* the one that fires the event. A follow-up sent straight from the report would be dropped
without a word. Verified through the packaged bundle: two turns, both `submit`, the second answering
in the switched shape. The prompt carries only the *titles* of a collection's skills, so the
assistant has to fetch the one it checks against itself, and an unspecific task lets it answer from
memory instead.

Quoting the text is not redundant with `page_text`, and leaving it out is the second way this check
fails quietly. The backend renders the page context from whatever it resolved about the node, and the
block carrying the panel's own `page_text` is read **only where nothing resolved at all** — so the
better the node resolves, the more surely the text is dropped. What comes back then is a check that
knows the content's title, licence and thumbnail and answers every single criterion with "der
vollständige Text war nicht abrufbar". Measured on one content, three criteria, the same task:

| | verdicts |
|---|---|
| task without the text | all `false` — "der zugängliche Text enthält mehrere unvollständige bzw. abgebrochene Sätze" |
| task with the text quoted | all `true`, reasoned against the collection's compendium text |

The request is the one channel that always reaches the model, so the content travels in it, cut to fit
the 10 000 characters a message may hold. Where the panel holds no text at all — a node it did not
erschließen itself — the address takes its place, with the instruction to fetch it (`get_url_text`)
before judging; a check made on a title alone is worthless.

**The shape** (`resultSchemaOf()`) is an object with one entry per criterion, each `{erfuellt,
begruendung}`, every key required, plus `geeignet` — one boolean over the whole content — and a
summary. `geeignet` is required too, and it is the only place a collection's own requirements can land
where the metadata set holds no field for them: the criteria are what the repository can record, and
*für Bildung geeignet / ungeeignet* is what is left to say about everything else. An object rather than a list, because a list invites an answer
about the criteria that were easy to judge — and a check that quietly skipped half of them reads
exactly like a complete one. It stays far below the backend's limit of 10 000 characters; ten criteria
measure about 5 500. `schemaFits()` is what says so, since beyond the limit the backend refuses the
request outright rather than applying half a schema.

The schema's `description` texts are **prompt, not documentation**: they travel verbatim into the
parameters of the assistant's `submit_result` tool and are read by the model as instructions. They are
written as such — and the criteria captions in them come from the repository's own metadata set, which
is also what the check is supposed to measure against.

**The answer back.** `verdictsOf()` reads the result defensively: it comes from another project
through a schema that constrains but does not guarantee, and an entry without a boolean verdict is
dropped rather than read as "not met". `criteriaPropertiesOf()` then turns the verdicts into the very
properties the structured check writes — a met knock-out criterion as the machine's all-clear where
its valuespace states one, exactly as a judge's finding is recorded, because the assistant *is* a
machine and a box claiming a person's confirmation would say more than happened.

The finished result is both halves together — what the content is worth and what it is about — logged
as one line when the second answer lands. That is also what the step's way on waits for: the footer
offers *Abschließen und zur Inhaltsübersicht* once the quality is judged **and** the metadata
enriched (`qualityCriteriaJudged` and `qualityMetadataEnriched`), writes the confirmation, and leaves
the flow. A content judged but never described is half done, and the button says so by staying shut.

Which raises the question the gate creates: **what if a step never lands?** A turn that submits nothing
is the ordinary case here — the assistant has proposed and is waiting to be confirmed — so the panel
does not read it as a failure and does not ask again. An earlier version did, and the nag would now
fire on exactly the turn that was doing the right thing. Only a run that ended badly says anything
above the chat (`deadline`, `token_budget`, `max_iterations`, `no_progress`, `error`). The way out is
the conversation itself: any later turn that submits lands in the same handler and opens the button.
**The enrichment is recorded on the node**, the same way the verdicts are: `enrichmentPropertiesOf()`
turns it into the very properties the metadata step writes, and `recordValues()` has them travel with
the confirming save. The person went through these values in the chat and confirmed them, which is
what makes them the content's rather than a proposal about it.

Which property a value goes to is decided by **the vocabulary its URI came out of**, not by the field
it was answered under — each of these properties holds the values of exactly one vocabulary:

| answered | vocabulary | property |
|---|---|---|
| `fach` | `discipline` | `ccm:taxonid` |
| `bildungsstufe` | `educationalContext` | `ccm:educationalcontext` |
| `materialtyp` | `new_lrt` | `ccm:oeh_lrt` |
| `materialtyp` | `new_lrt_aggregated` | `ccm:oeh_extendedType` |
| `schlagworte` | — | `cclom:general_keyword` |

*Materialtyp* is why it has to work that way. Asked for `lrt`, `lookup_wlo_vocabulary` answers out of
either vocabulary — measured, it came back
`…/vocabs/new_lrt_aggregated/c8e52242-361b-4a2a-b95d-25e516b28b45` for *Arbeitsblatt* — and on the node
those are two separate fields. A URI out of any other vocabulary is not recorded at all: it would sit
in a field whose valuespace does not contain it, where the editor shows a blank and no search finds
it. The value stated is the URI alone, since that *is* what a vocabulary property holds; the label is
what the editor renders from it.

The keywords are the one list that is **added to** rather than replaced: they come from the same
reading of the same text as the ones the extraction proposed, the two overlap without being the same,
and a keyword both lists hold keeps the spelling the content already carries.

What the screen does with the judgement is the same pair of statements the structured check's view
makes:

```ts
this.curation.recordValues(properties);
this.curation.reportQualityCriteria(knockoutSatisfied(judged, this.criteria()));
```

So the footer offers the same *Qualität bestätigen*, and the confirmation is the same write either
way (`CurationService.confirmQuality`): the recorded criteria and the workflow status
`ELEMENT_LEGALLY_APPROVED` travel to the node in one save.

**What it waits for is different, though.** The structured check opens its confirmation once the
knock-out criteria are met, because there the ticked boxes *are* the person's decision. Here the
assistant answers every criterion, including the ones it found wanting, and its answer is a proposal —
so the button opens as soon as an answer is in (`qualityCriteriaJudged`), and confirming or declining
it is the person's call. `qualityCriteriaMet` is still reported truthfully beside it, since the
structured flow hangs its own Metadaten sub step off that.

**The result is shown in the chat, by the assistant itself.** Nothing can inject a message into that
conversation from outside — so the task asks for it: a line per criterion with ✓ or ✗, the criterion
and the reason, then a short verdict on what stands in the way of a release, and then the question
that ends the step. The person sees only the chat, so what is not written there is not known. The panel draws nothing beside it; a second rendering
of the same answer would only compete with the first. What the panel keeps goes to the console.

### Following a check in the console

Everything about this integration is asynchronous — the bundle, the widget's own boot, the answers —
and when a chat stays empty the only question worth asking is which of them happened before which. So
both components trace, and the two prefixes read as one sequence:

- `[edu-sharing][boerdi]` — the conversation. Every line carries `+<ms>` since the screen opened, `→`
  for what goes to the widget, `←` for what comes back. Every attribute is logged as it is set, whole
  and unabbreviated: each is read once as the element connects and never again, so they are what the
  conversation runs on for as long as it lasts.
- `[edu-sharing][quality]` — the check. What it is about, how many criteria were read and under which
  keys, the schema with its character count, the task verbatim, and every answer.
- `[edu-sharing][write]` — what reaches the node. Every property by name and value, the node it goes
  to, whether it is created or updated, which route (`agent` or `repository`), the workflow steps that
  travel with it, each workflow status as it is written and to whom, and how the write ended. A
  confirmation logs first what it stands on: the recorded criteria, whether the knock-out gate is
  satisfied, and whether an assistant judged them.

A check that goes to plan reads roughly like this:

```
[edu-sharing][quality] the check is about {title, nodeId, collection, url, textLength, context}
[edu-sharing][quality] reading the criteria from mds_oeh
[edu-sharing][quality] 10 criteria read {knockout: […], editorial: […], keys: {k1: 'ccm:oeh_quality_…'}}
[edu-sharing][quality] the answer is asked for in this shape {criteria: 10, characters: 5558, schema}
[edu-sharing][quality] the assistant will be asked this
  Prüfe den Inhalt „…" anhand der Anforderungen der Sammlung „…". …
[edu-sharing][boerdi] +0ms screen opened {apiUrl, hasTask: true, hasResultSchema: true}
[edu-sharing][boerdi] +1ms bundle ready, <boerdi-chat> defined
[edu-sharing][boerdi] +2ms → api-url = https://87.106.127.225.nip.io
[edu-sharing][boerdi] +2ms → result-schema = {"type":"object",…}
[edu-sharing][boerdi] +2ms → engine = agent
[edu-sharing][boerdi] +2ms page-context left unset — the page follows with the task
[edu-sharing][boerdi] +3ms → <boerdi-chat> appended, the widget now boots
[edu-sharing][boerdi] +3ms waiting for the conversation before opening it {reason: 'the screen states a task'}
[edu-sharing][boerdi] +154ms <boerdi-chat-shell> on screen after 150ms
[edu-sharing][boerdi] +154ms → replaceContext (opening) {page_kind: 'content', node_id, collection_id, …}
[edu-sharing][boerdi] +155ms → startTask (612 characters)
  Prüfe den Inhalt …
[edu-sharing][boerdi] +30512ms ← agent-result (turn 1) after 30357ms {stopReason: 'submit', submitted: true, result}
[edu-sharing][quality] ← the assistant judged 10 criteria this turn {thisTurn, standing, recorded, knockoutSatisfied}
```

What each of the three failure modes looks like in that trace: a task that never went out ends after
`→ <boerdi-chat> appended` with a warning that `<boerdi-chat-shell>` never rendered; a schema that did
not take shows `← agent-result` never arriving at all; a run cut off by a cap shows it arriving with
`stopReason` other than `submit` and `submitted: false`.

Three details that are easy to get wrong:

- **Every turn reports**, so the verdicts of a later turn are laid *over* the standing ones rather
  than replacing them. A follow-up question is usually about one criterion, and taking that answer as
  the whole result would drop every other criterion from the record and close the confirmation again.
- **A turn without verdicts changes nothing** but the note above the chat — someone thanking the
  assistant must not clear a judgement that stands.
- **The chat waits for the criteria.** Task and schema are read as the element mounts, and it mounts
  once; a chat started before the metadata set answered would stay a plain chat for good. Hence the
  `@if (settled())` around it.

### One layout rule worth keeping

`.es-chat-host` in `ai-assistant-screen.component.scss` carries `contain: layout`, and that is
load-bearing: below a 480 px viewport the widget switches its panel to `position: fixed`, and without
that containing block the chat covers the whole panel.

## Three things called a check

| | What it is | Where |
|---|---|---|
| **Strukturierte Qualitätsprüfung** (`quality`) | fixed steps: work through the criteria, confirm, then metadata; writes the quality workflow onto the node; KI only proposes | `features/quality/quality-check-screen/`, `features/quality/quality-criteria/` |
| The machine judges underneath | no chat at all, plain HTTP scoring: MetaLookUp measures (on by default), ContentJudge runs an LLM pass per scheme (off by default, needs a credential); started right after the content was analysed and read steps later | `services/quality-judge.service.ts`, `metalookup.service.ts`, `content-judge.service.ts`, `util/quality-schemes.ts` |
| **Individuelle Qualitätsprüfung mit KI** (`ai-quality`) | a dialogue with the assistant about the content and its collection, opened with the criteria as its task and answered in a schema built from them; a greeting that asks whose content it is, a language pass on one's own content, then judgement and enrichment, each confirmed by the person in the chat, ending in the same record and the same confirmation as the structured check | `features/quality/ai-quality-screen/`, `util/quality-check-request.ts` |

What separates the first from the last is exactly that it runs through fixed steps — which is why it
is called the structured one rather than the guided one.

## The backend side

### Skills — what `collection_id` sets off

A WLO skill lives neither in the chatbot's repository nor in its database. It is a node **in the
edu-sharing repository**, of content type `ai_skill`, with a `SKILL.md` attached. The chatbot reaches
it only through MCP tools on a separate server:

- `get_skill_registry(collectionId)` — the skills released for a collection, titles plus `nodeId`
- `get_skill(nodeId)` — the full markdown of one instruction
- `search_skill(…)` — a catalogue search, no longer offered on any path

Stating `page_kind: 'collection'` (or `'topic'`) **together with** `collection_id` triggers a
prefetch: the material count and an overview of the released instructions go into the prompt, under
both engines. It is capped at 100 titles and about 3500 characters.

**The prompt carries titles only, no `nodeId`s** — with ids the same 100 entries would roughly double
in size. The model has to walk `get_skill_registry` → `get_skill` itself, which has a direct
consequence for this panel: a vague instruction ("have a look at this") lets it skip that step
entirely. Asking for the collection's instruction explicitly is what makes the check run against the
skill; `tools_called` has to contain `get_skill` for it to have happened. Without a matching
instruction the chatbot's own pattern for quality assurance applies, and where a skill does apply it
takes precedence over the deterministic shortcuts.

A topic page is the same thing as a collection here: `page_kind: 'topic'` with the same
`collection_id` reaches the same instructions.

Not to be confused: `skills-lock.json` and `.claude/skills/` in this repository are Claude Code
skills and have nothing to do with any of this.

### The endpoints the widget calls

`/api/chat` and `/api/chat/stream` (SSE), `/api/config/guide-mode`,
`/.well-known/oauth-authorization-server` and `/widget/oauth`. The chat endpoints are **public, with
no authentication** — usable anonymously, which is how the panel uses them. Also public:
`/api/sessions/{id}/messages` to restore a transcript, `/health`, `/api/health`, `/api/speech/*`.

`GET /widget/boerdi-widget.js` answers **302** to a content-hashed `boerdi-widget.<hash>.js` (the
stable URL `no-store`, the hashed one `immutable`) and **503** rather than 404 when the bundle is not
built, naming the build command in the detail.

### The second route, unused here: `POST /api/agent`

An agent run without any UI, returning prose **and** structured JSON; `/api/agent/stream` gives it as
SSE phases (`connected`, then any number of `phase`, then `result` or `error` — no `end` frame and no
tokens).

The request takes `instruction` (required, up to 20 000 characters), `collection_id`, `node_ids` (up
to 50), a free-form `result_schema`, `write_mode` (`propose` or `execute`), `allow_curation` (true by
default) and `locale`. The response carries `text`, `result`, `stop_reason`, `iterations` and
`tools_called[]`. `stop_reason` is one of `submit`, `text`, `deadline` (90 s), `token_budget`,
`max_iterations` (12), `no_progress`, `error` — and `result` is only dependable on `submit`.

Authentication is tried in order: `AGENT_OPEN=true` in the environment (off by default), then a
`WLO-Access-Block` header carrying a *personal* login — the route meant for plugins, the anonymous
block does not count — then `X-Studio-Key`, which is the admin key and has no business in a browser.
That header is deliberately absent from the OpenAPI document. Throttling is 20 requests per minute
per IP by default, answering `429` with `X-RateLimit-*` headers, so agent runs belong on explicit
user actions rather than on navigation.

### Writing into edu-sharing

Anonymously the assistant may classify but not write: `wlo_suggest_metadata` and the fourteen
curating tools are not even placed in its catalogue without an access block. A plugin is not supposed
to pass a `JSESSIONID`, and the backend does not accept one. The `ticket` attribute is the shape for
"the repository embeds the widget itself" and is not reachable from a browser extension.

### CORS

`allow_origins` is `CORS_ORIGINS` split on commas, defaulting to `*` with a startup warning. An
extension's origin is `chrome-extension://<id>`; this panel is covered by its MV3 `host_permissions`
anyway, so the extension context bypasses CORS. Should the origin ever be listed there, note that the
entries are **not** trimmed — no space after the comma.

## Manifest, CSP, packaging

- `manifest.base.json` lists `"boerdi/*"` under `web_accessible_resources` for `https://*/*` and
  `http://*/*`. That is the only boerdi-specific line in any manifest.
- Its `extension_pages` CSP is what forces the packaging: `script-src 'self'`. `connect-src` allows
  `https:` and `http:` wholesale, which is how the calls to the chat backend are permitted — the host
  is named nowhere in the policy, and `host_permissions` covers it just as broadly.
- `scripts/build.mjs` copies `scripts/boerdi/` to `dist/<target>/boerdi/` as one of `BUNDLE_DIRS`,
  with no exclusions; `SHARED_DIRS` brings `icons/boerdi.svg` along. See [BUILD.md](BUILD.md).
- `config.js`, `app-src/src/app/config.ts` and `sw.js` have no chatbot reference at all.
  `toTopicAssistantUrl` in `config.ts` is the repository's own B-API topic assistant, used for
  collection recommendations — a different thing entirely.
- `web-ext lint` reports six third-party warnings for `boerdi/boerdi-widget.js`; see
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Refreshing the bundle

```bash
node scripts/fetch-widget.mjs https://87.106.127.225.nip.io   # the deployed backend
npm run build:chrome     # without this the new bundle never reaches dist/
# then hit "Reload" in chrome://extensions
```

The script pulls `<base>/widget/boerdi-widget.js` into `scripts/boerdi/boerdi-widget.js`. It refuses
an answer that is HTML rather than JavaScript, because a 200 carrying an error page would be worse
than a 404 — the file would be there and fail only later, with a syntax error nobody traces back. A
503 means the bundle is not built in the backend (`cd frontend && npm run build:widget` in its
repository). Over plain `http` on a foreign host it warns but does not refuse.

**There is no checksum and no signature.** Whatever arrives runs with the extension's privileges
afterwards, so the source is the whole of the security.

One trap: the script defaults to `http://localhost:8000`, while the backend's dev compose serves
**8100**. Locally, pass `http://localhost:8100`.

## Weak points

1. **`CHAT_API_URL` is a hardcoded nip.io address** inside a feature component. It is not
   configurable per repository or deployment, although the repository URL and the agent proxy both
   are, and it is duplicated as an example in two more places (`scripts/fetch-widget.mjs` and
   [WEB-COMPONENTS.md](WEB-COMPONENTS.md)).
2. **No integrity check** when the bundle is pulled, and it runs unsandboxed in the sidebar document
   afterwards.
3. **Three untyped foreign names** hold the integration together: the tag `boerdi-chat`, the inner
   tag `boerdi-chat-shell` looked for by `querySelector`, and the storage key `boerdi_session_id`. A
   missing context method is at least logged; a renamed shell tag surfaces only as a ten-second
   timeout.
4. **The visibility flag belongs to another bundle.** Both entry points hang off
   `browserExtensionCustomWebComponent`, the WLO canvas's flag, because the assistant ships with that
   bundle — `model/navigation.ts` says so explicitly.
5. **Nothing checks that the check ran against the skill.** The task asks for the collection's
   instruction outright, but whether the model actually fetched it shows only in `tools_called`, and
   that needs `emit-routing-debug` — which is not set and not read. A check that answered from memory
   is indistinguishable here from one that followed the editorial instruction.
6. **Only the first collection is handed over**, deliberately, since one skill is what the assistant
   works with. A content filed in several collections shows the chat only one of them, and there is no
   UI in which to choose which.
7. **An unsaved content is checked without its collection.** No node means no id in the context at
   all, or the collection would become the subject — so the assistant has to find the collection by
   the name in the task, and may find the wrong one or none.
8. **The return channel carries one thing.** `boerdi:agent-result` is read; the other four events are
   not. `boerdi:page-action` and `boerdi:query-meta` are dispatched on every turn and would say what
   the assistant looked at, which is the evidence point 5 is missing.
9. **Every turn costs an extra model pass** once a schema is stated — measured at 2 to 9 seconds, and
   30 for a ten-criterion schema. It is charged to "Danke!" as much as to the check itself, because
   the schema belongs to the embedding rather than to the message.
10. **[FEATURES.md](FEATURES.md) lags behind** in three places: it still calls the structured check
    the *geführte* one, still describes the KI screen as "still to be built", and still presents the
    assistant as a chat about the open tab only, without the `context` input this file documents.

## What is still open in the KI check

The check runs and its result is recorded — [see above](#the-check-as-a-task). What follows are three
steps that are **not** implemented, ordered by what they return for the work they cost. Each stands on
its own.

### 1. Give the dialogue the judges' findings

MetaLookUp has usually measured the content by the time this screen opens — `judgeQuality()` runs
right after the analysis, and `QualityJudgeService.measured()` / `evaluation()` hold the result. That
is measured fact the model currently cannot see, so it re-derives worse versions of it in prose.

Folding a short digest of the finished judgements into the task costs one injected
service and a formatter. It belongs there rather than in `page_text`: `page_text` is the content
itself and is capped at `CONTENT_TEXT_MAX`, and a judgement is not part of what is being judged. Only
send what is actually `done` — a digest that reports a `failed` judge as a finding is worse than no
digest.

### 2. Let the user pick the collection

`filedCollections()[0]` wins silently today. Where the list holds more than one, the screen should let
the user choose which collection's requirements apply, in the place the "no collection" warning
already occupies. One collection stays the rule — one skill is what the assistant works with — but
which one is a decision, not an array index.

### 3. Show what the check actually did

The verdicts are recorded, but nothing shows what they rest on. `boerdi:query-meta` and
`boerdi:page-action` are dispatched on every turn without any opt-in, and `emit-routing-debug` adds
`tools_called` — which is the one thing that says whether the collection's instruction was fetched at
all. Listening costs a handler apiece; every event fires twice (`boerdi:…`, then `badboerdi:…`), so
only the first name is heard.

### What not to do

`POST /api/agent` looks like the natural fit for a one-shot check and is not one here. It needs a
`WLO-Access-Block` header with a *personal* login, which this panel does not have — anonymous does not
count — and it is throttled to 20 requests per minute per IP. The widget's own chat endpoints are
public and are what the panel is built on. Keep the check inside the widget.

### How to tell it worked

Not by reading the answer — a fluent answer proves nothing about the skill. Turn `emit-routing-debug`
on and check that `tools_called` contains `get_skill`. Without it the model answered from the prompt's
list of titles, and the collection's requirements never entered the dialogue.
