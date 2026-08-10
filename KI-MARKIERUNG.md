# KI-Markierung in den eingebetteten Editoren

Wie die beiden eingebetteten Metadaten-Editoren zeigen (oder nicht zeigen), welches Feld von der KI
gefüllt wurde. Stand: verifiziert am 2026-08-10 gegen die vendorten Bundles
`scripts/wlo/main.eaf31583c76c25f4.js` und `scripts/edu/` (dort `chunk-NIKR5NGM.js` für die
Widgets/den Wrapper, `chunk-DWUNDKO2.js` für `MdsEditorInstanceService`).

| | WLO-Canvas (`<metadata-agent-canvas>`) | edu-sharing MDS-Editor (`<edu-sharing-mds-editor-wrapper>`) |
|---|---|---|
| Öffentliche Option | `highlightAi` / `highlight-ai` | **keine** (23 Inputs, keiner betrifft KI) |
| Herkunft je Feld | `_origins` im Payload, clientseitig | serverseitiger Vorschlagsspeicher (mongo-plugin), `type: 'AI'` vs `USER_PROPOSAL` |
| CSS | Klasse `ai-generated`, Farbe hart `#7c3aed` | Klassen `isAiSuggestion`, `chip-is-suggestion-ai`, `is-suggestion-ai`, Token `--aiColor: #2c0799` |
| Überlebt Bearbeitung | ja (Flag bleibt am Feld) | nein — Status kippt auf `DECLINED`, Farbe verschwindet |
| Im Plugin aktiv | ja, im Bearbeitungs-Modus | nein |

---

## 1. WLO-Canvas: `highlightAi`

Setter im Bundle, Default aus:

```js
_highlightAi = !1
set highlightAi(e){ null != e && (this._highlightAi = !1 !== e && "false" !== e) }
```

Ein Property-Binding `[highlightAi]="true"` genügt also; `highlight-ai="true"` als Attribut ebenso.
Die Option wirkt in **allen** Layouts (jede Layout-Komponente nimmt sie als Input), nicht nur in
`layout="dialog"`, wo `WIDGET-REFERENZ.md` sie zeigt.

Gefärbt wird ein Feld, wenn alle drei Bedingungen gelten:

```js
this.highlightAi && this.field.isAiGenerated && this.field.status === FILLED && e.push("ai-generated")
```

```css
.ai-generated .md3-text-field textarea.mat-mdc-input-element,
.ai-generated .md3-text-field input.mat-mdc-input-element,
.ai-generated .md3-text-field .mat-mdc-select-value-text { color: #7c3aed }
.ai-generated .chip-container mat-chip { --mdc-chip-label-text-color: #7c3aed }
```

### `_origins` entscheidet, was als KI gilt

Beim Import setzt der Canvas pro Feld:

```js
isAiGenerated = !_origins || _origins[fieldId] !== 'user'
```

Daraus folgen zwei Fallen: ein Payload **ohne** `_origins` markiert jedes gefüllte Feld als
KI-generiert, und ein in `_origins` nicht genannter Schlüssel ebenso. Eine Bearbeitung im Canvas
setzt das Flag zurück (`updateFieldValue` → `isAiGenerated: !1`).

### Was das Plugin daraus macht

- `wlo-canvas.component.ts`: `highlightAi` steckt in `CONFIGS` — im Preset `edit` an, im Preset
  `detail` aus. Markiert wird, wo der Nutzer auch korrigieren kann; eine reine Anzeige der
  Eigenschaften hat nichts zu fragen.
- `CurationService.editorMetadata()` hängt an jeden Seed ein vollständiges `_origins` (siehe
  `fieldOrigins()` in `services/curation.service.ts`): `'ai'` nur, wenn die `_origins` des
  Agent-Laufs das für den Schlüssel sagen **und** er nicht per `recordValues()` gesetzt wurde, sonst
  `'user'` — und zwar für jedes Feld, wegen der Falle oben. Ohne das würden nach dem ersten Speichern
  (Seed = Node-Properties, ganz ohne Herkunft) sämtliche Felder lila.
- Verifiziert am gerenderten Bundle: `_origins` gemischt → nur die `'ai'`-Felder lila; kein
  `_origins` → alle; alles `'user'` → keins; `highlight-ai` aus → keins.

### Bekannte Grenze

Ein im Canvas korrigiertes Feld verliert die Farbe sofort — aber nur, solange die Komponente steht.
Der Commit trägt nur Werte zurück (`toMdsEditorValues`), keine Herkunft, also gilt das Feld beim
erneuten Betreten wieder als KI-Vorschlag.

---

## 2. edu-sharing MDS-Editor: Mechanismus ohne Schalter

Das edu-Bundle hat eine reichere Markierung als der Canvas — sie unterscheidet KI- von
Personen-Vorschlägen (`MDS.SUGGESTIONS.TYPE_AI: "KI"` / `TYPE_USER: "Person"`) und färbt über
Tokens:

```css
--aiColor: #2c0799;
--aiColorChipBg: color-mix(in srgb, var(--aiColor), #fff 75%);
```

Sie ist aber **nicht** über das Custom Element ansprechbar. Die Inputs des Wrappers:

```js
inputs:{addWidget,allowReplacing,bulkBehaviour,create,currentValues,customTitle,embedded,extended,
groupId,invalidate,labelNegative,labelPositive,toastOnSave,mode,nodes,nodeRefetch,graphqlIds,
parentNode,priority,repository,editorMode,setId,externalFilters}
```

Geschaltet wird sie ausschließlich von einem `mat-slide-toggle`, den der Editor selbst rendert
(„Metadaten generieren"): `showAiSuggestions.next(...)` kommt im ganzen Bundle genau einmal vor, in
`es-mds-editor-core.setAiSuggestions()`.

### Die Gates betreffen nur den Toggle

```js
updateHasAi(){ … this.hasAi.next(e && this.suggestionsSupported && this.editorMode === "nodes" && this.groupId === "io") }
hasUserAISupport(){ … return (yield this.auth.hasToolpermission(TOOLPERMISSION_BAPI)) && !!(yield about)?.plugins?.find(e => e.id === "b-api") }
```

`hasAi` entscheidet nur, ob der Toggle-Balken gerendert wird. Für die Färbung selbst braucht es weder
`b-api` noch `TOOLPERMISSION_BAPI` noch das `mongo-plugin`: die Fan-out-Subscription hängt allein an
der Knotenzahl, nicht am Modus.

```js
e?.length === 1 && (this.updateSuggestions(),
  this.mdsEditorInstanceService.suggestionMetadata$.pipe(…).subscribe(() => this.updateSuggestions()))
updateSuggestions(){ this.suggestionValuesSubject.next(this.mdsEditorInstanceService.suggestionMetadata$.value?.[0].suggestions[this.definition.id]) }
```

### Der Weg von außen — und was er kostet

Die Instanz ist erreichbar, die Property-Namen sind unminifiziert:

```js
const svc = document.querySelector('edu-sharing-mds-editor-wrapper')
  .ngElementStrategy.componentRef.instance.getInstanceService();   // === .mdsEditorInstance

svc.suggestionMetadata$.next([{ suggestions: {
  'cclom:title': [{ id: 'local-1', propertyId: 'cclom:title', value: '…', status: 'PENDING', type: 'AI' }]
}}]);
svc.showAiSuggestions.next(true);
```

Zu beachten: `.suggestions` ist **nicht** optional verkettet (`?.[0].suggestions[…]`), ein leeres
Array wirft; der Status muss `'PENDING'` sein (das Widget setzt selbst auf `'ACCEPTED'`, und genau das
schaltet die Klasse an); `componentRef` ist bis zum `connectedCallback` `null`.

Drei Eigenschaften machen den Weg für dieses Plugin unbrauchbar, sobald die Werte schon vorliegen:

1. **Nur leere Felder.** Skalare Widgets färben ausschließlich, was sie selbst einsetzen:
   ```js
   if (!this.formControl.value?.trim() && p && t) { … this.applySuggestion(this.aiSuggestion$) }
   ```
   Ein Wert, der bereits im Feld steht, wird nie markiert. Man müsste ihn aus dem Seed heraushalten —
   und ein Vorschlag, der nicht greift (Select-Wert nicht im Valuespace: nur `console.warn`),
   hinterlässt ein leeres Feld, das der nächste Save schreiben würde.
2. **Keywords sind nicht abgedeckt.** `isSuggestion(` existiert im Bundle genau einmal und gehört
   `es-mds-editor-widget-tree`. `es-mds-editor-widget-chips` (`multivalueBadges`, also
   `cclom:general_keyword`) hat keine KI-Färbung. Beim Tree-Widget kann ein Wert, der schon in
   `initialValuesSubject.value.jointValues` steht, ohnehin nicht markiert werden.
3. **`showAiSuggestions.next(true)` löst einen LLM-Lauf aus.** Die Subscription steht ungated im
   Konstruktor von `es-mds-editor-core`:
   ```js
   this.mdsEditorInstance.showAiSuggestions.pipe(U(e=>e),Ce()).subscribe(()=>{this.generateSuggestions()})
   ```
   `generateSuggestions()` zeigt unbedingt einen Toast, lässt `aiLoading` bei einem `return` im `try`
   dauerhaft auf `true` (es gibt kein `finally`), und wenn ein Widget `aiConfigs` deklariert, POSTet es
   an `eduSharingLlmService.suggestions` und überschreibt danach `suggestionMetadata$` mit einem
   Server-Fetch — die eingespeisten Daten sind dann weg. Umgehbar nur durch einen Monkey-Patch von
   `Widget.prototype.getShowAiSuggestions`.

Weitere Grenzen: Widgets, die über `initWithValues` initialisiert werden (Wertemodus ohne Node,
Suchfelder), abonnieren `suggestionMetadata$` gar nicht; `updateSuggestionState` wirft im Bulk-Modus;
und ein `save()` des Wrappers würde `PATCH /suggestions/v1/…` mit den erfundenen Ids senden (im Plugin
irrelevant, weil der eingebettete Wrapper nicht selbst speichert).

### Was das Plugin im MDS-Editor erfüllt

- `es-mds-editor` setzt `groupId = 'io'` und bei einem echten Node `editorMode = 'nodes'` — zwei der
  vier Toggle-Bedingungen wären also erfüllt. Ein Draft läuft in `'form'` (siehe
  `EDITOR_MODE_FOR_DRAFT` in `util/mds-node.ts`).
- `es-mds-preview-widget` fällt durch beide (`groupId = 'browser_extension_preview'`,
  `editorMode = 'form'`).

---

## 3. Vorgeschlagener Weg für den MDS-Editor (nicht umgesetzt)

Statt des Bundle-Mechanismus die Felder selbst markieren, im Lila des Bundles. Das deckt jedes
Widget ab (Keywords eingeschlossen), funktioniert auf schon gefüllten Werten und kann kein Feld leer
zurücklassen:

- `aiFieldsOf(payload)` neben `toMdsEditorValues` in `app-src/src/app/util/mds-values.ts` — die
  `'ai'`-Schlüssel aus `_origins`.
- `MdsEditorComponent` markiert nach dem Wrapper-Output `mdsLoaded` die betroffenen Widgets über den
  Hook, den `mds-editor.component.scss` schon zum Ausblenden nutzt: der Wrapper hängt jedes Widget in
  ein `<div data-element="<widget-id>">`.
- Eine Bearbeitung nimmt die Markierung wieder weg: der vorhandene `currentValuesChange`-Handler
  vergleicht den gemeldeten Wert mit dem geseedeten.
- Farbe `var(--aiColor, var(--es-ai))` mit `!important`, weil die Widget-Styles ihre Farben selbst mit
  `!important` setzen.
- Nur im Bearbeitungs-Editor, nicht im Preview-Widget — dieselbe Entscheidung wie
  `CONFIGS.detail.highlightAi = false` beim Canvas.
