# Bugs found by the tests

Defects the automated tests turned up and that are **still in the code**. Each is pinned by an
assertion that states what the code does today, so a fix shows up as a failing test to update rather
than as a silent change — the spec named under each entry is where that assertion lives.

None of them is fixed here: they were found while writing tests, and changing shipped behaviour is a
separate decision. Where a defect is user-visible, [TROUBLESHOOTING.md § Behaviour a spec pins
although it is wrong](TROUBLESHOOTING.md#behaviour-a-spec-pins-although-it-is-wrong) points here.

Nothing in this file is a *test* problem — the suite is green, and no test reaches the network (see
[TESTING.md § Unit tests](TESTING.md#unit-tests)).

| # | Where | Reaches the user? |
| --- | --- | --- |
| [1](#1-a-metadata-set-that-cannot-be-read-reads-as-one-without-criteria) | `quality-criteria.component.ts` | **Yes** — wrong explanation on screen |
| [2](#2-withpagestatements-leaves-a-lone-page-marking-standing) | `util/derived-metadata.ts` | Yes, narrowly — a field can read as page-supplied when the run wrote it |
| [3](#3-pickkeywords-keeps-the-last-spelling-not-the-first) | `content-suggestions.service.ts` | Cosmetic |
| [4](#4-asnumber-accepts-the-numeric-strings-its-docblock-excludes) | `util/quality-schemes.ts` | Latent |
| [5](#5-askedvocabularies-builds-a-dangling-und) | `util/ai-prompts.ts` | Latent |

---

## 1. A metadata set that cannot be read reads as one without criteria

**`app-src/src/app/features/quality/quality-criteria/quality-criteria.component.ts:505`** (`load`),
with `quality-criteria.component.html:20` and `:122`.

`load` records `'Die Qualitätskriterien konnten nicht geladen werden.'` in the view's own `error`
when `getMetadataSet` rejects. The template renders a problem in exactly one place — `problemShown`
at line 122 — and that sits inside the final `@else`, the branch reached only once criteria have
loaded. A failed load leaves `hasCriteria()` false, so the branch above it wins and the user is told:

> Das Metadatenset hält für diesen Inhalt keine Qualitätskriterien bereit.

**Why it matters.** The two states call for opposite responses. „The set defines none" is a
configuration answer and the step is simply done; „the repository could not be reached" is a failure
the user can retry or report. The recorded message never appears, so the second is always shown as
the first — and the panel looks like it has decided something when it has not.

**A fix** would render `problemShown()` outside the branch, or make the no-criteria branch check
`error()` first. Either changes what the screen says, so it is a product decision, not a cleanup.

Pinned in `quality-criteria.component.spec.ts` — *„shows a set that could not be read as one that
holds no criteria"*.

## 2. `withPageStatements` leaves a lone page marking standing

**`app-src/src/app/util/derived-metadata.ts:270–292`.**

The function merges a generated payload over the page's own statements and merges `_origins` with
them, so each field keeps the provenance of whichever side supplied it. Where the run answered a
field the page had also supplied, the page's marking has to go — line 288 deletes it.

It deletes it from a *copy*:

```ts
const merged = { ...fromPage };                                  // carries the page's own `_origins`
const origins = { ...((fromPage['_origins'] ?? {}) as object) }; // the copy that is edited
…
else delete origins[key];
…
if (Object.keys(origins).length) merged['_origins'] = origins;   // only written back if non-empty
```

When the deletion empties `origins`, the guard on the last line skips the write-back — and `merged`
still holds the page's original `_origins` object, entry included. So the marking survives exactly
when the page marked one field and the run answered that one.

**Why it matters.** The form draws a generated field as a proposal and a declared one as decided. In
this case a value the run produced goes on being shown as the page's own. Harmless whenever any
other field carries a marking, which is the ordinary case — which is also why it went unnoticed.

**A fix** is to write `origins` back unconditionally, or to build `merged` without `_origins` and add
it at the end.

Pinned in `derived-metadata.spec.ts` — *„leaves a lone page marking standing, which is where the
dropping does not reach"*, alongside the case that works.

## 3. `pickKeywords` keeps the last spelling, not the first

**`app-src/src/app/services/content-suggestions.service.ts:189–197`.**

The docblock says „de-duplicated (first spelling wins)". The implementation is

```ts
new Map(values.map((word) => [word.toLowerCase(), word]))
```

and a `Map` built from entries lets a later entry overwrite an earlier one under the same key. What
actually happens: the keyword keeps the *position* of its first mention and the *spelling* of its
last. For `['Optik', 'optik', 'OPTIK']` the result is `['OPTIK']`.

**Why it matters.** Only cosmetically — both spellings are the agent's own, and the keyword is used
case-insensitively everywhere after this. It is listed because the code and its own documentation
disagree, and whichever of the two is wrong should be corrected.

Pinned in `content-suggestions.service.spec.ts` — *„keeps the last spelling of the ones that differ
only in case"*.

## 4. `asNumber` accepts the numeric strings its docblock excludes

**`app-src/src/app/util/quality-schemes.ts:192–200`.**

```ts
/**
 * … so anything that is not a finite number is no number here — including the numeric *strings* a
 * scheme may report.
 */
function asNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  …
}
```

The comment says numeric strings are excluded; the first line of the body converts them. A scheme
answering `"3"` is therefore judged as 3 rather than skipped.

**Why it matters.** Not at all today — nothing observed reports a value as a string. It matters if it
ever happens, and then it matters in the direction of a *silent* verdict on a quality criterion: a
`nominal_categorical` scheme whose category happened to be numeric would be read as a score and
compared against a threshold. The conservative reading is the one the comment describes.

Pinned in `quality-schemes.spec.ts`.

## 5. `askedVocabularies` builds a dangling „und"

**`app-src/src/app/util/ai-prompts.ts:30–33.`**

```ts
const quoted = names.map((vocabulary) => `"${vocabulary}"`);
return [quoted.slice(0, -1).join(', '), quoted[quoted.length - 1]].join(' und ');
```

For one name the first half is the empty string, so the result begins with a space and „und":
`askedVocabularies(['discipline'])` yields `' und "discipline"'`. For an empty list it yields
`' und undefined'`.

**Why it matters.** Not today: the single caller (`ai-prompts.ts:237`) always passes the same four
vocabularies, so the branch is never taken. It is one line of a task text sent to a language model,
so a malformed list would degrade an answer rather than break anything — but it would do so
invisibly.

Pinned in `ai-prompts.spec.ts`.
