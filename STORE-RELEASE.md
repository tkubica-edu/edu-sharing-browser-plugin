# Store-Reife: Chrome Web Store, Firefox AMO, Safari App Store

Bestandsaufnahme vom 28.08.2026, Extension v0.1.5. Was für eine Veröffentlichung in den Stores zu
tun wäre, was es kostet, und wo die Blocker liegen. Keine Empfehlung und keine Festlegung auf einen
Weg — Aufwände in Personentagen (PT) sind Schätzungen.

Was die Extension inhaltlich kann, ist [FEATURES.md](FEATURES.md); wie sie gebaut wird,
[BUILD.md](BUILD.md); die bekannten Einschränkungen [TROUBLESHOOTING.md](TROUBLESHOOTING.md); der
Reifegrad der Funktionen [MATURITY.md](MATURITY.md).

- [Ausgangslage](#1-ausgangslage--was-schon-store-fähig-ist)
- [Blocker für jeden Weg](#2-blocker-die-für-jeden-store-und-jede-sichtbarkeit-gelten)
- [Was jeder Store zusätzlich verlangt](#3-was-jeder-store-zusätzlich-verlangt)
- [Die drei Distributionswege](#4-die-drei-distributionswege-im-vergleich)
- [Was ein Reviewer anspricht](#5-was-ein-reviewer-voraussichtlich-anspricht)
- [CI](#6-ci-was-für-einen-store-upload-fehlen-würde)

---

## 1. Ausgangslage — was schon store-fähig ist

Der Aufwand liegt **nicht** im Bauen.

| | Stand | Belegt in |
|---|---|---|
| Manifest | MV3, `manifest.base.json` + drei Overlays, im Build gemerged | `scripts/build.mjs` |
| Browser-API | `webextension-polyfill` überall, promise-style; **kein `chrome.*` im First-Party-Code** | `vendor/browser-polyfill.min.js`, `sw.js` |
| Remote Code | keiner — alle drei Bundles gepackt, `script-src 'self'`, kein `eval` in eigenem Code | `manifest.base.json` CSP |
| Chromium-Only-APIs | bewusst vermieden: kein `sidePanel` (das Panel ist ein injizierter iframe), kein `offscreen`, kein `declarativeNetRequest`, `storage.session` mit Fallback | `content/panel-host.js:2`, `background/background.js:147` |
| `web-ext lint` | **0 Errors**, 204 Warnings (alle aus den Vendor-Bundles), 1 Notice (`MISSING_DATA_COLLECTION_PERMISSIONS`) | `npm run lint:firefox` |
| Paketgröße | 16,4 MB zip / 54 MB entpackt — unter allen harten Store-Limits | `dist/*.zip` |
| CI | baut alle drei Targets, zippt, GitHub-Release auf `v*`-Tags | `.github/workflows/build.yml` |

Nicht vorhanden: `LICENSE`, Datenschutzerklärung, Screenshots, Promo-Assets, Store-Accounts,
Upload-Jobs in der CI, Secrets (`.gitignore` listet nicht einmal `.env`).

### Lint-Warnings nach Quelle (204 gesamt, 0 Errors)

```
 52  UNSAFE_VAR_ASSIGNMENT   edu/assets/tinymce
 16  UNSAFE_VAR_ASSIGNMENT   edu/scripts.js
 14  DANGEROUS_EVAL          edu/assets/tinymce
 28  UNSAFE_VAR_ASSIGNMENT   edu/assets/viewer-5.4.1414*.mjs
 12  DANGEROUS_EVAL          edu/assets/pdf.worker-5.4.1414*.mjs
  7  UNEXPECTED_GLOBAL_ARG / DANGEROUS_EVAL   edu/assets/cordova
  6  UNSAFE_VAR_ASSIGNMENT   boerdi/boerdi-widget.js
  5  INLINE_SCRIPT           edu/index.html
  5  DANGEROUS_EVAL          edu/pdf-metadata-page.module-*.js
  4  INLINE_SCRIPT           wlo/examples/*.html
```

---

## 2. Blocker, die für jeden Store und jede Sichtbarkeit gelten

### B1 — Alle Default-Endpunkte zeigen auf Staging *(hart)*

`config.js:7` und `app-src/src/app/config.ts`:

- `https://repository.staging.openeduhub.net/edu-sharing` — Repository **und** der daran gepinnte Metadata-Agent
- `https://metalookup-2.staging.openeduhub.net`
- `https://llm-contentjudge.staging.openeduhub.net`
- `https://87.106.127.225.nip.io` — Chatbot-Backend, **nackte IP, hartverdrahtet** in `ai-assistant-screen.component.ts:21`, nicht in den Settings änderbar
- `wss://amb-relay.edufeed.org` — Nostr-Relay, immerhin eine echte Domain und konfigurierbar

Ein IP-Host ohne organisatorische Domain als Empfänger von Seitentext ist erfahrungsgemäß der
Punkt, an dem ein Chrome-In-Depth-Review hängen bleibt.

Optionen, kombinierbar:

| | Was | Aufwand |
|---|---|---|
| B1-a | Produktions-Hosts als Defaults eintragen; setzt voraus, dass die Deployments existieren, inklusive echter Domain für den Chatbot. Zusätzlich prüfen, dass Prod CORS/Auth für die Extension-Origin erlaubt | ≈1 PT |
| B1-b | Onboarding statt Default: die Extension startet ohne Repository und fragt es beim ersten Öffnen ab. Löst gleichzeitig den ersten der „nächsten drei Schritte" aus [MATURITY.md](MATURITY.md) — die gepinnte Agent-Adresse — und ist die sauberste Antwort auf „warum brauchst du Zugriff auf alle Seiten" | ≈3–5 PT |
| B1-c | Chatbot-, MetalookUp- und ContentJudge-URL konfigurierbar machen, wie Repository-URL und Relay es schon sind | ≈1–2 PT |

### B2 — Keine Datenschutzerklärung, keine LICENSE *(hart)*

Weder `LICENSE`/`COPYING` noch ein Datenschutzdokument im Repo; das Manifest nennt keine
Policy-URL. Alle drei Stores verlangen eine Datenschutzerklärung, sobald Nutzerdaten verarbeitet
werden — und hier verlässt Folgendes das Gerät:

- bis **20 000 Zeichen `innerText`** plus **10 000 Zeichen HTML** der Seite (`content/content.js:5-72,167-183`), zusammen mit URL, Titel, allen Meta-/OG-/Twitter-/DC-/LRMI-Tags und JSON-LD
- ein **JPEG-Screenshot des sichtbaren Tabs** (`background/background.js:338`), wenn die Seite kein eigenes Vorschaubild nennt
- Repository-Zugangsdaten (Basic, nur im Login-Request), danach ein Session-Cookie mit `credentials: 'include'` (`background/background.js:98`)
- bis **50 000 Zeichen** Inhaltstext an ContentJudge, bis 20 000 an den Chatbot
- ein lokal erzeugter, dauerhafter Nostr-Schlüssel — der Pubkey geht an ein öffentliches Relay

Zu schreiben: Datenschutzerklärung unter öffentlich erreichbarer URL, Support-URL, LICENSE.
**≈1–2 PT Textarbeit, plus externe juristische Abnahme.**

### B3 — `host_permissions: https://*/*` + `http://*/*` *(weich, aber teuer)*

Load-bearing für vier Dinge, siehe [TROUBLESHOOTING.md § Permissions](TROUBLESHOOTING.md#permissions):
Injektion in jede Seite, CORS-freier `fetch` aus dem Worker, Repository-Calls aus dem
Sidebar-Dokument, `credentials: 'include'`.

Chrome zeigt im Dashboard: *„Due to the Host Permission, your extension may require an in-depth
review which will delay publishing."*

Der Hebel wäre `optional_host_permissions` — Repository- und Chatbot-Host erst anfragen, wenn sie
konfiguriert sind. Das Panel selbst käme mit `activeTab` aus, **außer für einen Pfad**:
`restorePanel()` (`background/background.js:178`) re-injiziert `panel-host.js` bei jedem
`tabs.onUpdated` `status==='complete'` für jeden Tab mit offenem Panel — ohne Nutzerklick, und
dafür reicht `activeTab` nicht. Diesen Pfad umzubauen (Panel schließt bei Navigation, oder
Re-Injektion nur nach erneuter Nutzeraktion) ist die eigentliche Arbeit.
**≈2–4 PT**, plus ≈1 PT für die Begründungstexte je Permission.

Zwei Nebenpunkte:

- `clipboardRead` hängt an *einer* Option des Preview-Widgets, und Cmd+V funktioniert laut
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md#permissions) auch ohne. Streichbar → eine Rechtfertigung
  weniger.
- `web_accessible_resources` steht auf `https://*/*` und macht die Extension-ID für jede Seite
  lesbar (Fingerprinting-Frage im Review).

### B4 — AMO-Quellcodepflicht für die Vendor-Bundles *(hart, nur Firefox — der schwerste Punkt)*

Mozilla verlangt bei minifiziertem oder gebündeltem Code den Quellcode **plus reproduzierbare
Build-Anleitung**, und: *„all dependencies must either be included in the source code package
directly or downloaded only through the respective official package managers during the build
process."*

Dagegen steht:

| Bundle | Größe | Problem |
|---|---|---|
| `scripts/edu/` | 66 MB im Repo, 51 MB im Paket | minifizierter Angular-Production-Build, verbatim eingecheckt, gebaut aus einem internen Maven-Checkout. Ohne veröffentlichten Quellstand oder öffentliches Build-Rezept nicht erfüllbar |
| `scripts/boerdi/boerdi-widget.js` | 545 KB | wird von `scripts/fetch-widget.mjs` per HTTP von `87.106.127.225.nip.io` geholt, **ohne Checksumme**; der Docblock der Datei sagt selbst, „die Quelle ist die ganze Sicherheit". Genau der von AMO ausgeschlossene Fall |
| `scripts/wlo/` | 1,8 MB | gleiche Frage, kleinerer Umfang |

Zusammen 1271 der 1583 getrackten Dateien. [BUILD.md](BUILD.md) sagt dazu „Their contents are not
ours to shape".

Auswege: (a) Quellstände öffentlich machen und ein Build-Rezept beilegen, (b) die Bundles über
npm-Pakete beziehen statt eingecheckt, (c) AMO **unlisted** nutzen, wo die Prüfung erheblich
schlanker ist. **(a) und (b) sind nicht seriös schätzbar, weil sie außerhalb dieses Repos liegen.**
Das ist der Grund, warum Firefox-listed deutlich risikoreicher ist als Chrome-listed.

### B5 — Entwickler-Artefakte im Produktionspaket *(weich, schnell)*

`SHARED_DIRS` in `scripts/build.mjs` kopiert `background/` und `content/` verbatim, deshalb liegen
im Paket:

- `background/dev-fixtures.js` — 21 KB gefakte Agent-Antworten inklusive vollem Wikipedia-Text, von `sw.js` **immer** geladen
- `content/HOST-EVENTS.md` — 24 KB Doku
- `wlo/examples/*.html` — Demo-Seiten, Quelle von 4 `INLINE_SCRIPT`-Warnings
- `edu/index.html` — Startseite des Bundles, die die Extension nie öffnet, 5 Warnings

Prunbare Payload in `edu/assets`; der Mechanismus dafür existiert bereits — `BUNDLE_EXCLUDES` in
`scripts/build.mjs:34` schließt Monaco so aus:

```
13,0 MB  tinymce                  Skins/Themes/Plugins, nur bei einem Rich-Text-Widget im MDS gebraucht
 3,9 MB  locale                   113 Sprachen pdf.js-viewer.ftl
 2,2 MB  pdf.worker-*-es5.mjs     ┐
 2,1 MB  viewer-*-es5.mjs         ├ es5-Duplikate, zusammen ~5,4 MB
 1,0 MB  pdf.sandbox-*-es5.mjs    ┘
 1,7 MB  cmaps                    169 Dateien
 1,1 MB  cordova                  Quelle mehrerer DANGEROUS_EVAL-Warnings
```

Kein Limit-Problem, aber jedes MB weniger ist ein Reviewer, der schneller durch ist.
[TROUBLESHOOTING.md § Bundle size](TROUBLESHOOTING.md#bundle-size) argumentiert, dass pdf.js und
TinyMCE erreichbar sind und bleiben müssen — die es5-Duplikate, `locale` und `cordova` sind das
nicht. **≈1–2 PT**, der größere Teil davon Laufzeit-Verifikation.

### B6 — `postMessage` ohne Origin-Prüfung *(hart, Sicherheit)*

`content/panel-host.js:275-390` akzeptiert eingehende Envelopes allein am Marker
`data.source === 'edu-sharing-onlyoffice-plugin'` — **vor** dem
`event.source !== iframe.contentWindow`-Guard und ohne Origin-Check. Jede Seite im Tab kann damit
ein `PREVIEW_NODE` (landet in `storage.local` als `eduSharingPendingPreview`) oder ein gefälschtes
`DOCUMENT_INFO`/`DOCUMENT_CONTENT` in die Sidebar schieben. Ausgehend wird an *alle* Frames mit
`postMessage(envelope, '*')` gesendet. Ein In-Depth-Review findet das. **≈0,5–1 PT.**

### B7 — Stille Datenübertragungen *(hart für die Store-Disclosure)*

- **MetalookUp läuft per Default an** (`DEFAULT_METALOOKUP_ENABLED = true`) nach jeder erfolgreichen
  Erschließung — und ist im Core-Kontext laut [MATURITY.md](MATURITY.md) *weder sichtbar noch
  abschaltbar*, weil die Settings-Gruppe hinter `browserExtensionCustomWebComponent` hängt.
  Identisch mit dem zweiten der „nächsten drei Schritte" dort. **≈1–2 PT.**
- **Google Fonts zur Laufzeit** von `fonts.gstatic.com` (`app-src/src/index.html:15,19`) bei jedem
  Panel-Öffnen. Kein Store-Verstoß, aber bei einem deutschen Bildungsprojekt DSGVO-relevant und
  trivial zu lösen: self-hosten, dann fallen auch die `style-src`- und `font-src`-Ausnahmen aus dem
  CSP. **≈0,5 PT.**
- Solange das Panel offen ist, meldet der Worker **jede URL, zu der der Tab navigiert**
  (`background/background.js:209 announceUrl`) an `getWebsiteInformation` des Repositories.

**Summe B1–B7: ≈8–15 PT**, ohne die externen Abhängigkeiten (Produktions-Deployments, juristische
Abnahme, Bundle-Quellen).

---

## 3. Was jeder Store zusätzlich verlangt

### Chrome Web Store, Edge Add-ons gratis mit

| | |
|---|---|
| Kosten | **5 USD einmalig** pro Entwicklerkonto, keine Jahresgebühr; Konto-Verifizierung |
| Privacy-Tab | Single-Purpose-Beschreibung, **eine Begründung je Permission**, Remote-Code-Erklärung, Datenkategorien-Checkboxen plus drei Zertifizierungs-Häkchen, Privacy-Policy-URL |
| Assets | mindestens 1 Screenshot 1280×800 **oder** 640×400, Promo-Tile 440×280, 128px-Icon — **alles fehlt**, im Repo liegen nur `icons/{16,32,48,128}.png` |
| Paketlimit | 2 GB, 16,4 MB unkritisch |
| Review | breite `host_permissions` → In-Depth-Review, Wochen statt Stunden |
| Edge | eigenes Partner Center, kostenlos, **identisches Paket** — praktisch ein Zusatztag |

**Single-Purpose-Policy:** Chrome verlangt *„a single purpose that is narrow and easy to
understand"*. Die Extension macht Erschließung, Metadateneditor, Qualitätsprüfung, KI-Chat,
Nostr-Publikation, Datei-Upload und OnlyOffice-Integration. Als „Web-Inhalte in ein
edu-sharing-Repository erschließen" ist das argumentierbar; Chatbot und Nostr-Publikation sind die
Kandidaten, die als zweiter Zweck gelesen werden.

Weiteres: kein `_locales`-Verzeichnis, `name` und `description` sind deutsch-only — eine
Listing-Übersetzung läuft separat im Dashboard. Der Name „edu-sharing" muss beim einreichenden
Account liegen.

**Einreichung selbst: ≈2–4 PT**, danach Review-Wartezeit.

### Firefox AMO

| | |
|---|---|
| Kosten | keine |
| **`data_collection_permissions`** | **Pflicht für neue Extensions seit 03.11.2025**, in H1/2026 für alle. `web-ext lint` meldet den Notice heute schon. Zu setzen unter `browser_specific_settings.gecko`, hier realistisch `required: ["websiteContent", "authenticationInfo", "browsingActivity"]` — Seitentext, Repository-Login, und die an `getWebsiteInformation` gemeldeten URLs |
| Folge daraus | Das Feature braucht **Firefox 140+**; `manifest.firefox.json` steht auf `strict_min_version: "128.0"` und muss hoch |
| Quellcode | Source-Paket plus reproduzierbare Build-Anleitung → **B4** |
| Paketlimit | 200 MB, unkritisch. Aber: addons-linter kann Dateien >5 MB nicht parsen (`FILE_TOO_LARGE`), weshalb Monaco schon ausgeschlossen ist |
| listed vs. unlisted | unlisted = signiertes `.xpi` zum Selbstverteilen, deutlich schlankere Prüfung |
| Assets | Screenshots, Beschreibung, Kategorien |

Erlaubte Werte für `required` und `optional`: `none`, `authenticationInfo`, `bookmarksInfo`,
`browsingActivity`, `financialAndPaymentInfo`, `healthInfo`, `locationInfo`,
`personalCommunications`, `personallyIdentifyingInfo`, `searchTerms`, `websiteActivity`,
`websiteContent`; `technicalAndInteraction` nur als `optional`.

**Einreichung: ≈2–3 PT ohne B4**, mit B4 offen.

### Safari

Der teuerste Kanal und der einzige mit einem **offenen technischen Blocker**.

| | |
|---|---|
| Kosten | **Apple Developer Program, 99 €/Jahr** |
| Verpackung | Web-Extensions brauchen eine **Container-App**. `xcrun safari-web-extension-converter dist/safari` erzeugt das Xcode-Projekt; Apple erwartet in der App „some functionality, such as help screens and settings interfaces" — also echte UI, keine Hülle |
| Werkzeuge | Mac und Xcode. Neuere Apple-Doku beschreibt einen App-Store-Connect-Weg, der den lokalen Xcode-Schritt reduzieren soll (WWDC26, Session 216) — **vor einer Planung zu verifizieren**, nicht darauf bauen |
| CI | `ubuntu-latest` kann Safari nicht bauen → macOS-Runner plus Signing-Zertifikate als Secrets |
| Assets | 1024×1024 App-Icon, kompletter Icon-Satz, Mac-Screenshots, App-Store-Metadaten |
| **Offener Blocker** | [TROUBLESHOOTING.md](TROUBLESHOOTING.md#browser-specific): der `host_permissions`-CORS-Bypass für Extension-Pages ist auf Safari **unzuverlässig**, und ITP blockt möglicherweise das Repository-Session-Cookie im injizierten Panel-Kontext. Der eingeloggte Login ist damit **unverifiziert** und braucht eventuell einen Background-Auth-Fallback. Die Gast-Erschließung über den Worker ist unberührt |

Drei Abstufungen:

| | Was | Aufwand |
|---|---|---|
| S1 | Voll in den App Store: Container-App, App-Store-Connect-Eintrag, macOS-Runner — **und vorher den ITP-/Login-Blocker verifizieren und gegebenenfalls den Auth-Fallback bauen** | ≈8–15 PT, mit echtem Ausuferungsrisiko beim Auth-Fallback |
| S2 | „Build läuft und ist verifiziert": Konverter-Projekt einchecken, auf echtem Safari testen, Blocker dokumentieren, keine Einreichung. Beantwortet erst, ob S1 machbar ist | ≈3–5 PT |
| S3 | Safari raus. `dist/safari` bleibt Entwickler-Artefakt wie heute | 0 PT |

---

## 4. Die drei Distributionswege im Vergleich

| | Öffentlich gelistet, alle drei | Chrome + Firefox gelistet, Safari später | Unlisted / self-hosted |
|---|---|---|---|
| Blocker B1–B7 | alle | alle | alle, B4 entschärft |
| Chrome | volles Listing, In-Depth-Review | volles Listing | „unlisted" oder Enterprise-Policy-Install |
| Firefox | listed, **B4 blockierend** | listed, **B4 blockierend** | unlisted signing, B4 schlank |
| Safari | S1 | S2 | Developer-ID-notarisiert außerhalb des Store |
| Laufende Kosten | 99 €/Jahr plus 5 USD einmalig | 5 USD einmalig | ggf. 99 €/Jahr für Safari |
| Aufwand | **≈25–40 PT** plus Safari-Risiko | **≈15–25 PT** | **≈10–15 PT** |
| Review-Wartezeit | Wochen bis Monate | Wochen | minimal |
| Reichweite | öffentlich suchbar | öffentlich suchbar | nur über Link oder Policy |

Kontext zur Einordnung: die Extension ist heute ein Werkzeug für Redaktionen an
edu-sharing-Repositories, mit Defaults auf Staging und einer Kernfunktion, die laut
[MATURITY.md](MATURITY.md) außerhalb des Default-Repositories nicht nutzbar ist — „die
Agent-Adresse ist auf `APP_CONFIG.defaultRepositoryUrl` gepinnt … in einem fremden Core-Repo
antwortet der Proxy also nicht".

---

## 5. Was ein Reviewer voraussichtlich anspricht

- `host_permissions https://*/*` plus programmatische Injektion in jede Seite
- `tabs` und `captureVisibleTab` — Screenshots der besuchten Seite
- `clipboardRead`
- `web_accessible_resources` auf allen URLs → Extension-ID für jede Seite lesbar
- Off-Device-Übertragung von vollem Seitentext an Metadata-Agent, ContentJudge und Chatbot
- der **hartverdrahtete IP-Host** `87.106.127.225.nip.io` als Chatbot-Backend
- MetalookUp läuft per Default und ist im Core nicht abschaltbar
- eine **öffentliche, nicht widerrufbare** Nostr-Publikation kuratierter Metadaten
- Google-Fonts-Fetch zur Laufzeit
- 54 MB Vendor-Bundles mit Fremdcode; `frame-ancestors *` im CSP
- der Origin-lose `postMessage`-Eingangspfad in `content/panel-host.js`
- AMO: fehlende `data_collection_permissions` plus Quellcodepflicht

---

## 6. CI: was für einen Store-Upload fehlen würde

Heute existiert kein Upload-Job. Zu ergänzen wäre pro Store einer hinter dem `v*`-Tag:

- Chrome: `chrome-webstore-upload-cli`, mit Client-ID, Secret und Refresh-Token als Secrets
- Firefox: `web-ext sign` bzw. die AMO-API, mit JWT-Issuer und -Secret
- Safari: macOS-Runner mit `xcodebuild` und `notarytool`, plus Signing-Zertifikate

Außerdem: `npm run lint:firefox` läuft mit `continue-on-error: true`. Für eine Store-Pipeline
sollte mindestens `--warnings-as-errors` für die *eigenen* Verzeichnisse greifen, während die
Vendor-Bundles ausgenommen bleiben. Und `scripts/version.mjs` leitet die Version nicht aus dem Tag
ab; der Abgleich ist heute nur eine `::warning::` im Build-Job.

Randnotiz: `package.json` hat einen Tippfehler in `start:firefox` — `--source-di/r` statt
`--source-dir`.

---

## Quellen

- [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) — Syntax, erlaubte Werte, FF-140-Anforderung
- [Mozilla-Ankündigung vom 23.10.2025](https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/) — Fristen
- [AMO Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/) — Quellcodepflicht, Dependency-Regel
- [Chrome Web Store: Privacy-Tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome Web Store: Registrierung](https://developer.chrome.com/docs/webstore/register)
- [Chrome Web Store: Program Policies](https://developer.chrome.com/docs/webstore/program-policies/terms) — Single Purpose
- [Apple: Safari Extensions](https://developer.apple.com/safari/extensions/)
- [Apple: Packaging and distributing Safari Web Extensions with App Store Connect](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)
