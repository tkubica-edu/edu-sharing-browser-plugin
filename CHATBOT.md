# The chatbot — how the KI assistant is embedded

The panel's KI assistant is a **separate project**: `edu-chatbot-sc`. In this repository it is called
**boerdi** throughout — no identifier, tag, attribute or storage key is named `chatbot`, only a handful
of comments say the word, so this document is where a search for it lands. Everything named `boerdi-*`
belongs to it.

It is embedded as a **real custom element in the sidebar document, not an iframe**, and it is the only
one of the three packaged bundles that talks to a backend of its own.

- [Where it comes from](#where-it-comes-from)
- [How it is embedded](#how-it-is-embedded)
- [The contract surface](#the-contract-surface)
- [The page context](#the-page-context)
- [Where it appears in the UI](#where-it-appears-in-the-ui)
- [The seam the bundle offers](#the-seam-the-bundle-offers)
- [Correcting the widget from outside it](#correcting-the-widget-from-outside-it)
- [Three things called a check](#three-things-called-a-check)
- [The backend side](#the-backend-side)
- [Manifest, CSP, packaging](#manifest-csp-packaging)
- [Refreshing the bundle](#refreshing-the-bundle)
- [Weak points](#weak-points)
- [What is still open in the KI check](#what-is-still-open-in-the-ki-check)

The **data contract** on top of this — every context field, every task, every result schema and the node
properties an answer is recorded in — is [CHATBOT-IO.md](CHATBOT-IO.md).

**Keeping this file current.** It describes `app-src/src/app/features/assistant/`,
`app-src/src/app/features/quality/ai-quality-screen/`, `app-src/src/app/util/chat-session.ts`,
`app-src/src/app/util/chat-overrides.ts`, `app-src/src/app/services/chat-style.service.ts`, the
`boerdi` branch of `app-src/src/app/services/web-component-bundle.service.ts`, `scripts/boerdi/` and
`scripts/fetch-widget.mjs`. A change to any of those belongs here as well.

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
**only** place in this codebase that knows the chatbot — apart from `app-src/src/app/util/chat-session.ts`,
which holds the two storage keys of a conversation so a screen can end one. Everything either of them
depends on is a name from the other project, held in a constant at the top of the file:

| Constant | Value | What it is |
|---|---|---|
| `CHAT_TAG` | `boerdi-chat` | the custom element |
| `LOG` | `[edu-sharing][boerdi]` | prefix of every chat diagnosis in the console |
| `CHAT_API_URL` | `https://87.106.127.225.nip.io` | the backend, hardcoded |
| `SESSION_KEY` | `boerdi_session_id` | where the widget keeps the session it resumes (`util/chat-session.ts`) |
| `HINT_KEY` | `boerdi_owl_hint_session` | which session the widget last showed its intro hint for (`util/chat-session.ts`) |
| `SHELL_TAG` | `boerdi-chat-shell` | the element the conversation renders in, looked for in the shadow root |
| `SHELL_TIMEOUT_MS` / `SHELL_POLL_MS` | 10 000 / 50 ms | how long, and how often, that element is waited for |

### The attributes set on mount

`mount()` creates the element **imperatively** and sets every attribute **before** `appendChild`,
because the widget resolves its context as it connects. Which attributes the panel sets, with what
value and for which reason, is
[CHATBOT-IO.md § The configuration attributes](CHATBOT-IO.md#2-the-configuration-attributes); what
matters here is *when* each of them is read.

The widget divides them into three classes by when they take effect:

- **read only at start** — `api-url`, `page-context`, `auto-context`, the `persist-session*` family,
  `size`, `ticket`. This is why the order above is load-bearing: an attribute of this class set after
  `appendChild` never arrives at all.
- **read on a chat restart** — `greeting`, `start-replies`, `show-welcome`.
- **read immediately** — `engine`, `language`, `theme`, `primary-color`, `embed-mode`. Together with
  `result-schema`, `quick-replies` and `quick-replies-max`, whose own effects are held in effects of
  the widget's, these are the ones a screen may change mid-conversation.

`auto-context='false'` is the heart of it: the panel is not the page, so the widget's own detection
would contribute the extension's address rather than the tab's. Its URL watcher never fires either —
the panel's own address does not change while the tab it shows does.

The element is sized inline rather than from the stylesheet because an imperatively created element
carries no view-encapsulation attribute, so this component's styles would not match it. Frameless it
fills 100 % of its container in both directions, which means a container without a height leaves it
silently 0 px tall — hence `min-height`.

`master-skill` is the one attribute that is written **conditionally**, because absent and empty are
not the same thing to it: `ChatSkillService.masterSkillAttribute()` returns `null` for the state that
defers to the operator, and the attribute is then never set — an empty value would be read as that
same state by this version of the widget only.

With a task stated, `page-context` is *not* set here at all; the page is handed over afterwards
instead, and the reason is below.

Attributes the widget also understands and this app does not set: `ticket`, `size`, `position`,
`theme`, `show-cards`, `primary-color`, `greeting`, `start-replies`, `show-welcome`, `language`,
`trusted-domains`, `persist-session`, `session-key`, `session-cookie-domain`,
`session-cookie-max-age`, `intercept-edu-sharing-links`, `inline-result-grouping`.

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

### What the widget reports back

Six `window` CustomEvents since the bundle of 2026-08-26, dispatched with `bubbles: true, composed:
true` — needed because the widget renders into a shadow root. Five are heard here (`REPORTED_EVENTS`
plus the result); the sixth, `boerdi:tool-call`, belongs to the widget's local engine and nothing here
provides one yet — see [The seam the bundle offers](#the-seam-the-bundle-offers). What each of them
carries, and which one the panel acts on rather than merely traces, is
[CHATBOT-IO.md § The outputs](CHATBOT-IO.md#the-outputs).

Three things about the listening rather than the payloads:

- **Every event is dispatched twice** — first `boerdi:…`, then `badboerdi:…` for the predecessor
  system. `AiAssistantScreenComponent` listens to the first name only; listening to both would
  process — and log — every answer twice.
- **The listeners sit on `window` under the plain event names**, so whatever dispatches them is
  traced the same — the widget, or something standing in for it while the development mode is on.
- **Two of them are silent unless asked for**, and are asked for: the screen sets
  `emit-guide-suggestion="true"` and `emit-routing-debug="true"`. Neither changes what the chat does.

The only `postMessage` anywhere in the chatbot's code is its own OAuth PKCE popup channel for the MCP
login. It is not a bridge to the extension. The panel's own `postMessage` traffic — the panel host's
iframe, the OnlyOffice plugin channel — has nothing to do with the chat; see
[ARCHITECTURE.md](ARCHITECTURE.md).

## The page context

`app-src/src/app/util/page-context.ts` deliberately mirrors the widget's wire format, snake_case and
all. Every field, both builders and their two limits are
[CHATBOT-IO.md § The page context](CHATBOT-IO.md#1-the-page-context); `sameSubject()` is what decides
merge against replace, and the widget additionally knows `search_filters`, while `home` vs. `external`
is decided by the **server** from a host list rather than sent from here.

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
| `page_kind: 'other'`, no `node_id` | `search_wlo_collections`, `get_skill` | "der **sichtbare Seiteninhalt**" — the text handed over |

So the node leads: with a `node_id` the context is that content, which the backend resolves with
`includeTextContent`. Without one the page identity is withheld — `page_kind: 'other'` and no
`node_id` — and the title and text reach the model as the page's own text instead
(`contentContextOf`). The collection travels either way, since it is what the skill is fetched by and
not an answer to "which page is this". The instruction says the same thing once more in words
("Gemeint ist genau dieser eine Inhalt … Beurteile NICHT die übrigen Inhalte der Sammlung"), because
saying it twice costs nothing and this is what goes wrong.

## Where it appears in the UI

One widget, one component, two screens that differ only in the context they state.

### The assistant's own screen — about the open tab

`AiAssistantBarComponent` offers it as a row above the session bar: the whole row is the button, with
the `icons/boerdi.svg` avatar and *Frage stellen*, and `ask()` navigates to the `ai-assistant`
section. The row appears only while `browserExtensionCustomWebComponent` is enabled, a session
exists, no login gate is up, and the panel is not already on that screen; it is disabled while a
write is running (`BusyService`).

The section itself is `plain` and carries no `menu: true` — that row is the only way in. Its context
is `pageContextOf(conditions.activeUrl(), conditions.activeTitle())`, the builder for an open tab.

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

Every value in it comes from `CurationService`, which is what makes this screen's context the *content*
rather than the tab it happens to be read on — `filedCollections` are the editorial and personal
collections it was filed in, deduplicated, as `{ id, name }`. Which node property each value is read
from is [CHATBOT-IO.md § The facts inside a task](CHATBOT-IO.md#3-the-facts-inside-a-task).

**Both screens share one conversation** — the session lives in local storage, so a chat resumes wherever the
widget is mounted next, with a `replaceContext` rather than a fresh start. Which is why the KI check ends it
at both its edges (`util/chat-session.ts`, `resetChatSession()`):

- **On entry**, in `FlowChoiceScreenComponent.open()` — where the check is *started*, not in the step itself:
  the panel is rebuilt on every page change and the step is re-entered with it, so a dialogue under way has to
  survive that. Without this the previous conversation — the bar's, or an earlier check's — is still on screen
  when the check opens.
- **On the way out**, both ways. Walking back asks first: `AiQualityScreenComponent` registers a
  `LeaveGuard` with `NavigationService`, which `back()` consults — one guard for both back buttons, the
  topbar's and the footer's, since both make the same walk. Confirmed, the session is ended with it. Finishing
  the check ends it too, in the `ai-quality` footer action once `confirmQuality()` held.

Nothing is asked before the widget has a session of its own: there is no dialogue to lose yet.

#### The check as a task

The check is put as tasks with a schema rather than left to a chat, because its dialogue has to end in
the record the structured check writes: four requests and a closing word, each answered in a shape the
panel can read back. What each task says, what each schema asks for, which chips stand under it
and where an answer is recorded is [CHATBOT-IO.md § The tasks](CHATBOT-IO.md#the-tasks). What follows
is what the embedding has to do for any of it to arrive.

**The chat waits for the criteria.** Task and schema are read as the element mounts, and it mounts
once — a chat started before the metadata set answered would stay a plain chat for good. Hence the
`@if (settled())` around it.

**The schema is switched mid-conversation**, once per step, which the widget supports: it holds the
schema in an effect of its own and applies it from the next turn on. `AiAssistantScreenComponent.ask()`
sets the new one and sends the step's task **after a short delay**, and that delay is not caution. The
widget refuses any message put to it while it is busy, and it is still busy at the instant it reports a
result — `setLoading(false)` runs on the line *after* the one that fires the event. A follow-up sent
straight from the report would be dropped without a word. Verified through the packaged bundle: two
turns, both `submit`, the second answering in the switched shape.

**`engine="agent"` stands for the whole check, not only for the turn that carries a task.** The
attribute travels to the backend as the header `X-Boerdi-Engine` and the routing is decided per
message: without it a short *„Ich bestätige das Urteil"* is taken for ordinary chat — measured, it was
answered by an unrelated skill and submitted nothing, while the same turn with the header came back
`submit` with all twelve criteria. So the panel sets it together with the schema and leaves it
standing.

**The chips are an attribute the panel writes** (`quick-replies`, set per step from `STEP_REPLIES`),
and that is the only channel it has for them: the widget forwards no `sendMessage`, and `startTask()`
shows up under its own *„Auftrag der Seite"* label, so there is no way to put an answer into the
conversation as the person's. Which chips each step prescribes, and what the widget composes when it is
left to itself, is [CHATBOT-IO.md § The chips](CHATBOT-IO.md#the-chips).

### Following a check in the console

Everything about this integration is asynchronous — the bundle, the widget's own boot, the answers —
and when a chat stays empty the only question worth asking is which of them happened before which. So
the components trace, and every `[edu-sharing][boerdi]` line carries `+<ms>` since the screen opened,
`→` for what goes to the widget and `←` for what comes back. Attributes are logged whole and
unabbreviated, since each is read once as the element connects and never again. What the other
prefixes carry is
[CHATBOT-IO.md § Following it in the console](CHATBOT-IO.md#following-it-in-the-console); the sequence
is what this file is for.

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

## The seam the bundle offers

The bundle packaged here since **2026-08-26** carries a second engine: `engine="local"`, answered by a
model in this document instead of by the chat backend. It brings no model with it. Both the model and
the tools come from **the host** — this panel — through a seam the widget asks for, and without one the
widget stays on its HTTP path.

**The panel provides one, experimentally**, behind a setting that is off by default (`HostSeamService`,
the checkbox *Chat auf diesem Gerät beantworten (experimentell)* in the KI section). Switched on,
`AiAssistantScreenComponent.mount()` sets `engine="local"` and hands the seam over; switched off,
nothing is registered and the attribute is not set either — the two belong together, since the
attribute without a seam is a chat that answers nothing.

Why the model is the host's business: a WebLLM runtime is some 12 MB plus a module worker, the same
bundle is also served from the chatbot backend, and under `script-src 'self'` an extension page loads
none of it after the fact. Whoever has the runtime has it in their own package. The same holds for the
tools — they need the repository session, which this panel has and the widget does not.

### How it is provided

```ts
element.setHostSeam({
  protocol: 1,
  llm: { label, ready, progress, complete, interrupt },   // without this, no local engine
  tools: { catalogue, invoke },                            // optional; without it, no lookups
});
element.hostCapabilities();   // → { protocol, engines[], hostLlm, hostTools }
```

Both are methods on the upgraded element, called in `mount()` right after `appendChild` — and the
panel additionally answers the widget's own `boerdi:host-seam` request, which it installs *before*
`appendChild` because the widget asks as it connects. `util/host-seam.ts` mirrors the contract,
`HostSeamService` fills it in: `LocalLlmService` is the model (WebLLM in a packaged module worker, see
[BUILD.md](BUILD.md)), and the tools are the panel's own.

**The catalogue is one tool today.** `get_url_text` reads the open page — something the panel does for
every extraction anyway, so it carries no open question. The repository tools (`get_skill_registry`,
`get_skill`, `lookup_wlo_vocabulary`) are missing, and they are what the KI check's tasks ask for by
name: how a skill node is found per collection is answered in the other project's plan (§ A1) but not
yet measured against a live repository. Until it is, a local check judges against the criteria of the
metadata set alone.

### Reading the trace

`[edu-sharing][boerdi] → setHostSeam, and the widget answers {…}` says whether the switch took: `local`
among `engines` means the widget accepted the model. Without it the seam was refused — a protocol
mismatch, or a model that failed the shape check — and the chat stays on the backend, which is warned
about rather than left to be guessed. `[edu-sharing][seam] → ready` / `← ready after …ms` /
`✗ ready failed: …` is the model's loading, `→ complete` / `← complete` one turn, and
`← get_url_text(…)` one tool call. What went wrong reaches the conversation as well, in words: a model
that cannot be loaded says so in its own bubble rather than answering "incomplete".
`hostCapabilities().engines` names `local` only where a usable model is registered, which is how a
panel tells "this bundle is too old" from "my seam did not take". A host that does not own the element
answers the `boerdi:host-seam` event instead, **synchronously inside the listener**.

Three rules the contract does not bend on, because a 4-bit model does not bend either: a tool takes
exactly **one string argument** (its `syntax` describes it, the host splits it), a tool returns **text
and truncates it itself**, and a failure is a **value** (`{ok: false, reason, text}`) whose `text` is
the German sentence the model gets to read. The full contract, the tool loop and the reasoning are in
the other project: `docs/plans/2026-08-25-lokale-engine-und-host-werkzeuge.md` and
`frontend/projects/ui/src/host-seam/host-engine-seam.ts`.

### The one thing already used: `initiated_by`

`boerdi:agent-result` now says whose turn an answer belongs to (`user` / `host`), and carries
`tools_called[]` beside it. The KI check reads the first and refuses to move a step on without a turn
of the person's — see [CHATBOT-IO.md § The gates](CHATBOT-IO.md#the-gates) for why a confirmation the
model writes about the person is not evidence. A bundle without the field keeps the previous
behaviour, and the panel says so once in the trace.

### What is not in the panel

There is no local chat of the panel's own. An earlier attempt built one — a component beside the widget
with its own prompt assembly and transcript — and it was dropped when the engine moved into the widget:
two chat implementations in one panel is one too many, and the widget's has the tool loop, the schema
turns and the whole turn lifecycle already. Of that attempt only the runtime survives,
`LocalLlmService`, which is what the seam hands over.

## Correcting the widget from outside it

`util/chat-overrides.ts` puts a stylesheet of the panel's own **into the widget's shadow root**, and
that is the only place it can go: the widget's root component renders with
`ViewEncapsulation.ShadowDom`, so its whole view sits behind that boundary and a document-level rule
reaches nothing. `installChatOverrides(element)` waits for the root rather than assuming it — the root
is created when the element is upgraded, which is not guaranteed to have happened by the time the
element is in the document — and appends the sheet **last**, after the widget's own, so an equally
specific rule of ours wins on order. The wait is bounded (10 s), so a bundle that never upgrades costs
a stylesheet rather than a running interval. `ChatStyleService` holds the switch that turns the whole
sheet off, which is how the widget can be seen as it ships — what a report about it has to be made
against.

**Two of the corrections are marks, not rules**, because CSS cannot say them, and a `MutationObserver`
over the shadow root puts them on. It watches added rows *and* character data, since an answer keeps
writing under a row while it streams; marking is idempotent and reads only what is already in the DOM.

- **The verdict glyph of a criterion line.** The check asks the assistant for a line per criterion
  beginning with ✓, ✗ or ○, and no selector can read text — nor is there anything to address, the glyph
  arriving as a bare text node. So it is wrapped in a span of its own and given, with the criterion's
  bold name, the class of that verdict: green, red, and amber for the undecided one, which is a verdict
  to come back to rather than a missing one. Neighbouring glyphs count as the same verdict (✔, ❌), and
  a line beginning with prose is left in the text colour.
- **Whether an answer has been overtaken** by the panel's next instruction — its notice and its chips
  are then no longer what the person is being asked. `:has(+ .message-row.user-row .host-bubble)` is
  exactly that condition and was how it was said, but the condition turns true through a change deep
  inside the *following* row, and Safari does not reliably re-style the earlier one for it. The observer
  is told about those very changes, so the mark is put on where CSS was asked to notice it.

`.es-chat-host` in `ai-assistant-screen.component.scss` carries `contain: layout`, and that is
load-bearing too: below a 480 px viewport the widget switches its panel to `position: fixed`, and
without that containing block the chat covers the whole panel.

## Three things called a check

| | What it is | Where |
|---|---|---|
| **Strukturierte Qualitätsprüfung** (`quality`) | fixed steps: work through the criteria, confirm, then metadata; writes the quality workflow onto the node; KI only proposes | `features/quality/quality-check-screen/`, `features/quality/quality-criteria/` |
| The machine judges underneath | no chat at all, plain HTTP scoring: MetaLookUp measures (on by default), ContentJudge runs an LLM pass per scheme (off by default, needs a credential); started right after the content was analysed and read steps later | `services/quality-judge.service.ts`, `metalookup.service.ts`, `content-judge.service.ts`, `util/quality-schemes.ts` |
| **Individuelle Qualitätsprüfung mit KI** (`ai-quality`) | a dialogue with the assistant about the content and its collection, opened with the criteria as its task and answered in a schema built from them; a greeting that asks whose content it is, a language pass on one's own content, then judgement and enrichment, each confirmed by the person in the chat, ending in the same record and the same confirmation as the structured check | `features/quality/ai-quality-screen/`, `util/quality-check-request.ts`, `util/ai-prompts.ts`, `util/ai-schemas.ts` |

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

The script pulls `<base>/widget/boerdi-widget.js` into `scripts/boerdi/boerdi-widget.js`.

**The bundle of 2026-08-26 did not come that way.** It was built from a working copy of
`edu-chatbot-sc` (`cd frontend && npm run build:widget`, then `dist/widget/browser/main.js` copied
over), because the local engine and the seam are not deployed yet. The deployed backend is therefore
*behind* what is packaged here, and running `fetch-widget.mjs` against it would take the seam back
out — check `hostCapabilities` in the bundle before refreshing. It refuses
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
3. **Four untyped foreign names** hold the integration together: the tag `boerdi-chat`, the inner
   tag `boerdi-chat-shell` looked for by `querySelector`, and the storage keys `boerdi_session_id`
   and `boerdi_owl_hint_session`. A missing context method is at least logged; a renamed shell tag
   surfaces only as a ten-second timeout, and a renamed storage key as a check that opens on the
   previous conversation.
4. **The visibility flag belongs to another bundle.** Both entry points hang off
   `browserExtensionCustomWebComponent`, the WLO canvas's flag, because the assistant ships with that
   bundle — `model/navigation.ts` says so explicitly.
5. **Nothing but the log checks that the check ran against the skill.** The task asks for the
   collection's instruction outright, and `tools_called` from `boerdi:routing-debug` says whether the
   model fetched it — but it says so in the console. Nothing in the panel reads it, so a check that
   answered from memory is recorded exactly like one that followed the editorial instruction.
6. **Only the first collection is handed over**, deliberately, since one skill is what the assistant
   works with. A content filed in several collections shows the chat only one of them, and there is no
   UI in which to choose which.
7. **An unsaved content is checked without its collection.** No node means no id in the context at
   all, or the collection would become the subject — so the assistant has to find the collection by
   the name in the task, and may find the wrong one or none.
8. **The return channel carries one thing.** `boerdi:agent-result` is what the panel acts on; the other
   four reach the log and go no further. What the assistant looked at is therefore readable while the
   console is open and nowhere afterwards.
9. **Every turn costs an extra model pass** once a schema is stated — measured at 2 to 9 seconds, and
   30 for a ten-criterion schema. It is charged to "Danke!" as much as to the check itself, because
   the schema belongs to the embedding rather than to the message.

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

The verdicts are recorded, but nothing on screen shows what they rest on. All five events are heard and
traced, `tools_called` among them — so the evidence exists at the moment the check runs and is gone
with the console. What is missing is somewhere to put it: whether the collection's instruction was
fetched belongs beside the result the check writes, not in a log nobody reads afterwards.

### What not to do

`POST /api/agent` looks like the natural fit for a one-shot check and is not one here. It needs a
`WLO-Access-Block` header with a *personal* login, which this panel does not have — anonymous does not
count — and it is throttled to 20 requests per minute per IP. The widget's own chat endpoints are
public and are what the panel is built on. Keep the check inside the widget.
