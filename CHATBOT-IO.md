# The chatbot's inputs, tasks and results

What the panel puts **into** the KI assistant, what it **asks** of it, in which **shape** it wants the
answer, and what it does with what comes **back**. How the widget is embedded at all — the bundle, the
element, the shadow root, the backend — is [chatbot.md](chatbot.md); this file is the data contract on
top of it.

- [The channels](#the-channels)
- [The inputs](#the-inputs)
  - [1. The page context](#1-the-page-context)
  - [2. The configuration attributes](#2-the-configuration-attributes)
  - [3. The facts inside a task](#3-the-facts-inside-a-task)
  - [4. The criteria of the metadata set](#4-the-criteria-of-the-metadata-set)
  - [5. What the backend adds by itself](#5-what-the-backend-adds-by-itself)
- [The tasks](#the-tasks)
- [The structured formats](#the-structured-formats)
- [The outputs](#the-outputs)
- [What is recorded, and where](#what-is-recorded-and-where)
- [The limits](#the-limits)

**Keeping this file current.** It describes `app-src/src/app/util/page-context.ts`,
`app-src/src/app/util/quality-check-request.ts`,
`app-src/src/app/features/assistant/ai-assistant-screen/ai-assistant-screen.component.ts`,
`app-src/src/app/features/quality/ai-quality-screen/ai-quality-screen.component.ts` and
`app-src/src/app/services/chat-skill.service.ts`. Every prompt line, schema field and property mapping
lives in one of those two `util/` files — a change to either belongs here as well.

---

## The channels

Five ways in, one way out that is acted on.

| Direction | Channel | Carries | Read when |
|---|---|---|---|
| in | element **attributes** | how the widget runs, the answer shape, the chips | most of them once, as the element connects |
| in | `replaceContext(ctx)` / `updateContext(ctx)` | the page the chat is about | per call |
| in | `setHostInstruction(text, {trigger, message})` | the task — never shown to the person | per call |
| out | `boerdi:agent-result` | `{result, stop_reason}` — the filled-in schema | every turn, once a schema is set |
| out | four further events | routing, tool calls, page actions, guide suggestions | traced only, never acted on |

The task and the visible bubble are **two different strings**. `text` is the instruction and travels in
the request's environment as `host_instruction`; `message` is the short bubble the person reads in its
place (`AssistantTask`). Without a `message` the whole instruction would be shown as if somebody had
typed it.

The person's own messages never pass through the panel. There is no `sendMessage` on the element, which
is why the chips ([`quick-replies`](#2-the-configuration-attributes)) are the only way the panel decides
what a turn can be answered with.

---

## The inputs

### 1. The page context

`app-src/src/app/util/page-context.ts`. Snake_case throughout, because it is the widget's own wire
format — a context from here has to read like one it read itself. `auto-context` is off, so this is the
whole of what the assistant knows about where it is.

| Field | What it is | Where it comes from |
|---|---|---|
| `page_kind` | `topic` \| `collection` \| `content` \| `subject` \| `search` \| `other` | the URL's shape, or `content`/`other` for a curated content |
| `page_url`, `page_host` | the address, http(s) only | the tab, or the page the content was erschlossen from |
| `node_id` | the content the page shows | `/components/render/<uuid>`, `?node`, or the curated content's own node |
| `collection_id` | the collection shown, or the one a topic page is built on | `/components/collections?id`, `/components/topic-pages`, `?collection`, or the collection the content was filed in |
| `topic_page_slug`, `subject_slug` | `/themenseite/<slug>`, `/fachportal/<slug>[/<slug>]` | the path |
| `search_query` | the term, 2–200 characters | `?q`, `?search`, `?query` |
| `page_text` | what the page says it is about | the tab title (≤ 300 chars), or the content's **title + blank line + text** (≤ 8 000 chars) |
| `detection_source` | which rule recognised the page | `url:components/render`, `url:?node`, `url:/fachportal`, …, `panel:content` |

Two builders, two situations:

- **`pageContextOf(url, title)`** — the open tab. Anything that is not `http:`/`https:` yields `null`.
  `page_text` is the tab title and nothing more: reading the page itself needs the content script.
  This is what the assistant's own screen (*Frage stellen*) runs on.
- **`contentContextOf(content)`** — a content the panel curates. `page_text` carries the content's
  actual text, which is the subject of the dialogue rather than a hint about it, hence the far higher
  cap. `detection_source: 'panel:content'`.

**Which id is sent decides what gets judged.** The backend resolves whichever id the context carries as
"the current page" (`target_id = node_id or collection_id`) and renders a block from what it finds —
and the block that would carry our own `page_text` is read **only where nothing resolved at all**. So:

| the content | `page_kind` | ids sent | what the model sees as "the page" |
|---|---|---|---|
| has a node | `content` | `node_id` **and** `collection_id` | that content, resolved with its text |
| has no node yet | `other` | `collection_id` only | our `page_text` — the title and text themselves |

The collection is stated either way, because it is not an answer to "which page is this": it is what the
assistant looks the collection's skills up by. Only the *page identity* is withheld where there is no
node. Handing over the collection as the page instead produces a check **of the collection**, however
plainly the task asks about the one content — measured, see [chatbot.md](chatbot.md#which-id-is-sent-decides-what-gets-judged).

`sameSubject()` compares `page_kind`, `node_id`, `collection_id`, `topic_page_slug`, `subject_slug` and
`search_query`. Equal means the same page under a changed address, which is merged (`updateContext`);
different means another page, which is replaced (`replaceContext`) and greeted. A screen that states a
task always merges — a replacement makes the widget start a turn of its own, which lands in the middle
of a step.

### 2. The configuration attributes

Set imperatively **before** `appendChild`, because the widget resolves its context as it connects.

| Attribute | Value | Why |
|---|---|---|
| `api-url` | `https://87.106.127.225.nip.io` | the chat backend, hardcoded |
| `embed-mode` | `frameless` | the screen is the chat; no floating button of its own |
| `initial-state` | `expanded` | being on this screen is already the request to chat |
| `auto-context` | `false` | the panel is not the page — its own detection would contribute the extension's address |
| `show-language-buttons`, `show-debug-button` | `false` | not part of the panel's chrome |
| `emit-guide-suggestion`, `emit-routing-debug` | `true` | the only account of how a turn was routed and which tools it called |
| `page-context` | the JSON of the context | **omitted** where the screen states a task — see below |
| `result-schema` | the JSON schema | asks for a structured answer on every turn |
| `engine` | `agent` | set **together with** the schema; under the default engine a schema takes no effect at all |
| `master-skill` | `on` / `off` / *absent* | three states: absent leaves it to the operator (`MASTER_SKILL_ENABLED`), see `ChatSkillService` |
| `quick-replies` | JSON array of strings | the chips, prescribed per step; `[]` hands them back to the widget |

`result-schema` and `quick-replies` are the two the panel changes **mid-conversation**: the widget
applies a changed schema from the next turn on, and carries the chips into every turn it sends until
they are replaced. Everything else above is read once.

**A screen with a task gives up the `page-context` attribute.** A context set as an attribute is one
the widget greets over the network as the element connects — and it is still busy answering that
greeting when the conversation appears, which is exactly when the task would be put. A message put to a
busy widget is dropped without a word. So such a screen hands the page over with `replaceContext()`
once the conversation is on screen and puts the task **in the same turn of the event loop**: the task is
then the turn that runs, and the greeting is the one that gives way.

### 3. The facts inside a task

Beside the context, each task states what it is about in its own text (`CheckSubject`). These are the
things the panel holds and the content's text does not carry:

| Field | Source |
|---|---|
| `title` | `cclom:title`, else the preview node's title, else the active node's name |
| `text` | `_source_text`, else `ccm:oeh_extendedText`, else `''` |
| `url` | the metadata agent's last run — the page that was curated, not the tab that is open |
| `collection` | the **name** of `filedCollections()[0]` |
| `author` | `ccm:author_freetext`, else `ccm:oeh_publisher_combined`, else `null` |
| `signedIn` | `AuthorityNamePipe` over `AuthService.currentUser()`, else `username()` |

The last two exist for one purpose: the opening question guesses whose content this is before it asks,
and a named author matching the signed-in person is the one clear sign of one's own content.

`url` is deliberately **not** printed in the task. The context carries it, and the quoted text opens with
its own `URL:` header — a third copy would only spend the budget the text needs. What `url` decides is
whether *asking to fetch the page* is worth it at all.

### 4. The criteria of the metadata set

`criteriaOf()` reads them from `APP_CONFIG.metadataSet`, out of the same two widgets the structured
check uses:

| Kind | Read from | Recorded in |
|---|---|---|
| `knockout` | `virtual:unmetLegalCriteria` | one node property per criterion |
| `editorial` | `ccm:oeh_buffet_criteria` | the shared property of met ids |

Each becomes a `QualityCriterion` with a **short key** — `k1`, `k2`, … — because their own ids are node
properties and vocabulary URIs, and as schema keys they would spend the budget on addresses the model
has no use for. The caption is what the assistant judges by; the key is what the answer is mapped back
through. Knock-out criteria come first, in the order the set lists them.

The criteria travel to the assistant **twice over**: as the task, so it knows what it is judging, and as
the shape of its answer, so what comes back can be recorded rather than read.

### 5. What the backend adds by itself

Not ours, but part of what the model reads, so worth knowing when a task seems to have been ignored:

- **The resolved page.** Whatever `node_id` / `collection_id` resolves to, rendered as a block — title,
  licence, thumbnail, compendium text, material count.
- **The skill overview.** `page_kind: 'collection'` or `'topic'` *together with* `collection_id`
  prefetches the collection's released instructions into the prompt — **titles only, no `nodeId`s**,
  capped at 100 entries and ~3 500 characters. The model has to walk `get_skill_registry` →
  `get_skill` itself, which is why every task that depends on a skill names those tools outright.
- **Our `page_text`** — only where nothing resolved.

---

## The tasks

Four requests and one closing word, in order, and **none of them is put until the previous one has
answered**: they run under the same iteration and token caps, and asked together they compete for them.

| # | Step | Instruction | Runs | Bubble | Quotes the text | Tools it names |
|---|---|---|---|---|---|---|
| 1 | `origin` | `originInstructionOf()` | always | *Herkunft des Inhalts klären* | no | — |
| 2 | `proofread` | `proofreadInstructionOf()` | only where step 1 answered `own` | *Inhalt Korrektur lesen* | **yes** | `get_skill_registry`, `get_skill` |
| 3 | `quality` | `qualityInstructionOf()` | always | *Qualität prüfen* | **yes** | `get_skill_registry`, `get_skill` |
| 4 | `enrichment` | `enrichmentInstructionOf()` | always | *Metadaten anreichern* | no | `lookup_wlo_vocabulary`, `get_skill_registry`, `get_skill` |
| 5 | `done` | `closingInstructionOf()` | once the enrichment was confirmed | *Prüfung abschließen* | no | — |

**1 — Whose content is this.** The greeting, one sentence on what is about to happen, and the one
question nothing here can answer for itself. The assistant is handed the three facts above (source,
named author, signed-in person), states its guess with a reason, then asks anyway. It judges nothing and
does not read the content. `submit_result` is forbidden until the person has answered; an unclear answer
is asked about again rather than decided.

**2 — The language pass.** Spelling, grammar, punctuation, against the collection's skills on language
where it released any, else the rules of German orthography. **Language and nothing else**: whether a
statement, formula, figure or source is factually right, and equally completeness, level, didactics and
structure, are step 3's business — a factually wrong but correctly spelled passage is not a finding
here. Bound to step 1 because a correction is worth having only where somebody can carry it out.
Nothing it finds is written anywhere; the task says so outright and forbids the wording the run reaches
for on its own (*„Die Korrekturen sind übernommen"*), which would tell the person their text had been
rewritten when nothing was touched.

**3 — The judgement.** The criteria listed by key and caption and named as *our check dimensions* —
naming them is what lets the model pick which instructions to fetch; asked for "the collection's
instruction" it fetches one, or none. What a skill checks that we hold no criterion for is neither
dropped nor invented as one: it goes into the single overall verdict `suitable` and is named in the
summary. The task also insists it is **this one content** and expressly not the collection's other
contents.

**4 — The enrichment.** Subject, education level, resource type and target groups, each looked up in its
WLO vocabulary and answered **with the URI**, plus five to ten keywords. Every field is a **list**,
because the properties they land in hold lists — asked for a single value the rest is lost before it is
ever written. A guessed URI does not fail loudly; it quietly matches nothing, so the task forbids
forming one. It asks for a skill *softly*: there may not be one yet, and a skill that does not exist
must not read as a step that failed.

**5 — The closing word.** Not a request: it states that the check is complete, congratulates the person,
names the four steps behind them and points at the footer — *Abschließen und zur Inhaltsübersicht*, the
way on into the next step of the flow. It is a turn of its own rather than a sentence at the end of the
enrichment for two reasons: the enrichment's message has to end on its question, because the chips are
shown beneath it, and "everything is done" is only true once the confirmation has actually arrived. It
asks nothing, proposes nothing and forbids `submit_result` — the enrichment's schema still stands, and a
run filling it in again would write the confirmed values a second time. The panel ignores what such a
turn submits anyway (`take()` returns on `done`).

### Three rules every task follows

- **It ends with the person, not with the assistant.** Each task has it write its proposal into the
  chat, ask the person to go through it, and call `submit_result` only in the turn where they answer. The
  panel narrates none of it beside the chat — the assistant is the one thing on this screen that can
  talk, the closing word included.
- **It names `submit_result` outright**, twice: not before the confirmation, and then in that very
  turn. Measured, the enrichment task without it came back `stop_reason: "text"` — a perfect answer in
  prose, and `result: null`.
- **Its last sentence is the question**, with nothing after it, because the chips are shown under the
  message and a message closing on something else leaves them answering nothing.

### The content block

Both text-quoting tasks append the content verbatim, cut to what is left of the request bound after head,
tail and a 200-character reserve:

```
Hier ist der Inhalt im Wortlaut:
---
<text>
---
Dieser Wortlaut ist abgeschnitten. Den vollständigen Text bekommst du mit get_url_text …
```

The closing fence and the truncation note appear only where the text was actually cut. Where the panel
holds **no** text, the address takes its place with the instruction to fetch it (`get_url_text`) — or,
with no address either, the instruction to say per criterion that it was not checkable.

Quoting is not redundant with `page_text`: the better the node resolves, the more surely the backend
drops our block. Measured on one content, three criteria — the task without the text answered all three
`false` ("der zugängliche Text enthält mehrere unvollständige Sätze"), the task with it answered all
three `true`, reasoned against the collection's compendium.

### The reminder tails

`PROOFREAD_REMINDER` and `QUALITY_REMINDER` repeat the closing rules **behind** the quoted text. The
text is by far the longest part of the task and the last thing read before the answer is written, and a
text that argues for itself beats a rule standing thousands of characters above it — measured, a physics
page full of wrong figures turned the language pass into a list of factual corrections, in one turn and
without the closing question.

### The chips

Two per step, prescribed rather than hoped for, standing for the whole step so a person who asks for
changes is offered the same way on again (`STEP_REPLIES`):

| step | chips |
|---|---|
| `origin` | *Inhalt selbst erstellt* / *Fremder Inhalt* |
| `proofread` | *Ich bestätige die Korrekturen* / *Korrekturen überspringen* |
| `quality` | *Qualität bestätigen* / *Anpassungen vornehmen* |
| `enrichment` | *Metadaten bestätigen* / *Anpassungen vornehmen* |

Once the check is through the panel prescribes none: the closing word asks nothing, and what the person
says after it is their own conversation, so the chips go back to the widget (`[]`).

Left to itself the widget composes chips from the answer it just gave, with a generator nothing here can
reach — measured failures include *„Was bedeuten die Lizenzen?"* under the question whose content it is.

---

## The structured formats

One schema per step, swapped as the step flips. The schema's `description` texts are **prompt, not
documentation**: they travel verbatim into the parameters of the assistant's `submit_result` tool and are
read by the model as instructions.

### `originSchemaOf()`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `origin` | enum `own` \| `external` | yes | as the **person** answered it — explicitly not derived |
| `guess` | enum `own` \| `external` | no | what the assistant assumed beforehand, kept beside the answer, never in its place |

Enums do reach the model through `submit_result` — measured. Keeping the guess separate is what says
whether making one is worth it: measured, *„Nein, der Inhalt ist von mir, ich habe ihn nur dort
veröffentlicht"* came back `{"origin":"own","guess":"external"}`.

### `proofreadSchemaOf()`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `findings[]` | array of objects | yes | one place per entry, in the order they occur; **empty is an answer** |
| `findings[].passage` | string | yes | the wording verbatim, so the person can find it in their own text |
| `findings[].correction` | string | yes | what it is to say instead |
| `findings[].kind` | enum `spelling` \| `grammar` \| `punctuation` | yes | **closed on purpose** — a factual finding has no category to be filed under |
| `summary` | string | no | one or two sentences on the text as a whole |
| `decision` | enum `open` \| `accepted` \| `skipped` | yes | what the person decided; `open` while they have not answered |

Skipping exists because **nothing here changes the text**: there is no property that holds a correction,
the panel writes none, and the content is often not editable at that moment. Both `accepted` and
`skipped` end the step.

### `resultSchemaOf(criteria)`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `criteria` | object, one key per criterion | yes | every key required — a list invites an answer about the easy half, and a check that skipped the rest reads exactly like a complete one |
| `criteria.k<n>.outcome` | enum `met` \| `violated` \| `unclear` | yes | three words, not a yes-or-no |
| `criteria.k<n>.reason` | string | yes | one or two sentences, naming the place in the content and the instruction it leans on |
| `suitable` | boolean | yes | one verdict over the whole content, **and the only place a collection's own requirements can land where we hold no field for them** |
| `summary` | string | no | what stands in the way of a release, and what an instruction checked that has no criterion |
| `confirmed` | boolean | yes | only true where the person went through the verdicts and agreed |

`unclear` is the point of the third word: without it a check may only answer *no* where it cannot tell,
which reads as a finding about the content instead of one about the check. It records nothing, holds the
confirmation back, and keeps its reasoning. Measured on a content quoted in excerpt, six of twelve
criteria came back `unclear`, licence and accessibility among them.

What the outcomes mean is stated **once for the whole list** rather than per criterion — said twelve
times over it would cost 3 000 of the 10 000 available characters. Twelve criteria measure about 6 550;
`schemaFits()` is what says so, since beyond `SCHEMA_MAX` the backend refuses the request outright
rather than applying half a schema. Too large, the dialogue runs **without** a schema and the panel says
so, which is better than a chat that answers nothing and explains nothing.

### `enrichmentSchemaOf()`

| Field | Type | Required | Vocabulary asked with |
|---|---|---|---|
| `discipline[]` | `{label, uri}[]` | yes | `discipline` |
| `educationalContext[]` | `{label, uri}[]` | yes | `educationalContext` |
| `lrt[]` | `{label, uri}[]` | yes | `lrt` |
| `intendedEndUserRole[]` | `{label, uri}[]` | yes | `intendedEndUserRole` |
| `keywords[]` | `string[]` | yes | — (five to ten, from the content itself) |
| `confirmed` | boolean | yes | only true where the person agreed to the values |

Each field is named after the vocabulary it is looked up in — the name `lookup_wlo_vocabulary` is asked
with — and each `uri` is described as *"wie lookup_wlo_vocabulary sie zurückgibt. Niemals selbst
gebildet."* A field the content does not give is answered as an **empty list**, which is a statement; a
missing field would be indistinguishable from one the assistant forgot.

---

## The outputs

### `boerdi:agent-result`

The one event the panel acts on. It arrives on **every** turn once a schema is set — including the turns
that submitted nothing, so a run cut off by a cap is distinguishable from one that had nothing to add.
The component re-emits it as `{result, stopReason}`.

| `stop_reason` | Means |
|---|---|
| `submit` | the schema was filled in — the only value `result` is dependable on |
| `text` | the run answered in prose and submitted nothing |
| `deadline`, `token_budget`, `max_iterations`, `no_progress`, `error` | the run was cut off |

**A turn that submits nothing is the ordinary case here** — the assistant has proposed and is waiting to
be confirmed — so it is not read as a failure and nothing is asked again. Only the five cut-off reasons
put a line above the chat (`STOPPED`).

### The four traced events

| Event | Payload | Why it is heard |
|---|---|---|
| `boerdi:query-meta` | `{queries:[{tool_name, query_type, search_term, criteria[], …}]}` | what a turn searched for |
| `boerdi:routing-debug` | `{message, pattern, intent, state, persona, tools_called[], …}` | **`tools_called` is the one thing that says whether a check fetched the collection's instruction or answered from memory** |
| `boerdi:page-action` | `{action, payload}` — `navigate`, `show_results`, `canvas_show_cards` | where it would send the person |
| `boerdi:guide-suggestion` | `{url, title, node_id, node_type, query, alternatives[]}` | what it would recommend |

Every event is dispatched **twice**, first `boerdi:…` then `badboerdi:…` for the predecessor system.
Only the first name is listened to; listening to both would process and log every answer twice.

### Reading the answers back

Every parser is defensive, because `result` comes from another project through a schema that constrains
but does not guarantee:

| Function | Returns `null` / drops when | Why it matters |
|---|---|---|
| `originOf` / `originGuessOf` | the value is not one of the two words | a guess must never end up in the answer's place |
| `proofreadOf` | `findings` is not an array | an empty list is an answer; no list at all is a turn about a different question |
| `proofreadOf` (per finding) | no `passage` or no `correction` | it names nothing the person could act on |
| `verdictsOf` (per criterion) | `outcome` is none of the three words | dropped rather than read as "not met", which is a different thing from `unclear` |
| `enrichmentOf` | every list is empty **and** no keywords | an answer about another question would otherwise be recorded as an enrichment whose every field happened to be empty |
| `enrichmentOf` (per entry) | neither label nor URI | an empty entry must not read as a value the content was given |

### The gates

| Step | Moves on when |
|---|---|
| `origin` | `origin` came back — `own` goes to `proofread`, `external` straight to `quality` |
| `proofread` | `decision` is `accepted` **or** `skipped` |
| `quality` | `confirmed === true`; the verdicts alone are not enough |
| `enrichment` | `confirmed === true` |

Every step's confirmation is **machine-checked, not assumed**: measured, a task that ends in a question
is not enough on its own — the judgement once arrived proposed and submitted in one turn, and the panel
walked on past a person who had said nothing. An unconfirmed answer is kept, recorded where it belongs
and logged, and the step stays open; the schema stands for every turn, so the assistant submits again
once they have replied.

Verdicts of a later turn are laid **over** the standing ones (`merge()`), never in their place: a
follow-up question is usually about one criterion, and taking that answer as the whole result would drop
every other criterion from the record and close the confirmation again.

---

## What is recorded, and where

The point of going through a schema is that the dialogue ends in **the same record the structured check
produces**.

### The verdicts → `criteriaPropertiesOf()`

| Verdict | Knock-out criterion | Editorial criterion |
|---|---|---|
| `met` | the machine's all-clear value where the valuespace states one, else the plain met value | the criterion's id is added to `ccm:oeh_buffet_criteria` |
| `violated` | the violated value of that widget | the id is removed from the list |
| `unclear` | nothing recorded | nothing recorded |

A met knock-out criterion is recorded as the **machine's** all-clear, exactly as a judge's finding is:
the assistant is a machine, and a box claiming a person's confirmation would say more than happened.

`knockoutSatisfied()` requires every knock-out criterion to be judged *and* met — an unanswered or
undecided one holds the confirmation back, because the confirmation states that the criteria were looked
at and found met.

### The enrichment → `enrichmentPropertiesOf()`

Which property a value goes to is decided by **the vocabulary its URI came out of**, not by the field it
was answered under: each property holds the values of exactly one vocabulary.

| answered | vocabulary in the URI | property |
|---|---|---|
| `discipline` | `discipline` | `ccm:taxonid` |
| `educationalContext` | `educationalContext` | `ccm:educationalcontext` |
| `lrt` | `new_lrt` | `ccm:oeh_lrt` |
| `lrt` | `new_lrt_aggregated` | `ccm:oeh_extendedType` |
| `intendedEndUserRole` | `intendedEndUserRole` | `ccm:educationalintendedenduserrole` |
| `keywords` | — | `cclom:general_keyword` |

*Materialtyp* is why it has to work that way: asked for `lrt`, `lookup_wlo_vocabulary` answers out of
either vocabulary — measured, `…/vocabs/new_lrt_aggregated/…` for *Arbeitsblatt* — and on the node those
are two separate fields. So one answered field feeds two properties, and a URI out of any other
vocabulary is **not recorded at all**: it would sit in a field whose valuespace does not contain it,
where the editor shows a blank and no search finds it.

Only the URI is stated, since that *is* what a vocabulary property holds; the label is what the editor
renders from it. The **keywords are added** to those already on the content rather than put in their
place — they come from the same reading of the same text as the extraction's, the two lists overlap
without being the same, and a keyword both hold keeps the spelling the content already carries.

Values are **recorded, not saved**: they travel with the confirming write.

### What is not recorded

| Answer | Where it goes |
|---|---|
| `guess` | the log, beside the person's answer, so the two can be compared |
| the language pass's findings | the log and the chat — there is no property that holds a correction |
| `summary`, `suitable` | kept on the screen's state and logged; `suitable` is the only home for what a collection's instruction checks beyond our criteria |
| `tools_called` and the four traced events | the console, and nowhere else |

### The way out

The footer offers *Abschließen und zur Inhaltsübersicht* once the quality is judged **and** the metadata
enriched (`reportQualityJudged()` + `reportMetadataEnriched()`). A content judged but never described is
half done, and the button says so by staying shut. Any later turn that submits lands in the same handler
and opens it.

---

## The limits

| Constant | Value | Bounds |
|---|---|---|
| `SCHEMA_MAX` | 10 000 chars | what the backend accepts as `result-schema`; beyond it the request is refused outright |
| the request bound | a **setting** — *Länge einer KI-Anfrage*; default `APP_CONFIG.assistantRequestMaxCharacters` = 10 000, range `TASK_MIN` 1 000 … `TASK_LIMIT` 100 000 | our own bound on the instruction, which is what the quoted text is cut to fit |
| `CONTENT_TEXT_MAX` | 8 000 chars | the content's text in `page_text` |
| `TEXT_MAX` | 300 chars | a tab title in `page_text` |
| `QUERY_MIN` / `QUERY_MAX` | 2 / 200 chars | a search term worth passing on |
| skill overview | 100 titles, ~3 500 chars | the backend's prefetch, titles only |
| the visible `message` | 10 000 chars | the chat endpoint's cap — here a few words |
| a run | 90 s, 12 iterations | the backend's caps, reported as `deadline` / `max_iterations` |

The instruction travels as `host_instruction` in the request's environment, a field declared without a
length limit — the bound protects the *prompt* the model reads, not the API. That is why it is the one
limit here that is set rather than fixed: the settings screen offers it as *Länge einer KI-Anfrage*
(`AssistantRequestService`, persisted), and a longer request buys a longer excerpt of a long content at
the price of the run's token budget. `boundedTaskMax()` brings whatever is entered or stored into
`TASK_MIN` … `TASK_LIMIT`, falling back to the checked-in default; the two tasks that quote the content
take it as an argument, so a change reaches the next check rather than a running one.

---

## Following it in the console

Nothing of the check is drawn beside the chat, so the console is where the inputs and outputs are read
back. Three prefixes, one sequence:

- `[edu-sharing][boerdi]` — the conversation: every attribute as it is set, whole and unabbreviated, the
  context of every hand-over, the instruction verbatim at the moment it goes out, and every answer with
  its `stopReason`.
- `[edu-sharing][quality]` — the check: what it is about, how many criteria were read and under which
  keys, each schema with its character count, each task with how much of it is the content's own text,
  how many characters the page has against the 10 000 a request supports and how many of them are left
  for the text, and every answer with what it changed.
- `[edu-sharing][agent]` — said as a `/generate` answers, long before a check is opened: how many characters
  the erschlossene page has against the bound the setting states (10 000 by default), and by how much it is
  over — which is the moment to raise the setting, since by the time a check quotes the text the run is paid
  for. `[edu-sharing][quality]` then says how many of them are actually left for the text once an
  instruction has its share.
- `[edu-sharing][write]` — what reaches the node.

**How to tell a check ran against the collection's skill:** not by reading the answer — a fluent answer
proves nothing. `boerdi:routing-debug` is on, so check that `tools_called` contains `get_skill`. Without
it the model answered from the prompt's list of titles, and the collection's requirements never entered
the dialogue.
