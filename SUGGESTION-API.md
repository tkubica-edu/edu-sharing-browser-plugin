# Suggestion-API — Recherche und Einschätzung

Stand 2026-08-28. **Theorie, nichts davon ist umgesetzt.** Die Notiz hält fest, was die
edu-sharing Suggestion-API kann, wie der Core-MDS-Editor sie benutzt, was das Panel heute
stattdessen tut, und was ein Wechsel brächte und kostete.

- [Die API](#die-api)
- [Wie der Core-Editor sie benutzt](#wie-der-core-editor-sie-benutzt)
- [Was das Panel heute tut](#was-das-panel-heute-tut)
- [Der gedachte Ablauf](#der-gedachte-ablauf)
- [Drei Haken](#drei-haken)
- [Was der Weg einbringt](#was-der-weg-einbringt)
- [Grenzen](#grenzen)
- [Gleichnamiges, das etwas anderes ist](#gleichnamiges-das-etwas-anderes-ist)

---

## Die API

Der Vorschlags-Speicher liegt unter einem einzigen Pfad, `/suggestions/v1/{repository}/{node}`,
plus einer Roh-Variante:

| Methode | Pfad | Operation | Anmerkung |
|---|---|---|---|
| GET | `/suggestions/v1/{repository}/{node}` | `getSuggestionsByNodeId` | optional `status[]` = `ACCEPTED\|PENDING\|DECLINED`. Liefert `NodeSuggestionResponseDTO`: `{ nodeId, suggestions: { <propertyId>: SuggestionResponseDTO[] } }` — nach Property gruppiert |
| GET | `/suggestions/v1/{repository}/{node}/raw` | `getRawSuggestionsByNodeId` | derselbe Filter, flaches `PropertySuggestion[]` statt der Gruppierung |
| POST | `/suggestions/v1/{repository}/{node}` | `createSuggestions` | **Pflicht**-Query `type` (`AI\|USER_PROPOSAL`) und `version` (freier String). Body: Array von `CreateSuggestionRequestDTO` |
| PATCH | `/suggestions/v1/{repository}/{node}` | `updateStatus` | `id[]` + `status`; gibt die geänderten `SuggestionResponseDTO[]` zurück |
| DELETE | `/suggestions/v1/{repository}/{node}` | `deleteSuggestions` | optional `version[]`; ohne Angabe werden **alle** Versionen gelöscht |

`CreateSuggestionRequestDTO`:

- `propertyId` (Pflicht) — Kurzform, z. B. `cclom:general_description`
- `value` (Pflicht, `object`) — im Datentyp der Property (String/Long/Double/Boolean), immer
  einwertig; Datum/Zeit als Unix-Timestamp
- `description` (Pflicht) — die Begründung, die dem Redakteur angezeigt wird
- `confidence` — Double, 0…1

**Ein Eintrag = eine Property + ein Wert.** Mehrwertige Properties brauchen mehrere Einträge mit
demselben `propertyId`. `SuggestionResponseDTO` ergänzt `id`, `nodeId`, `version`, `type`, `status`,
`created`/`createdBy`, `modified`/`modifiedBy`.

Zum Finden von Nodes mit offenen Vorschlägen: `POST /search/v1/suggestions/{repository}`
(`getNodesBySuggestion`, „requires write permissions on the individual nodes"), Filter `status[]`,
`type[]`, `contentType`, Paging, Body `SearchParameters`; Ergebnis `SearchResultSuggestion` →
`NodeSuggestionEntry[]` = `{ node, suggestionNodes: SuggestionNode[] }`.

`SuggestionsV1Service` liegt bereits in `ngx-edu-sharing-api` (^11.0.2, in `app-src/node_modules`) —
für den Schreibweg wäre kein neuer Client nötig.

## Wie der Core-Editor sie benutzt

Quellen: `~/.edusharing/enterprise/link/maven/fixes/11.0/repository/Frontend/src/app/features/mds/mds-editor/`.

- `MdsEditorInstanceService.init()` prüft `suggestionsSupported` — `/_about` muss den Plugin-Eintrag
  `mongo-plugin` melden — und ruft bei `editorMode === 'nodes'` von sich aus
  `MdsEditorCommonService.fetchNodesSuggestions()` → `getSuggestionsByNodeId`.
- `Widget.initWithNodes()` verteilt über `updateSuggestions()` nach `definition.id`; ein Widget sieht
  nur die Vorschläge zu seiner eigenen Property, und nur bei `nodes.length === 1`.
- Anzeigen/Übernehmen können: Text, Select, Radio-Button, Slider, Duration, Tree. Übernommen wird
  über `setSuggestionState(…, 'ACCEPTED')`, eine spätere Bearbeitung setzt `'DECLINED'`.
- Beim Speichern des Editors schreibt `saveSuggestions()` die Status per `updateStatus` zurück
  (`ACCEPTED`- und `DECLINED`-IDs in je einem PATCH).

Prüfung der Staging-Instanz (`GET https://repository.staging.openeduhub.net/edu-sharing/rest/_about`):
`plugins: ['mongo-plugin', 'b-api', 'rendering-service-2']`, Version 11.0 — der serverseitige Weg
wäre dort also verfügbar.

## Was das Panel heute tut

Denselben UX-Effekt, aber rein im Speicher, ohne Repository:

- `app-src/src/app/util/mds-suggestions.ts` — `aiFieldsOf()` zieht die `_origins`-Schlüssel mit
  `'ai'`, `aiSuggestionsFor()` baut daraus `MdsSuggestion[]` (`id` erfunden: `es-ai-<property>-<i>`,
  `status: 'PENDING'`, `type: 'AI'`).
- `app-src/src/app/features/metadata/mds-editor/mds-editor.component.ts` — `mount()` setzt
  `element.suggestions = [suggestions]` (im vendorten Bundle `setExternalSuggestions()`, das
  `suggestionMetadata$` **und** `showAiSuggestions` setzt) und reicht den Node über
  `withoutAiFields()` **ohne** die vorgeschlagenen Properties hinein, damit die Widgets leer sind.
  `LICENSE_FIELDS` werden bewusst aus dem Angebot gelöscht — die Lizenz wird gesetzt, nicht
  vorgeschlagen.
- Der Kommentarkopf von `mds-suggestions.ts` nennt den Grund für den Eigenbau: der Ladeweg des
  Editors „needs the mongo-plugin, the b-api and a toolpermission, and generates suggestions of its
  own on top".

## Der gedachte Ablauf

1. **Node entsteht früh.** Im Schritt *Vorschau* schreibt `CurationService.createContent()`
   (`app-src/src/app/services/curation.service.ts:679`) den Node mit `cclom:title` + `ccm:wwwurl`.
   Ab da gibt es eine Node-ID, an der Vorschläge hängen können.
2. **Vorschläge hinterlegen.** `POST /suggestions/v1/-home-/{nodeId}?type=AI&version=…`, ein Eintrag
   pro Property und Wert. Die Feldauswahl gibt es schon (`aiFieldsOf()`); aus `aiSuggestionsFor()`
   würde statt `MdsSuggestion[]` ein `CreateSuggestionRequestDTO[]`.
3. **Der Editor lädt sie mit dem Formular.** Der Schritt *Metadaten editieren* mountet den Wrapper
   mit `editorMode='nodes'` und dem echten Node; der Editor ruft `getSuggestionsByNodeId` selbst.
4. **Jedes Widget bekommt seine** über `initWithNodes` → `updateSuggestions()`.
5. **Übernommen/abgelehnt** wird über `setSuggestionState`, zurückgeschrieben per PATCH.

## Drei Haken

**a) Der Anzeige-Schalter.** Widgets zeigen einen Vorschlag nur bei `showAiSuggestions === true`
(`getShowAiSuggestions()` kombiniert Schalter und Werte). Serverseitig geladene Vorschläge setzen ihn
nicht. Im Repository-UI legt ihn ein Slide-Toggle um, der nur bei `hasAi` erscheint
(`hasUserAISupport()` && `suggestionsSupported` && `editorMode==='nodes'` && `groupId==='io'`). Sein
erstes Umlegen startet im Konstruktor von `es-mds-editor-core` `generateSuggestions()`: ein eigener
LLM-Lauf über `eduSharingLlmService.suggestions` für alle Widgets mit `aiConfigs`, der danach
`suggestionMetadata$` **überschreibt**. Ohne `aiConfigs` im MDS kehrt die Methode früh zurück — mit
Toast und dauerhaft hängendem `aiLoading` (kein `finally`). Deshalb bliebe das Einreichen über
`element.suggestions` weiter nötig, nur mit den echten Server-IDs statt den erfundenen.

**b) Ein Vorschlag greift nur in ein leeres Feld.** Im Text-Widget:
`if (!this.formControl.value?.trim() && suggestion && show)`. Was der Node schon trägt, wird nie als
Vorschlag markiert — daher `withoutAiFields()`. Auf dem Server-Weg gilt dasselbe: die
vorgeschlagenen Felder dürfen bis zum Editieren nicht auf dem Node stehen. Der in Schritt 1
geschriebene **Titel** wäre gesetzt und ein Titel-Vorschlag damit unsichtbar.

**c) Multivalue-Chips können es nicht.** `cclom:general_keyword` hat in keinem der beiden Wege eine
Vorschlagsdarstellung. Die Schlagworte lägen im Store und würden im Formular nicht angeboten.

## Was der Weg einbringt

Die Anzeige im Panel ist kein Gewinn — die gibt es schon. Der Unterschied liegt dahinter:

- Die Vorschläge **überleben die Panel-Sitzung**: eine Redaktion öffnet den Node später im
  edu-sharing-Workspace und sieht dieselben Vorschläge mit Annehmen/Ablehnen.
- `POST /search/v1/suggestions/{repo}` liefert einen **Arbeitsvorrat** — alle Nodes mit offenen
  Vorschlägen, gefiltert nach Status und Typ.
- Angenommen/abgelehnt wird **protokolliert** und ist auswertbar.
- `description` und `confidence` pro Feld sind vorgesehen. Der Agent liefert beides heute nicht:
  `_origins` kennt nur `'ai' | 'user'`, und `processing.llm_model`/`llm_provider` werden verworfen.
- `MetadataSuggestionEvent` in den Benachrichtigungen.

## Grenzen

- Hängt am `mongo-plugin` der jeweiligen Instanz — feature-detect über `/_about`, sonst Rückfall auf
  den heutigen Weg.
- Braucht einen Node: Drafts (`-draft-`, `editorMode='form'`, `EDITOR_MODE_FOR_DRAFT` in
  `app-src/src/app/util/mds-node.ts`) tragen keine Vorschläge.
- Die Gast-/Agent-Route fällt weg — dort gehört der Node dem Agenten, das Panel darf auf ihm meist
  gar nicht schreiben. Passt zum Zuschnitt „nur Core-Editor, angemeldet".
- Mehrfaches Erschließen desselben Node stapelt Vorschläge; `version` plus `DELETE ?version=…` wäre
  die Handhabe.
- Das Panel benutzt den Save-Weg des Editors nicht — der Footer liest die Werte heraus und schreibt
  selbst (`CurationService.save` → `RepositoryNodeService`), also läuft `saveSuggestions()` nicht von
  allein. Das PATCH müsste das Panel selbst absetzen.

## Gleichnamiges, das etwas anderes ist

- **MDS-Valuespace-Autocomplete** — `POST /mds/v1/metadatasets/{repo}/{mds}/values` und
  `…/values_for_keys` liefern `Suggestions` (`replacementString`/`displayString`/`translation`/`key`).
- **Neuen Valuespace-Eintrag vorschlagen** — `POST /mds/v1/metadatasets/{repo}/{mds}/values/{widget}/suggest`,
  mailt an die im MDS hinterlegte Person, liefert einen `MdsValue`.
- **Such-Rechtschreibung** — das Feld `suggests: Suggest[]` an `SearchResult*`, eingeschaltet über
  `SearchParameters.returnSuggestions`.
- **MDS-Haken** — `MdsWidget.suggestionSource`, `MdsWidget.allowValuespaceSuggestions`,
  `MdsView.rel: "suggestions"`.
