# Datenschutzerklärung (Entwurf)

> **ENTWURF — nicht rechtlich geprüft.** Dieses Dokument beschreibt technisch, was die Extension in
> der Auslieferung mit der aktuellen `APP_CONFIG.featureBlacklist` (`app-src/src/app/config.ts:95-102`)
> sendet und speichert. Platzhalter für Verantwortlichen, Kontakt und Rechtsgrundlagen sind mit `TODO`
> markiert und noch nicht ausgefüllt; die Formulierungen sind noch nicht juristisch abgenommen. Ein
> Deployment, das einen der blacklisteten Einträge (`onlyOfficeEvents`, `nostr`, `wlo`,
> `developerOptions`, `metalookup`, `contentJudge`) wieder freischaltet, muss dieses Dokument neu
> prüfen — Abschnitt 3 nennt zu jedem, was er zusätzlich sendet.
>
> Es gibt noch keine öffentlich erreichbare URL für dieses Dokument; das Manifest nennt entsprechend
> noch keine `privacy_policy`-Adresse. Siehe [STORE-RELEASE.md](STORE-RELEASE.md) § B2.

## 1. Verantwortlicher

`TODO` — Name, Anschrift und Kontaktdaten der für die Datenverarbeitung verantwortlichen Stelle.

## 2. Was die Erweiterung tut, und warum sie weitreichende Berechtigungen braucht

Die Extension liest die Seite aus, die im Browser gerade offen ist, um daraus über ein edu-sharing-
Repository Metadaten für eine Lernressource zu erzeugen. Weil dabei jede beliebige Seite betroffen
sein kann, verlangt das Manifest Zugriff auf alle Seiten (`host_permissions`,
[TROUBLESHOOTING.md § Permissions](TROUBLESHOOTING.md#permissions)).

Diese Berechtigung wird nicht automatisch ausgenutzt: Die Extension startet ohne konfiguriertes
Repository und fragt beim allerersten Öffnen danach (Onboarding-Bildschirm). Vor dieser Eingabe wird
kein Repository und kein anderer Dienst kontaktiert.

## 3. Datenkategorien und Empfänger

### 3.1 Inhalt der ausgelesenen Seite

Beim Start einer Erschließung liest die Extension die aktive Seite aus
(`content/content.js:5-76`, Zeichenbegrenzungen `:199-215`) und sendet das Ergebnis an den
Metadaten-Agenten:

- bis zu 20 000 Zeichen lesbarer Text, bis zu 10 000 Zeichen HTML des Hauptinhalts
- Titel, Adresse, alle Meta-, Open-Graph-, Twitter-, Dublin-Core- und LRMI-Tags
- **alle** `<script type="application/ld+json">`-Blöcke der Seite, vollständig geparst — hier können
  Namen, E-Mail-Adressen oder Organisationsdaten stehen, die die Seite selbst einbettet
- erkannte Autor-, Lizenz- und Bildangaben

Zusätzlich, wenn die Seite kein eigenes Vorschaubild nennt: ein JPEG-Screenshot des sichtbaren
Tab-Bereichs (`background/background.js:350-353`). Der Screenshot kann als Vorschaubild des erzeugten
Inhalts ins Repository hochgeladen werden (`curation.service.ts:898-900`) und dort dauerhaft
gespeichert bleiben.

**Empfänger:** Der Metadaten-Agent hinter dem Repository-Proxy, aktuell fest auf
`https://repository.staging.openeduhub.net` (`METADATA_AGENT_API_URL`,
`metadata-agent-api.service.ts:6-8`) — unabhängig davon, welches Repository in den Einstellungen
eingetragen ist. Die Anfrage trägt das Sitzungs-Cookie des angemeldeten Repositorys
(`background/background.js:111`).

### 3.2 Besuchte Adressen

Solange das Panel geöffnet und eine Sitzung angemeldet ist, fragt die Extension bei jeder Navigation
des Tabs beim konfigurierten Repository nach, ob die neue Adresse bereits als Inhalt bekannt ist
(`page-recognition.service.ts:111`, `website-information.service.ts:58`) — mit Ausnahmen für
edu-sharing-Seiten selbst und für Seiten, deren Inhalt bereits geöffnet ist.

**Empfänger:** das konfigurierte Repository.

### 3.3 Zugangsdaten und Sitzung

Beim Login mit Benutzername und Passwort wird das Passwort einmalig an das Repository gesendet;
danach trägt jede weitere Anfrage nur noch das vom Repository gesetzte Sitzungs-Cookie
(`auth.service.ts:214-227`). Bei einer Anmeldung über SSO (OAuth/PKCE) werden Zugriffs- und
Refresh-Token dauerhaft in der Browser-Erweiterung gespeichert (`oauth.js:26,642-659`), um die
Sitzung nach einem Neustart automatisch wiederherzustellen.

**Empfänger:** das konfigurierte Repository und, bei SSO, dessen Identity Provider.

### 3.4 Im aktuellen Build abgeschaltete Funktionen

Diese vier sind über `APP_CONFIG.featureBlacklist` fest deaktiviert und senden in der ausgelieferten
Version **nichts**:

| Funktion | Würde senden, wenn aktiviert |
|---|---|
| MetalookUp | Seiten-URL bzw. Repository-Node-ID an eine externe Analyse-API, die die Seite selbst abruft |
| ContentJudge | bis zu 50 000 Zeichen Seitentext an eine LLM-gestützte Bewertung |
| Boerdi-Chatbot | bis zu 20 000 Zeichen Seitentext plus Seitenkontext an einen Chatbot-Dienst |
| Nostr-Relay | kuratierte Metadaten inkl. Autorenangaben, dauerhaft signiert mit einem lokal erzeugten Schlüssel, an ein **öffentliches, unveränderliches** Relay — einmal gesendete Daten können von dort nicht zurückgezogen werden |

Ein Deployment, das einen dieser Einträge aus der Blacklist entfernt, muss diesen Abschnitt und die
zugehörige Zeile in Abschnitt 4 neu bewerten.

### 3.5 Schriftarten

Die Icon-Schriftarten sind im Erweiterungspaket enthalten (`sidebar/assets/fonts/`) und werden
lokal geladen. Für Schriftarten werden keine Verbindungen zu Google aufgebaut.

## 4. Lokale Speicherung

Ausschließlich im Browser dieser Installation, nirgends sonst:

| Was | Details |
|---|---|
| Repository-URL | die eingetragene Adresse |
| Verlauf | bis zu 200 Einträge bearbeiteter Seiten, je mit Adresse, Titel und Zeitpunkt |
| Sitzungsdaten | OAuth-Zugriffs- und Refresh-Token, wo SSO genutzt wird |
| ContentJudge-Zugangsdaten | im Klartext, nur falls in den Einstellungen ein Zugang eingetragen wurde (Funktion aktuell abgeschaltet, s.o.) |
| Nostr-Schlüssel | ein dauerhafter, lokal erzeugter Schlüssel, nur falls die Nostr-Anbindung aktiviert wird (aktuell abgeschaltet, s.o.); ohne Export- oder Backup-Funktion |
| Übrige Einstellungen | Theme, Funktionsschalter, Entwicklungsoptionen |

## 5. Berechtigungen (Manifest)

| Berechtigung | Wofür |
|---|---|
| `host_permissions` (`https://*/*`, `http://*/*`) | Seiteninhalt auf jeder Seite auslesen, CORS-freie Anfragen an das Repository, Sitzungs-Cookie mitsenden |
| `activeTab` | Zugriff auf den aktiven Tab, wenn das Panel geöffnet wird |
| `tabs` | Adresse und Titel des Tabs lesen, Tab-Wechsel erkennen |
| `scripting` | das Auslese-Skript in die Seite einfügen |
| `storage` | die in Abschnitt 4 genannten Daten lokal ablegen |
| `cookies` | auf Wunsch die Repository-Cookies löschen (Sitzung zurücksetzen) |
| `identity` | den SSO-Login-Vorgang (OAuth) durchführen |

Ausführlicher begründet in [TROUBLESHOOTING.md § Permissions](TROUBLESHOOTING.md#permissions).

## 6. Speicherdauer

`TODO` — je Kategorie festzulegen. Bekannt: der Verlauf ist bei 200 Einträgen rollierend (älteste
Einträge fallen heraus), der Nostr-Schlüssel wird unbegrenzt gehalten, sobald er einmal erzeugt wurde.

## 7. Rechte der betroffenen Personen

`TODO` — abhängig vom Verantwortlichen (Abschnitt 1).

## 8. Kontakt

`TODO`

## 9. Stand

Erster Entwurf, erstellt im Rahmen von [STORE-RELEASE.md](STORE-RELEASE.md) § B2, auf Basis des
Auslieferungsstands mit `APP_CONFIG.featureBlacklist` vom 15.09.2026.
