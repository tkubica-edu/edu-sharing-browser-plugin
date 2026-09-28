# Store-Reife: Chrome Web Store, Firefox AMO, Safari App Store

Stand: 28.09.2026, Extension v0.1.5. Was für eine Veröffentlichung in den Stores noch zu tun wäre,
was es kostet, und wo die Blocker liegen. Keine Empfehlung und keine Festlegung auf einen Weg —
Aufwände in Personentagen (PT) sind Schätzungen.

`APP_CONFIG.featureBlacklist` (`app-src/src/app/config.ts`) schaltet in dieser Auslieferung
`onlyOfficeEvents`, `nostr`, `wlo`, `developerOptions`, `metalookup`, `contentJudge` und
`metadataAgentGenerate` fest ab — das ist der Stand, den B1, B3, B6 und B7 unten beschreiben. Ein
Deployment, das einen dieser sieben Einträge wieder freischaltet, muss die dort verlinkten Punkte
neu bewerten.

Was die Extension inhaltlich kann, ist [FEATURES.md](FEATURES.md); wie sie gebaut wird,
[BUILD.md](BUILD.md); die bekannten Einschränkungen [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

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
| `web-ext lint` | **0 Errors, 0 Notices**, 195 Warnings (alle aus den Vendor-Bundles) | `npm run lint:firefox` |
| Paketgröße | 16,4 MB zip / 54 MB entpackt — unter allen harten Store-Limits | `dist/*.zip` |
| CI | baut alle drei Targets, zippt, GitHub-Release auf `v*`-Tags | `.github/workflows/build.yml` |

Nicht vorhanden: `LICENSE`, eine geprüfte Datenschutzerklärung unter öffentlicher URL (ein Entwurf
liegt als [PRIVACY.md](PRIVACY.md) im Repo), Screenshots, Promo-Assets, Store-Accounts, Upload-Jobs
in der CI, Secrets (`.gitignore` listet nicht einmal `.env`).

### Lint-Warnings nach Quelle (195 gesamt, 0 Errors, 0 Notices)

`edu/index.html` und `wlo/examples/*.html` sind aus dem Paket ausgeschlossen (siehe B5);
`MISSING_DATA_COLLECTION_PERMISSIONS` ist keine Notice mehr (siehe §3).

```
 52  UNSAFE_VAR_ASSIGNMENT   edu/assets/tinymce
 16  UNSAFE_VAR_ASSIGNMENT   edu/scripts.js
 14  DANGEROUS_EVAL          edu/assets/tinymce
 28  UNSAFE_VAR_ASSIGNMENT   edu/assets/viewer-5.4.1414*.mjs
 12  DANGEROUS_EVAL          edu/assets/pdf.worker-5.4.1414*.mjs
  7  UNEXPECTED_GLOBAL_ARG / DANGEROUS_EVAL   edu/assets/cordova
  6  UNSAFE_VAR_ASSIGNMENT   boerdi/boerdi-widget.js
  5  DANGEROUS_EVAL          edu/pdf-metadata-page.module-*.js
  1  INLINE_SCRIPT           wlo/index.html
```

---

## 2. Blocker, die für jeden Store und jede Sichtbarkeit gelten

### B1 — Default-Endpunkte zeigen auf Staging *(vier von fünf blacklisted, Repository-Onboarding erledigt)*

`config.js:7` und `app-src/src/app/config.ts` nennen fünf Staging-Adressen. Vier sind mit der
aktuellen `featureBlacklist` nie erreichbar:

- MetalookUp (`https://metalookup-2.staging.openeduhub.net`) — `isFeatureEnabled('metalookup')`,
  geprüft in `QualityJudgeService.judge` vor jedem anderen Test.
- ContentJudge (`https://llm-contentjudge.staging.openeduhub.net`) — `isFeatureEnabled('contentJudge')`,
  zusätzlich zum fehlenden Default-Credential.
- Chatbot (`https://87.106.127.225.nip.io`, hartverdrahtet in `ai-assistant-screen.component.ts:21`) —
  die *Boerdi*-Sektion selbst ist unsichtbar, solange `wlo` blacklisted ist (`navigation.ts`).
- Nostr-Relay (`wss://amb-relay.edufeed.org`) — `NostrForwardService.blacklisted`.

Nimmt ein Deployment `metalookup`/`contentJudge`/`wlo`/`nostr` aus der Liste, ist der jeweilige Punkt
neu zu bewerten.

Die fünfte Adresse, `https://repository.staging.openeduhub.net/edu-sharing`, ist kein Default mehr —
die Extension startet ohne Repository und fragt es beim ersten Öffnen ab (Onboarding-Bildschirm,
`model/navigation.ts` Sektion `onboarding`, `NavigationService.land`); die Adresse steht dort nur
noch als anklickbarer Vorschlag. Der Metadata-Agent (`METADATA_AGENT_API_URL`, an
`APP_CONFIG.defaultRepositoryUrl` gepinnt) ist davon unberührt, aber mit `metadataAgentGenerate`
blacklisted ohnehin nicht erreichbar: `MetadataAgentService.run`/`runForUrl` (der einzige Aufruf, der
die gepinnte Adresse trifft) laufen nicht an, `CurationService.analyze()` fällt auf die lokale
Seiten-Auswertung (`readPage`, kein Netzwerk-Call) zurück — dieselbe, die schon bei `wlo` blacklisted
greift. **Latent, nicht aktiv:** ein Deployment, das `metadataAgentGenerate` reaktiviert, reaktiviert
damit auch die Pinning-Frage.

| | Was | Aufwand |
|---|---|---|
| B1-b | Chatbot-, ContentJudge- und MetalookUp-URL trotzdem konfigurierbar machen, für ein Deployment, das eine der Blacklists später lockert | ≈1–2 PT |

### B2 — Keine geprüfte Datenschutzerklärung, keine LICENSE *(hart)*

Weder `LICENSE`/`COPYING` noch ein rechtlich geprüftes Datenschutzdokument im Repo; das Manifest
nennt keine Policy-URL. Alle drei Stores verlangen eine Datenschutzerklärung, sobald Nutzerdaten
verarbeitet werden — und hier verlässt Folgendes das Gerät:

- bis **20 000 Zeichen** lesbarer Text plus **10 000 Zeichen HTML** der Seite (`content/content.js:5-76,199-215`), zusammen mit URL, Titel, allen Meta-/OG-/Twitter-/DC-/LRMI-Tags und JSON-LD
- ein **JPEG-Screenshot des sichtbaren Tabs** (`background/background.js:350-353`), wenn die Seite kein eigenes Vorschaubild nennt
- Repository-Zugangsdaten (Basic, nur im Login-Request), danach ein Session-Cookie mit `credentials: 'include'` (`background/background.js:111`)
- bis **50 000 Zeichen** Inhaltstext an ContentJudge, bis 20 000 an den Chatbot — beide mit der aktuellen `featureBlacklist` unerreichbar, siehe B1
- ein lokal erzeugter, dauerhafter Nostr-Schlüssel — der Pubkey geht an ein öffentliches Relay; mit
  der aktuellen `featureBlacklist` unerreichbar, siehe B1

**Ein Entwurf liegt als [PRIVACY.md](PRIVACY.md) im Repo** — deutschsprachig, mit Fundstellen
belegt, aber ausdrücklich als ungeprüft markiert (Platzhalter für Verantwortlichen, Rechtsgrundlagen
und Kontakt). Offen bleiben: externe juristische Abnahme, eine öffentlich erreichbare Hosting-URL
(erst dann kann das Manifest sie nennen), eine Support-URL und die LICENSE. **≈1–2 PT für die
verbleibende Textarbeit nach der Abnahme, plus die Abnahme selbst.**

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
**≈2–4 PT**, plus ≈1 PT für die Begründungstexte je Permission. `host_permissions` und
`activeTab`/`tabs`/`scripting`/`storage`/`cookies`/`identity` bleiben — die trägt Kernfunktion, nicht
eine der blacklisteten Features.

**Erledigt:** `clipboardRead` aus dem Manifest gestrichen (hing an einer Preview-Widget-Option, „Aus
der Zwischenablage einfügen" — Cmd/Ctrl+V bleibt über den `paste`-Event-Listener unberührt) und
`web_accessible_resources` von `["sidebar/*","edu/*","wlo/*","boerdi/*"]` auf `["sidebar/*","edu/*"]`
verengt — beide Bundles laden nur same-origin aus dem Sidebar-Dokument
(`web-component-bundle.service.ts`, `ai-assistant-screen.component.ts`), keine WAR-Freigabe nötig,
und sind mit `wlo`/`nostr` blacklisted ohnehin nie referenziert. **Bei einer späteren Freischaltung
von `wlo`/`nostr`:** `"wlo/*"`/`"boerdi/*"` müssen zurück in `manifest.base.json`, sonst bricht das
Nachladen der Bundles in genau dem Fall lautlos.

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

**Bewusst zurückgestellt.** Weder `wlo` noch `boerdi` sind mit der aktuellen Blacklist erreichbar
(siehe B1, B7), was den *Impact* eines AMO-Listed-Review-Stopps an dieser Stelle mindert — die
Quellcodepflicht selbst betrifft aber weiterhin alle drei Bundles unverändert, unabhängig davon, ob
ihr Code zur Laufzeit läuft: AMO prüft, was im Paket liegt, nicht was ausgeführt wird. Ohne
Firefox-listed-Absicht ist das kein aktueller Blocker; sobald Firefox-listed wieder ansteht, ist dies
weiterhin der schwerste offene Punkt und (a)/(b) bleiben ungelöst.

### B5 — Entwickler-Artefakte im Produktionspaket *(weich, schnell)*

`SHARED_DIRS` in `scripts/build.mjs` kopiert `background/` und `content/`, `BUNDLE_DIRS` die drei
Web-Component-Bundles — beide jetzt gefiltert statt verbatim (`SHARED_EXCLUDES`/`BUNDLE_EXCLUDES`,
`scripts/build.mjs`).

**Erledigt** (`npm run lint:firefox`: 204 → 195 Warnings, 0 Errors, 0 Notices): `content/HOST-EVENTS.md`
(24 KB Doku, für einen Repository-/OnlyOffice-Plugin-Integrator interessant, nicht für die laufende
Extension), `wlo/examples/*.html` (Demo-Seiten, Quelle der 4 `INLINE_SCRIPT`-Warnings) und
`edu/<version>/index.html` (Startseite des Bundles, die die Extension nie öffnet, Quelle der 5
`INLINE_SCRIPT`-Warnings dort) sind aus dem Paket ausgeschlossen. `wlo/index.html` bleibt gepackt —
anders als `edu/`s Startseite ist es load-bearing: die content-gehashten Dateinamen des wlo-Bundles
werden zur Laufzeit daraus gelesen ([WEB-COMPONENTS.md](WEB-COMPONENTS.md#loading-a-bundle)), sein
einzelner `INLINE_SCRIPT`-Warning bleibt.

**Bewusst nicht angefasst:** `background/dev-fixtures.js` — 21 KB gefakte Agent-Antworten inklusive
vollem Wikipedia-Text, von `sw.js`/`manifest.firefox.json` **immer** geladen. `developerOptions` ist
zwar blacklisted, wodurch `DevModeService` den Dev-Modus beim Laden zurück auf aus schreibt — aber
die Blacklist ist ein Deployment-Flag zum Wiederanschalten-und-neu-Bauen (`config.ts:73–78`), und
`dev-fixtures.js` fest aus dem Paket zu nehmen hieße, `sw.js`s `importScripts` und
`manifest.firefox.json`s `background.scripts` mit auszuschließen — beides müsste dann wieder rein,
sobald ein Deployment `developerOptions` reaktiviert, sonst bricht dessen Dev-Modus lautlos. Das an
die Blacklist zu koppeln bräuchte den Build-Schritt, der `config.ts` zur Build-Zeit liest — den gibt
es heute nicht, und ihn nur für 21 KB einzuführen, ist den Umbau nicht wert. Offen für eine
Wiedervorlage, falls die Größe doch einmal stört.

Prunbare Payload in `edu/assets` bleibt offen, der Mechanismus existiert bereits — `BUNDLE_EXCLUDES`
in `scripts/build.mjs` schließt Monaco so aus:

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

### B6 — `postMessage` ohne Origin-Prüfung *(mit der aktuellen Blacklist wirkungslos, Code bleibt unsauber)*

`content/panel-host.js:275-390` akzeptiert eingehende Envelopes allein am Marker
`data.source === 'edu-sharing-onlyoffice-plugin'` — **vor** dem
`event.source !== iframe.contentWindow`-Guard und ohne Origin-Check. Jede Seite im Tab kann damit
ein `PREVIEW_NODE` oder ein gefälschtes `DOCUMENT_INFO`/`DOCUMENT_CONTENT` in die Sidebar schieben.
Ausgehend wird an *alle* Frames mit `postMessage(envelope, '*')` gesendet.

`content/panel-host.js` ist ein Content-Script und liest die App-seitige Feature-Blacklist nicht —
der fehlende Origin-Check bleibt Code-Fakt, unabhängig von `featureBlacklist`. Die *Auswirkung* ist mit
der aktuellen Blacklist aber neutralisiert: `OnlyOfficeDocumentService.accept()` verwirft jede
`DOCUMENT_INFO`/`DOCUMENT_CONTENT`-Nachricht sofort, solange `onlyOfficeEvents` blacklisted ist
(`onlyoffice-document.service.ts:126`), und ein `PREVIEW_NODE` wird im Sidebar-seitigen
`onWindowMessage` (`app.component.ts:250-259`) ohnehin nie in den Flow übernommen — bewusst so gebaut,
seit vor dieser Blacklist. Ein forciertes `PREVIEW_NODE` landet also weiterhin in `storage.local`
(`eduSharingPendingPreview`), wird beim nächsten Boot aber nur gelesen und sofort verworfen
(`app.component.ts:consumePendingNode`, kommentiert „not adopted"), nicht angewendet.

Damit ist dies aktuell kein aktiver Blocker — aber der Origin-Check fehlt weiterhin im Code, und ein
Deployment, das `onlyOfficeEvents` reaktiviert, reaktiviert die Lücke mit. Origin-Check nachrüsten
bleibt sinnvoll, ist aber nicht mehr dringend. **≈0,5–1 PT, wenn `onlyOfficeEvents` je wieder an soll.**

### B7 — Stille Datenübertragungen *(vier von fünf sind mit einer Blacklist aus)*

- **MetalookUp und ContentJudge laufen nicht mehr.** Beide sind eigene `FeatureKey`-Einträge in
  `APP_CONFIG.featureBlacklist`, geprüft in `QualityJudgeService.judge` vor der *Einstellungen*-Checkbox
  und vor jedem anderen Test — unabhängig vom `wlo`-Stand und von einem gesetzten Credential. Die
  zugehörigen Checkboxen (*MetalookUp: Inhalt messen*, *ContentJudge: Inhalt per LLM bewerten*) und
  das Zugangsdaten-Feld (`#cj-auth`) sind aus *Einstellungen → Qualitätsprüfung* verschwunden statt
  nur wirkungslos.
- **Der Chatbot läuft nicht** — `wlo` blacklisted macht die Boerdi-Sektion unsichtbar (siehe B1).
- **Nostr-Publikation läuft nicht** — `nostr` blacklisted, `NostrForwardService.blacklisted` ist
  wahr, weder `publish` noch `lookup` erreicht je ein Relay.
- **Schriftarten sind lokal gebündelt** (`app-src/src/assets/fonts/`, Material Icons/Outlined,
  Material Symbols Outlined, mit Lizenz) — keine Google-Fonts-Anfragen mehr, die Hosts sind aus der
  CSP entfernt.
- Solange das Panel offen und eingeloggt ist, fragt `PageRecognitionService.recognize()`
  (`page-recognition.service.ts:111`, über `WebsiteInformationService`) für **jede URL, zu der der
  Tab navigiert,** das Repository per `getWebsiteInformation` — außer auf einem edu-sharing-Host
  selbst, mit bereits aktivem Inhalt, oder im Dev-Modus. Kernfunktion, nicht blacklist-gated, keine
  Korrektur nötig, nur zur Disclosure festgehalten.

**Noch offen (B1-b, B2-Rest, B3-Rest, B5-Rest): ≈4–7 PT**, ohne die externen Abhängigkeiten
(Produktions-Deployments, juristische Abnahme, Bundle-Quellen) und ohne B4 und B6, die als
zurückgestellt bzw. derzeit wirkungslos gelten (s.o.).

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
| **`data_collection_permissions`** | **Gesetzt.** `manifest.firefox.json` → `browser_specific_settings.gecko.data_collection_permissions.required: ["websiteContent","authenticationInfo","browsingActivity"]` (Seitentext/Screenshot, Repository-Login, die pro Navigation gemeldete URL). Nostr/Chatbot/ContentJudge bewusst nicht gelistet — sie laufen mit der aktuellen Blacklist nicht (B1/B7); kommt eines davon zurück, muss die Liste neu geprüft werden. `strict_min_version` steht entsprechend auf `140.0` (Voraussetzung für das Feature selbst). `npm run lint:firefox` meldet die `MISSING_DATA_COLLECTION_PERMISSIONS`-Notice seither nicht mehr. |
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
edu-sharing-Repositories. Sie hat keinen Repository-Default mehr, aber die Kernfunktion bleibt
außerhalb eines einzigen, gepinnten Repositorys nicht nutzbar, sobald ein Deployment
`metadataAgentGenerate` reaktiviert (siehe B1) — die Agent-Adresse ist auf
`APP_CONFIG.defaultRepositoryUrl` gepinnt, und in einem fremden Core-Repo antwortet der Proxy also
nicht.

---

## 5. Was ein Reviewer voraussichtlich anspricht

Nach den Korrekturen aus §2 bleiben:

- `host_permissions https://*/*` plus programmatische Injektion in jede Seite — bleibt, trägt
  Kernfunktion (B3)
- `tabs` und `captureVisibleTab` — Screenshots der besuchten Seite
- Off-Device-Übertragung von vollem Seitentext an den Metadata-Agent — das Kern-Erschließungsflow,
  bleibt. MetalookUp, ContentJudge und der Chatbot dagegen **nicht mehr**: alle drei sind mit der
  aktuellen `featureBlacklist` unerreichbar, siehe B1
- 54 MB Vendor-Bundles mit Fremdcode; `frame-ancestors *` im CSP
- der Origin-lose `postMessage`-Eingangspfad in `content/panel-host.js` — mit der aktuellen Blacklist
  ohne Wirkung, aber im Code weiterhin vorhanden (B6)
- AMO: Quellcodepflicht bleibt (B4), zurückgestellt solange Firefox-listed nicht ansteht;
  `data_collection_permissions` ist gesetzt

Bereits behoben und keine Reviewer-Punkte mehr, mit Nachweis im jeweiligen Blocker: `clipboardRead`,
die volle `web_accessible_resources`-Freigabe, die hartverdrahtete Chatbot-IP, Nostr-Publikation
kuratierter Metadaten und die unabschaltbaren MetalookUp-/ContentJudge-Läufe (alle B1/B3/B7). Der
Google-Fonts-Fetch zur Laufzeit ist technisch behoben (B7) und war ohnehin kein Reviewer-*Blocker*,
eher ein DSGVO-Punkt für die Datenschutzerklärung (B2).

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
