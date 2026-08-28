# Reifegrad — was gebaut ist, was im Core und was im WLO-Kontext gilt

Bestandsaufnahme der eingebauten Funktionalitäten, aufgeteilt nach den beiden Kontexten, in denen
das Panel läuft, und mit der Lücke, die für Reife noch zu schließen ist.

- **Core** — ein Basis-Repository ohne Zusatz-Konfiguration.
- **WLO-Kontext** — ein Repository, dessen Config die Variable `browserExtensionCustomWebComponent`
  auf `true` setzt. Das ist der **einzige** Schalter, der die beiden Kontexte trennt
  (`app-src/src/app/services/browser-extension-custom-web-component.service.ts`); welche Option er
  wo greift, steht im Options-Registry `app-src/src/app/model/navigation.ts`.

Was die Optionen inhaltlich tun, ist [FEATURES.md](../FEATURES.md); die bekannten Einschränkungen sind
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md), der Testrückstand [TEST-PLAN.md](../TEST-PLAN.md).

- [Erschließen und Metadaten](#erschließen-und-metadaten)
- [Einordnen und Weitergeben](#einordnen-und-weitergeben)
- [Inhaltsübersicht und Utilities](#inhaltsübersicht-und-utilities)
- [Querschnitt](#querschnitt)
- [Die nächsten drei Schritte](#die-nächsten-drei-schritte)

---

## Erschließen und Metadaten

| Funktion | Core (Basis-Repo) | WLO-Kontext | Was für Reife fehlt |
|---|---|---|---|
| **Login / Session** | Login erforderlich (Basic auth → `validateSession`) | Login **abgeschaltet**: `authorized = loggedIn ‖ flag`, der Host bringt die Gast-Session | Safari: ITP blockt evtl. das Session-Cookie, „logged-in auth needs verification" (TROUBLESHOOTING). Die Gast-Route hat ein **2-h-Editierfenster**, danach 403 → Login-Zwang mitten im Flow |
| **Inhalt erschließen** (`POST /generate` über den Background-Worker) | identisch | identisch | **Größte Lücke:** die Agent-Adresse ist auf `APP_CONFIG.defaultRepositoryUrl` **gepinnt** (`…/rest/bapi/api/v1/proxy/metadata-agent-canvas` auf openeduhub-staging) und autorisiert per Repository-Session. In einem fremden Core-Repo antwortet der Proxy also nicht — die Kernfunktion ist dort faktisch nicht nutzbar |
| **Seiten-Erkennung** (`getWebsiteInformation`/`duplicateNodes`, OnlyOffice `DOCUMENT_INFO`) | identisch | identisch | – |
| **Metadaten editieren** | `edu-sharing-mds-editor-wrapper`, Metadatenset = Repo-`DEFAULT` | `metadata-agent-canvas` (`mode="edit"`), Set = `mds_oeh` | MDS-Editor-Rendering (CSP `script-src 'self'` plus CORS/Auth für die MDS-Definition) ist **im echten Browser unverifiziert**. Der WLO-Canvas hat **kein Dark Theme** (293 Farb-Literale) → zwei Screens bleiben hell |
| **Speichern** | Route hängt an der **Session**, nicht am Flag: eingeloggt → eigener Write (`obeyMds=true`, `-inbox-`); Gast → Agent-`POST /nodes` | zusätzlich `ccm:oeh_extendedType` / `_lrt` / `_extendedData` / `_extendedText` als eigener Write, Workflow `200_tocheck` an `GROUP_ORG_WLO-Uploadmanager` | Auf der Agent-Route ist die **Ordnerwahl unmöglich** (schreibt immer in den Inbox des Agents). Der Bulk-Write der extended fields wird feldweise wiederholt, Fehler werden nur geloggt. `curation.service.ts` (1595 Zeilen) ist praktisch **untested** — 441 von 446 Zeilen uncovered |
| **Vorschau (Bild und Titel)** | `edu-sharing-preview-sidebar` | Canvas `mode="detail"` | Der Vorschaubild-Upload läuft separat (`/preview`); ein nicht dekodierbares Bild wird nur in `preview.error` gemeldet |
| **Datei oder Link / Neues OnlyOffice-Dokument** | identisch, braucht eine eigene Session | identisch — fällt mit Gast-Session weg | Mit Gast-Session sind „Inhalt hinzufügen" und „Meine Inhalte" im WLO-Panel ohne echten Login nicht verfügbar |

## Einordnen und Weitergeben

| Funktion | Core | WLO-Kontext | Was für Reife fehlt |
|---|---|---|---|
| **An Redaktionen weiterleiten** | Schritt existiert, aber **nur die Nostr-Relay-Zeile** — der Redaktionsteil wird nicht gerendert, und die Requests dahinter laufen nicht | Gruppen aus `browserExtensionEditorialGroups`, Ticken = Weiterleitung, Untersammlungs-Auswahl, Vorschlag durch den Topic-Assistant | Die Gruppen kommen aus **einer** Config-Variable, ohne UI oder Fallback wenn sie fehlt; der Topic-Assistant hängt am gleichen B-API-Proxy wie der Agent |
| **Sammlung auswählen** | – (es gibt keine Gruppen-Row zum Einstieg) | eigener Schritt, Bestätigung über einen `ApplyHandler`, weil das Element keine API zum Bestätigen anbietet | Fragile Kopplung: der Footer **klickt den Button im Element** |
| **Persönliche Ablage** | Ordner (`es-storage-location-picker`) plus optionale Sammlung | identisch, aber nur mit eigener Session | – |
| **An Nostr Relay senden / weiterleiten** (AMB, kind 30142) | **voll vorhanden** — Mapping `util/amb-event.ts`, Signieren, `EVENT`/`OK`, Lookup über zwei `REQ`-Filter (`#d`, `#r`), Receipt mit `nak`-Kommandos | identisch | Im Core sind **Relay-Adresse und `npub` nicht einstellbar** (die Settings-Gruppe steckt hinter `wlo.enabled()`) → publiziert wird nur gegen den hartkodierten Default. Der Schlüssel liegt allein in diesem Browser, **ohne Export oder Backup**; eine Ablehnung wird nicht persistiert; ein Relay mit NIP-42-Auth wird nicht bedient |
| **Prüfprozess auswählen** | – (die Ablage führt direkt in die Metadaten-Ansicht) | zwei Karten: strukturierte gegen KI-Prüfung | Der Start der KI-Prüfung **löscht die gespeicherte Konversation** |
| **Qualitätsprüfung** | nur der **Metadaten**-Tab | „Qualität"-Tab aus `mds_oeh` plus Gate: die Metadaten erst nach erfüllten Knock-out-Kriterien | Die **maschinelle Beurteilung läuft in beiden Kontexten** (`analyze()` → `judgeQuality()`), ist im Core aber **nicht sichtbar und nicht abschaltbar** — MetalookUp ist per Default an, ContentJudge aus und ohne Basic-Auth-Zugang gar nicht anbietbar. Drei von elf Kriterien haben **kein Schema** (`data_privacy`, `copyright_law`, `relevancy_for_education`), und Barrierearmut hängt an genau einer AXE-Regel |
| **Individuelle KI-Prüfung (Boerdi)** | – | Dialog gegen die Anforderungen der Sammlung | `page_text` erreicht das Modell nur, wenn **nichts** über `node_id`/`collection_id` auflöst → bei einem gespeicherten Inhalt urteilt das Modell über den Backend-Block. `util/chat-overrides.ts` trägt zweimal `TODO: Replace by updated chatbot version` |
| **Boerdi „Frage stellen"** | – | Chat-Widget mit explizit übergebenem Seitenkontext | wie oben |

## Inhaltsübersicht und Utilities

| Funktion | Core | WLO-Kontext | Was für Reife fehlt |
|---|---|---|---|
| **Vorschau / Nutzung / Teilen (QR)** | identisch (`edu-sharing-preview-sidebar`, `-usages`, `-share-qr`) | identisch | – |
| **Interaktionen** | nur das **Nostr-Standing** (`es-nostr-standing`) | zusätzlich eine Redaktionskarte je Weiterleitung | Die Timeline unter den Karten ist als **„Entwurf"** ausgewiesen: das Repository liefert keine Kommunikationshistorie, die Schritte sind ein Beispiel. Die auffälligste inhaltliche Lücke der Reife |
| **Verlauf** | identisch, lokal, `maxHistory: 200` | identisch | Rein lokal, ohne Serversicht und ohne Sync zwischen Geräten. **Doku-Drift:** FEATURES.md beschreibt den Verlauf als Topbar-Icon mit Badge und listet eine Option „WLO Metadaten-Agent" — in `navigation.ts` ist der Verlauf ein Menüeintrag und `settings` das einzige `topbar: true` |
| **Einstellungen** | Repository-URL, Darstellung, **Entwickler-Optionen** | zusätzlich KI/Chatbot, Sammlungsempfehlung, Qualitätsprüfung, Nostr-Relay | Vier von fünf Gruppen sind an das WLO-Flag gebunden, obwohl **Nostr und die Qualitätsjudges im Core laufen** → ein Core-Betreiber hat keinen Zugriff auf die Einstellungen wirksamer Features |
| **Darstellung / Theme** | System/Hell/Dunkel, edu- und boerdi-Bundle folgen live | identisch | Das edu-Bundle folgt nur über einen **gepatchten `matchMedia`** — `prefers-color-scheme` meldet im Sidebar-Dokument das Panel-Theme, und ein Bundle-Update kann das still auf Hell zurückfallen lassen |
| **OnlyOffice: Metadaten anreichern / Passende Inhalte / Inhalt suchen** | identisch | identisch | Braucht das seitenseitige Plugin und ist ohne OnlyOffice nur über den Debug-Modus testbar. Die Suche nutzt bewusst **nur die ersten zwei Schlagworte** plus eine Fallback-Kette |

## Querschnitt

| Thema | Stand | Lücke |
|---|---|---|
| **Automatisierte Tests** | 21 Specs, 445 `it()`, 38,8 % Statements über `services/**` und `util/**` | Keine **Komponententests** (48 Dateien), `model/` und `scripts/*.mjs` ungetestet. Die vier größten uncovered Brocken: `curation.service.ts`, `editorial-groups.service.ts`, `util/quality-check-request.ts`, `quality-judge.service.ts` |
| **Browser-Parität** | Chrome/Edge/Firefox gebaut, CI mit Release-Job auf `v*`-Tags | **Safari**: der `host_permissions`-CORS-Bypass ist unzuverlässig, der Login unverifiziert. **Firefox**: „Receiving end does not exist" ist nur per Retry abgefangen, die Ursache offen |
| **Store-Fähigkeit** | `web-ext lint`: 0 Errors, ~204 Warnings (alle aus den Vendor-Bundles) | `host_permissions: https://*/*` und `connect-src https: wss: ws: data: blob:` → strenges Review erwartet; `dist/` ist **54 MB** (pdf.js 21 MB, TinyMCE 13 MB); AMO verlangt künftig `data_collection_permissions` |
| **Abhängigkeiten** | `ngx-edu-sharing-api` 11.0.2 mit `legacy-peer-deps`, `lodash` selbst nachgezogen | Das Test-Setup hängt an der **undokumentierten Shape** von `browser-polyfill.js`; `@angular/build:unit-test` ist `[EXPERIMENTAL]`; die Repository-URL wirkt erst nach einem Sidebar-Reload |
| **Version** | 0.1.5 | – |

## Die nächsten drei Schritte

1. **Die gepinnte Metadaten-Agent-Adresse lösen** — sie macht die Kernfunktion außerhalb des
   Default-Repositories unbenutzbar.
2. **Die Settings-Gruppen für Nostr und Qualitätsprüfung aus dem WLO-Gate nehmen**, weil die
   Features darunter im Core aktiv sind.
3. **Die Interaktions-Timeline** auf echte Daten stellen oder den Entwurfsteil vorerst ausbauen.
