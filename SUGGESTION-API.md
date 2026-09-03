# Suggestion-API

Was die edu-sharing Suggestion-API kann, wie der Core-MDS-Editor sie benutzt und wie das Panel sie
benutzt: die Erschließung legt die Felder des Agenten als KI-Vorschläge am Node ab, der Schritt
*Metadaten bearbeiten* lässt das Repository ergänzen, was noch fehlt, und liest beides von dort.

- [Die API](#die-api)
- [Wie der Core-Editor sie benutzt](#wie-der-core-editor-sie-benutzt)
- [Wie das Panel sie benutzt](#wie-das-panel-sie-benutzt)
- [Erzeugen lassen: der b-API-Lauf](#erzeugen-lassen-der-b-api-lauf)
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

- `app-src/src/app/util/mds-suggestions.ts` — `proposedFieldsOf()` zieht die `_origins`-Schlüssel, die
  einen Vorschlag bezeichnen, also `'ai'` **und** `'page'`; `aiSuggestionRequests()` macht daraus
  `CreateSuggestionRequestDto[]` (ein Eintrag pro Property **und Wert**, `description: 'METHODOLOGY'`,
  `confidence: 1`), `storedAiSuggestions()` formt die Antwort des Repositories in die Form, die die
  Widgets lesen. `aiSuggestionsFor()` baut dieselbe Form rein im Speicher — der Rückfall, wo das
  Repository keine Vorschläge hält. `aiFieldsOf()` meint dagegen **nur** `'ai'` und beantwortet die
  eine Frage, die wirklich nach einem Modell fragt: den Dateinamen zu einem erzeugten Titel
  (`MdsPreviewWidgetComponent`).
- `app-src/src/app/util/mds-form-widgets.ts` — `formWidgets()` liest die Widgets des gerenderten
  Formulars aus dem Satz: die Gruppe nennt die Views, das `html` einer View platziert die Widgets
  über ihre Id als Element. `aiConfigWidgets()` nimmt davon die mit `aiConfigs` — das sind die
  `widgetAiConfigs` des [b-API-Laufs](#erzeugen-lassen-der-b-api-lauf).
- `app-src/src/app/features/metadata/mds-editor/mds-editor.component.ts` — führt die Quellen des
  Angebots **pro Property** zusammen (`mergeSuggestions`), damit jede nur füllt, was die vorherigen
  offen gelassen haben: was das Repository für den Knoten hält, dann was ein Lauf gemeldet hat, dann
  die Funde der Erschließung, zuletzt die Werte, die die Vokabulare dieses Formulars für die Wörter
  der Seite halten (`MdsValuespaceService`, aus dem Umschlagschlüssel `_page_terms`). Ein vorgeschlagenes
  Feld wird über `withoutAiFields()` aus `element.nodes` zurückgehalten — ein Widget bietet nur an,
  solange sein eigener Wert leer ist.
- `app-src/src/app/services/suggestion.service.ts` — `propose()` und `load()`, beide bestenfalls:
  jede Seite meldet, was sie erreicht hat, und wirft nicht. `propose()` löscht vorher die eigene
  `version` (`browser-extension`), damit eine wiederholte Erschließung die Vorschläge ersetzt statt
  sie zu stapeln. Die Lizenz wird nie vorgeschlagen — sie wird gesetzt.

  Beide Wege gehen hier durch. Ist *WLO-Funktionen verwenden* aus, beschreibt die Erschließung den
  Inhalt aus den Aussagen der Seite (`MetadataAgentService.readPage` → `PageDerivationService`, siehe
  [FEATURES.md § Metadata without a model](FEATURES.md#metadata-without-a-model)). Was die Seite
  **auszeichnet**, wird 1:1 übernommen und trägt gar kein `_origins` — es steht als Wert im Formular.
  Was aus der Seite **abgeleitet** ist (Schlagworte aus ihrem Text, eine Beschreibung aus ihrem ersten
  Absatz), trägt `_origins` mit `'page'` und wird wie ein Modellvorschlag vorgeschlagen: derselbe
  `propose()`-Aufruf, derselbe `type: 'AI'`, dieselbe Annahme über den Vorschlagsspeicher. Hält das
  Repository keine Vorschläge, baut `aiSuggestionsFor()` dasselbe Angebot im Speicher.

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
- `app-src/src/app/features/metadata/mds-editor/mds-editor.component.ts` — `ngOnInit()` lässt erst
  erzeugen ([b-API-Lauf](#erzeugen-lassen-der-b-api-lauf)) und lädt dann die Vorschläge des Nodes;
  `mount()` setzt sie als `element.suggestions` und reicht den Node über `withoutAiFields()`
  **ohne** die vorgeschlagenen Properties hinein, damit die Widgets leer sind. Solange der Lauf läuft,
  steht statt des Formulars „Metadaten werden vorgeschlagen…".

Warum weiter über den Input, obwohl der Wrapper sie selbst holt: nur `setExternalSuggestions()` —
der Patch im vendorten Bundle — setzt `suggestionMetadata$` **und** `showAiSuggestions`. Der
Ladeweg des Editors setzt den Schalter nicht, und ohne ihn zeigt kein Widget einen Vorschlag an
(Haken a).

## Erzeugen lassen: der b-API-Lauf

Der Vorschlags-Speicher hält, was jemand hineinlegt — *erzeugt* werden die Vorschläge von einem
zweiten Dienst, dem die b-API vorsteht. Ihn stößt im Repository-UI der Schalter *Metadaten
generieren* an ([Haken a](#drei-haken)); das Panel stößt ihn selbst an, im Schritt *Metadaten
bearbeiten*, **bevor** das Formular gebaut wird (`MdsAiSuggestionService`, gerufen aus
`MdsEditorComponent.loadSuggestions`).

| | |
|---|---|
| Client | `EduSharingLlmService.suggestions()` aus `ngx-edu-sharing-b-api`; die `rootUrl` setzt `BApiModule.forRoot(…)` in `app.config.ts` auf die der REST-API plus `/bapi` |
| Endpunkt | `POST {rootUrl}/bapi/api/v1/edu-sharing/suggestions` — `rootUrl` ist der der REST-API (`…/edu-sharing/rest`), weshalb der Interceptor der Bibliothek die Session mitschickt |
| Repository | das **konfigurierte**, nicht das des Metadaten-Agenten: die Vorschläge hängen am Node, und der liegt dort (anders als `MetadataAgentApiService`, siehe [ARCHITECTURE.md](ARCHITECTURE.md#the-metadata-agents-address)) |
| Body | `EduSharingLlmWidgetAiConfigRequest`: `user` (`authorityName`), `metadataSet`, `configIds: [{ type: 'mds', id: 'suggestion_ai' }]`, `widgetAiConfigs: [{ widgetId, aiConfigId }]`, `contextNodeId`, `variables` |
| `metadataSet` | der Satz, den die Client-Konfiguration unter `availableMds` fürs Heim-Repository (`-home-`) nennt, z. B. `mds_oeh` — nicht der des Formulars: `-default-` adressiert einen Satz an den MDS-Endpunkten, ist aber keine Id, unter der die Generierung konfiguriert ist. Nennt die Konfiguration keinen, bleibt der Lauf aus |
| `widgetAiConfigs` | die Widgets **des gerenderten Formulars** mit `aiConfigs`: die Gruppe (`io`) nennt die Views, deren `html` die Widgets platziert (`aiConfigWidgets()` in `app-src/src/app/util/mds-form-widgets.ts`, Satz aus `GET /mds/v1/metadatasets/…`), je einmal, `aiConfigId: 'default'` wie im Core — nicht das ganze Vokabular des Satzes |
| `variables` | was der Lauf **liest**: jede Property, für die das Formular schon einen Wert hält (bei `VARIABLE_MAX` = 2 000 Zeichen je Wert abgeschnitten), dazu `textContent` (der Text der Seite) |
| Ergebnis | steht danach am Node und wird über `getSuggestionsByNodeId` gelesen; die Antwort des Laufs (`SuggestionResponseDto[]`) ist der **Rückfall**, falls der Speicher sie nicht herausgibt (`proposedAiSuggestions()`) |

Der Unterschied zum Schalter des Core-Editors ist genau das `variables`: das Panel reicht hinein, was
es über den Inhalt weiß — alles, was das Formular schon hält, samt dem, was die Seite über sich
aussagt, plus den Text der erschlossenen Seite. Dagegen sind die Prompts des Metadatensatzes
geschrieben: der Core-Prompt liest `var(cclom:title)`, `var(cclom:general_description)`,
`var(cclom:general_keyword)`, `var(cm:name)`, `var(ccm:wwwurl)`,
`var(ccm:educationallearningresourcetype)` und `node(textContent)` namentlich, und je mehr davon
belegt ist, desto weniger muss ein Lauf erschließen.

**Kontext und Verzicht sind dabei zweierlei.** `variables` ist, was die Prompts lesen dürfen;
`settled` (das zweite Argument von `MdsAiSuggestionService.generate`) ist, wonach gar nicht erst
gefragt wird. Nur ein Feld, das im Formular als **entschiedener Wert** steht, wird ausgelassen — ein
Feld, das als Vorschlag markiert ist (`_origins` = `'ai'` oder `'page'`), bleibt im Lauf, denn ein
Vorschlag ist genau das, wofür eine Generierung da ist, und der Prompt des Satzes beantwortet ihn
womöglich besser (`MdsEditorComponent.decidedFields`).

Ohne die WLO-Funktionen ist dieser Lauf die **einzige** Erzeugung im Ablauf: `/generate` wird dann
nicht gerufen. Was die Seite über sich aussagt, steht dann schon im Formular
([FEATURES.md § Metadata without a model](FEATURES.md#metadata-without-a-model)) — und weil es dort
als entschiedener Wert steht, wird es hier nicht noch einmal erzeugt, sondern als Kontext
mitgereicht.

Best-effort wie der Speicher daneben: kein Dienst, kein `aiConfig` im Satz, ein fehlgeschlagener Lauf
— das Formular zeigt dann, was der Node ohnehin schon trägt. Ein Lauf pro Node und Sitzung, und
`textContent` wird bei `TEXT_VARIABLE_MAX` (20 000 Zeichen) abgeschnitten.

Das Log sagt, woran es liegt, wenn ein Feld leer bleibt: die Zeile über den Satz nennt unter
`toGenerate`, wonach gefragt wird, unter `alreadyDecided` die Felder, die das Formular schon
entschieden hält, unter `withoutAiConfig` die, für die der Satz keine Generierung beschreibt, und
unter `context` die Variablennamen; `← the run proposed` nennt je Property die vorgeschlagenen Werte
und unter `withoutProposal` die Felder, für die der Lauf nichts geliefert hat.
Steht ein Feld dort, fehlt dem Widget der Prompt — nicht dem Panel die Anfrage.

## Der Ablauf

1. **Node entsteht früh.** Im Schritt *Vorschau* schreibt `CurationService.createContent()` den Node
   mit `cclom:title` + `ccm:wwwurl`. Ab da gibt es eine Node-ID, an der Vorschläge hängen können.
2. **Vorschläge hinterlegen.** Direkt danach `CurationService.proposeGeneratedMetadata()` →
   `POST /suggestions/v1/-home-/{nodeId}?type=AI&version=browser-extension`, ein Eintrag pro
   Property und Wert. Nur auf der eigenen Schreibroute: der Node der Agent-Route gehört dem Agenten.
   Und nur mit den WLO-Funktionen: ohne sie hat der Lauf nichts erzeugt, was vorzuschlagen wäre.
3. **Erzeugen lassen.** Der Schritt *Metadaten bearbeiten* lässt zuerst das Repository erzeugen, was
   der Inhalt noch nicht über sich sagt — der [b-API-Lauf](#erzeugen-lassen-der-b-api-lauf), mit dem
   Titel und dem Seitentext als `variables`. Abgewartet, nicht nebenher: ein Formular, das während
   des Laufs steht, böte nichts davon an.
4. **Der Editor lädt sie mit dem Formular.** Derselbe Schritt holt sie dann über
   `getSuggestionsByNodeId` (Status `PENDING`) und reicht sie dem Wrapper als `suggestions` hinein.
5. **Jedes Widget bekommt seine** über `initWithNodes` → `updateSuggestions()`.
6. **Übernommen** wird über `setSuggestionState`; das PATCH zurück ins Repository setzt das Panel
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

**c) Ein Vorschlag wird sofort übernommen, nicht angeboten.** Das gilt für jeden Widget-Typ und ist der
Punkt, an dem „es kommt kein Vorschlag" meist eine Fehldiagnose ist — der Wert *steht* schon im Feld:

| Widget | Was mit einem `PENDING`-`AI`-Vorschlag passiert |
|---|---|
| Text/Textarea | füllt das **leere** Feld und markiert es (`applySuggestion`); ein Feld mit Inhalt bleibt unberührt |
| Select, Radio, Tree (einwertig) | setzt den Wert und schaltet den Vorschlag auf `ACCEPTED`; ein Wert außerhalb des Valuespace wird verworfen — im Log: `Invalid suggestion "…" received for <widget>, not in valuespace` |
| Slider, Duration | dasselbe, solange das Widget nicht `dirty` ist |
| Chips (mehrwertig, z. B. `cclom:general_keyword`) | `addSuggestion()` → `add()` **plus** `ACCEPTED`; im Log steht dann je Wert ein `set value {key: …}` |

Markiert wird das Ergebnis über die Klassen `chip-is-suggestion` / `chip-is-suggestion-ai`
(`--aiColor`, lila) — sichtbar wird also ein *übernommener* Vorschlag, kein wartender. Was das Formular
gar nicht zeigt, hat auch keinen Vorschlag bekommen: dann fehlt dem Widget der `aiConfig` im
Metadatensatz, oder der Lauf hat für dieses Feld nichts geliefert (siehe das `withoutProposal` im Log
von `MdsAiSuggestionService`).

## Was der Weg einbringt

Die Anzeige im Panel gab es schon vorher, rein im Speicher. Der Unterschied liegt dahinter:

- Die Vorschläge **überleben die Panel-Sitzung**: eine Redaktion öffnet den Node später im
  edu-sharing-Workspace und sieht dieselben Vorschläge mit Annehmen/Ablehnen.
- `POST /search/v1/suggestions/{repo}` liefert einen **Arbeitsvorrat** — alle Nodes mit offenen
  Vorschlägen, gefiltert nach Status und Typ.
- Angenommen/abgelehnt wird **protokolliert** und ist auswertbar.
- `description` und `confidence` pro Feld sind vorgesehen. Der Agent liefert beides nicht, deshalb
  steht überall `'METHODOLOGY'` und `1`: `_origins` sagt nur, woher ein Wert kommt, nicht wie sicher er
  ist, und `processing.llm_model`/`llm_provider` werden verworfen.
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
