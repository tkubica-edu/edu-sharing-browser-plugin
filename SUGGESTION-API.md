# Suggestion-API

Was die edu-sharing Suggestion-API kann, wie der Core-MDS-Editor sie benutzt und wie das Panel sie
benutzt: die Erschließung legt die Felder des Agenten als KI-Vorschläge am Node ab, der Schritt
*Metadaten bearbeiten* liest sie von dort.

- [Die API](#die-api)
- [Wie der Core-Editor sie benutzt](#wie-der-core-editor-sie-benutzt)
- [Wie das Panel sie benutzt](#wie-das-panel-sie-benutzt)
- [Der Ablauf](#der-ablauf)
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

## Wie das Panel sie benutzt

- `app-src/src/app/util/mds-suggestions.ts` — `aiFieldsOf()` zieht die `_origins`-Schlüssel mit
  `'ai'`; `aiSuggestionRequests()` macht daraus `CreateSuggestionRequestDto[]` (ein Eintrag pro
  Property **und Wert**, `description: 'METHODOLOGY'`, `confidence: 1`), `storedAiSuggestions()`
  formt die Antwort des Repositories in die Form, die die Widgets lesen. `aiSuggestionsFor()` baut
  dieselbe Form rein im Speicher — der Rückfall, wo das Repository keine Vorschläge hält.
- `app-src/src/app/services/suggestion.service.ts` — `propose()` und `load()`, beide bestenfalls:
  jede Seite meldet, was sie erreicht hat, und wirft nicht. `propose()` löscht vorher die eigene
  `version` (`browser-extension`), damit eine wiederholte Erschließung die Vorschläge ersetzt statt
  sie zu stapeln. Die Lizenz wird nie vorgeschlagen — sie wird gesetzt.

Was das Backend annimmt, entscheidet `MongoSuggestionService.createSuggestion` **für die ganze Liste
auf einmal**, bevor irgendetwas geschrieben wird — ein Eintrag, den es nicht mag, kostet also alle
anderen mit. Drei Prüfungen, in dieser Reihenfolge:

| Prüfung | Verhalten |
|---|---|
| `CCConstants.getValidGlobalName(propertyId)` | kennt es das Präfix nicht, ist die Antwort `null` und geht ungeprüft in `QName.createQName()` → `InvalidQNameException`, **HTTP 500** |
| `dictionaryComponent.getProperty(...)` | unbekanntes Property → `IllegalArgumentException` |
| Datentyp | Liste/Array wird abgelehnt, Datum will einen Unix-Timestamp (`Long`), sonst „is not assignable" |

Bekannte Präfixe sind `ccm`, `cclom`, `cm`, `sys`, `virtual`, `exif`, `app`, `st`, `audio`,
`webdav`, `rn`. `aiSuggestionRequests()` lässt deshalb nur `ccm`, `cclom` und `cm` durch — was der
Agent sonst noch führt (`schema:datePublished`, `oeh:new_lrt`), ist sein Vokabular und kein Property
eines Nodes. Und weil die Prüfung die ganze Liste betrifft, schickt `propose()` erst den Stapel und
bei einer Absage Eintrag für Eintrag nach, wie `RepositoryNodeService.writeExtendedData` — so kommt
durch, was durchkommt, und das Log nennt die abgelehnten Properties beim Namen.
- `app-src/src/app/features/metadata/mds-editor/mds-editor.component.ts` — `ngOnInit()` lädt die
  Vorschläge des Nodes, `mount()` setzt sie als `element.suggestions` und reicht den Node über
  `withoutAiFields()` **ohne** die vorgeschlagenen Properties hinein, damit die Widgets leer sind.

Warum weiter über den Input, obwohl der Wrapper sie selbst holt: nur `setExternalSuggestions()` —
der Patch im vendorten Bundle — setzt `suggestionMetadata$` **und** `showAiSuggestions`. Der
Ladeweg des Editors setzt den Schalter nicht, und ohne ihn zeigt kein Widget einen Vorschlag an
(Haken a).

## Der Ablauf

1. **Node entsteht früh.** Im Schritt *Vorschau* schreibt `CurationService.createContent()` den Node
   mit `cclom:title` + `ccm:wwwurl`. Ab da gibt es eine Node-ID, an der Vorschläge hängen können.
2. **Vorschläge hinterlegen.** Direkt danach `CurationService.proposeGeneratedMetadata()` →
   `POST /suggestions/v1/-home-/{nodeId}?type=AI&version=browser-extension`, ein Eintrag pro
   Property und Wert. Nur auf der eigenen Schreibroute: der Node der Agent-Route gehört dem Agenten.
3. **Der Editor lädt sie mit dem Formular.** Der Schritt *Metadaten bearbeiten* holt sie über
   `getSuggestionsByNodeId` (Status `PENDING`) und reicht sie dem Wrapper als `suggestions` hinein.
4. **Jedes Widget bekommt seine** über `initWithNodes` → `updateSuggestions()`.
5. **Übernommen** wird über `setSuggestionState`; das PATCH zurück ins Repository setzt das Panel
   nicht ab (siehe [Grenzen](#grenzen)).

## Drei Haken

**a) Der Anzeige-Schalter.** Widgets zeigen einen Vorschlag nur bei `showAiSuggestions === true`
(`getShowAiSuggestions()` kombiniert Schalter und Werte). Serverseitig geladene Vorschläge setzen ihn
nicht. Im Repository-UI legt ihn ein Slide-Toggle um, der nur bei `hasAi` erscheint
(`hasUserAISupport()` && `suggestionsSupported` && `editorMode==='nodes'` && `groupId==='io'`). Sein
erstes Umlegen startet im Konstruktor von `es-mds-editor-core` `generateSuggestions()`: ein eigener
LLM-Lauf über `eduSharingLlmService.suggestions` für alle Widgets mit `aiConfigs`, der danach
`suggestionMetadata$` **überschreibt**. Ohne `aiConfigs` im MDS kehrt die Methode früh zurück — mit
Toast und dauerhaft hängendem `aiLoading` (kein `finally`). Deshalb reicht das Panel die Vorschläge
weiter über `element.suggestions` ein — jetzt aber die vom Server geladenen, mit echten IDs. Nur der
`type: 'AI'` wird angezeigt: jedes Widget filtert `s.type === 'AI' && s.status === 'PENDING'`.

**b) Ein Vorschlag greift nur in ein leeres Feld.** Im Text-Widget:
`if (!this.formControl.value?.trim() && suggestion && show)`. Was der Node schon trägt, wird nie als
Vorschlag markiert — daher `withoutAiFields()`, das die vorgeschlagenen Properties aus dem Node
nimmt, mit dem das Formular gebaut wird. Der in Schritt 1 geschriebene **Titel** steht auf dem Node;
ein Titel-Vorschlag wäre ohne dieses Herausnehmen unsichtbar.

**c) Multivalue-Chips können es nicht.** `cclom:general_keyword` hat in keinem der beiden Wege eine
Vorschlagsdarstellung. Die Schlagworte lägen im Store und würden im Formular nicht angeboten.

## Was der Weg einbringt

Die Anzeige im Panel gab es schon vorher, rein im Speicher. Der Unterschied liegt dahinter:

- Die Vorschläge **überleben die Panel-Sitzung**: eine Redaktion öffnet den Node später im
  edu-sharing-Workspace und sieht dieselben Vorschläge mit Annehmen/Ablehnen.
- `POST /search/v1/suggestions/{repo}` liefert einen **Arbeitsvorrat** — alle Nodes mit offenen
  Vorschlägen, gefiltert nach Status und Typ.
- Angenommen/abgelehnt wird **protokolliert** und ist auswertbar.
- `description` und `confidence` pro Feld sind vorgesehen. Der Agent liefert beides nicht, deshalb
  steht überall `'METHODOLOGY'` und `1`: `_origins` kennt nur `'ai' | 'user'`, und
  `processing.llm_model`/`llm_provider` werden verworfen.
- `MetadataSuggestionEvent` in den Benachrichtigungen.

## Grenzen

- Hängt am `mongo-plugin` der jeweiligen Instanz. Kein Feature-Detect über `/_about`: schlägt der
  Aufruf fehl, hält das Repository keine Vorschläge, und der Editor nimmt den Rückfall —
  `aiSuggestionsFor()` aus dem Ergebnis des Laufs, wie vorher.
- Braucht einen Node: Drafts (`-draft-`, `editorMode='form'`, `EDITOR_MODE_FOR_DRAFT` in
  `app-src/src/app/util/mds-node.ts`) tragen keine Vorschläge — auch sie nehmen den Rückfall. Im
  Dev-Modus (`writesSkipped`) entsteht gar kein Node.
- Die Gast-/Agent-Route schreibt keine Vorschläge — dort gehört der Node dem Agenten, das Panel darf
  auf ihm meist gar nicht schreiben. Auch das ist ein Fall für den Rückfall.
- Mehrfaches Erschließen desselben Node würde Vorschläge stapeln; `propose()` löscht deshalb vorher
  die eigene `version` (`DELETE ?version=browser-extension`) und lässt fremde Versionen stehen.
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
