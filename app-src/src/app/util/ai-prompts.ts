// The German task texts the panel puts to the KI assistant, one entry per task: the five steps of the quality
// check, the two reminders that close two of them, and the lines that say where the content's own text stands.
// Every entry holds the lines of one task in the order they are sent, with the runtime values already put in.
// What stays with the caller in `quality-check-request.ts` is the assembly around them — collapsing the blank
// lines and choosing which line about the text the content's state calls for.
//
// The empty entries are part of the text: they are the blank lines of the outgoing task, and the caller keeps
// only the ones whose predecessor is filled. An entry that is switched off by its condition therefore reads as
// `''` in one task and as a dropped array element in another, and the two are not interchangeable.
//
// Where the line runs: what is here is what goes out as the turn's `host_instruction`, together with the chip
// labels the texts quote. The German that goes out as the *schema* of the answer — the `description` texts of
// the four schemas — stands in `ai-schemas.ts`, bound to the shape it describes. The two overlap in content on
// purpose: the instruction says a rule where the person reads it, the description says it again where the
// model fills the answer in. Why a task is worded the way it is stays in the docblock of its builder in
// `quality-check-request.ts`, which is also where each of these entries is called.
//
// Four couplings to hold in mind when a wording changes here:
//   * the chip labels in `AI_REPLIES` are quoted verbatim in these texts — a task that names other buttons
//     than the ones offered leaves the person answering nothing;
//   * the glyphs the verdict is asked for in (✓ ✗ ○) are what `chat-overrides.ts` colours the assistant's
//     lines by, so asking for another glyph leaves the verdicts uncoloured;
//   * the footer the closing word points at is labelled in `action-bar.service.ts`, and the task names that
//     label in words;
//   * the schema `description` texts in `ai-schemas.ts` say the same rules a second time, as described above.

import type { CheckSubject, QualityCriterion } from './quality-check-request';

/** The vocabularies to look up, quoted and enumerated for the task's sentence. */
function askedVocabularies(names: readonly string[]): string {
  const quoted = names.map((vocabulary) => `"${vocabulary}"`);
  return [quoted.slice(0, -1).join(', '), quoted[quoted.length - 1]].join(' und ');
}

/**
 * The two answers each step offers as chips, in the order they are shown. Handed to the widget rather than left
 * to it: its own generator composes the chips from the assistant's answer and regularly offers something else
 * entirely — *„Was bedeuten die Lizenzen?"* under the question whose content this is — and a step whose way on
 * is a tap needs that tap to be there. They stand for the whole step, so a person who asks for changes is
 * offered the same two again in the turn after, which is what eventually carries the check to its end.
 *
 * They stand here rather than in the screen that offers them because the tasks name them word for word: the
 * label and the sentence that points at it are one text, and a change to either is a change to both.
 */
export const AI_REPLIES = {
  origin: ['Inhalt selbst erstellt', 'Inhalt nicht selbst erstellt'],
  proofread: ['Ich bestätige die Korrekturen', 'Korrekturen überspringen'],
  quality: ['Qualität bestätigen', 'Anpassungen vornehmen'],
  enrichment: ['Metadaten bestätigen', 'Anpassungen vornehmen']
} as const;

export const AI_PROMPTS = {
  /** Step 1: greet, state what is coming, guess whose content this is and ask. */
  origin: (subject: CheckSubject): readonly string[] => {
    // Accusative: it reads "… dass ihr jetzt gemeinsam <named> prüft".
    const named = subject.title ? `den Inhalt „${subject.title}“` : 'diesen Inhalt';
    return [
      `Begrüße die Person und sag ihr, dass ihr jetzt gemeinsam ${named} prüft.`,
      'Sag in einem Satz, was ansteht: erst die Qualitätsprüfung, danach das Anreichern der Metadaten. Bei ' +
        'einem eigenen Inhalt schaust du vorher noch auf Rechtschreibung und Sprache.',
      'Sag ihr dann, wovon du ausgehst, in einem Satz und mit dem Grund. Was dafür bekannt ist:',
      `- Quelle: ${subject.url ?? 'nicht bekannt'}`,
      `- als Urheber genannt: ${subject.author ?? 'niemand'}`,
      `- angemeldet ist: ${subject.signedIn ?? 'unbekannt'}`,
      'Eine fremde Website als Quelle spricht für einen fremden Inhalt; ein Urheber, der der angemeldeten ' +
        'Person entspricht, für einen eigenen. Sag ausdrücklich, dass das deine Vermutung ist.',
      'Stell ihr dann genau eine Frage: ob sie den Inhalt selbst erstellt beziehungsweise verantwortet oder ob ' +
        'es ein fremder ist, den sie nur einordnet. Ihre Antwort gilt, auch wenn sie deiner Vermutung ' +
        'widerspricht.',
      'Unter deiner Nachricht werden ihr die beiden Antworten als Buttons angeboten: „Inhalt selbst erstellt“ ' +
        'und „Inhalt nicht selbst erstellt“. Du musst sie nicht ausschreiben und keine Antwortvorschläge ' +
        'auflisten — deine Nachricht endet mit der Frage, danach kommt kein Satz mehr. Sie darf auch mit ' +
        'eigenen Worten antworten.',
      'Beurteile in diesem Zug nichts und lies den Inhalt nicht. Es geht allein um diese Frage.',
      'Warte ihre Antwort ab. Rufe submit_result ERST auf, wenn sie geantwortet hat — mit origin="own" ' +
        'oder origin="external" und deiner Vermutung in guess. Setz origin nicht auf deine Vermutung.',
      'Ist die Antwort unklar, frag nach, statt dich selbst zu entscheiden.'
    ];
  },

  /** Step 2, on one's own content: the language pass, ahead of the line about where the text stands. */
  proofread: (subject: CheckSubject): readonly string[] => {
    // Genitive: it reads "… die Sprache VON <named> durch".
    const named = subject.title ? `„${subject.title}“` : 'diesem Inhalt';
    return [
      `Das ist ein eigener Inhalt. Geh deshalb zuerst die Sprache von ${named} durch: Rechtschreibung, ` +
        'Grammatik und Zeichensetzung. Der Schritt ist fertig, wenn die Person deine Korrekturen ' +
        'durchgegangen ist und gesagt hat, was sie damit macht.',
      'Du selbst änderst am Inhalt nichts und kannst es auch nicht: die Korrekturen sind eine Liste für die ' +
        'Person, die sie in ihrem Text selbst einträgt. Es wird dadurch nichts gespeichert, nichts überarbeitet ' +
        'und nichts weitergegeben. Behaupte also nie, du hättest etwas korrigiert, übernommen oder ' +
        'weitergegeben, und stell auch die Zustimmung der Person nicht so dar.',
      subject.collection
        ? 'Nutze dafür die Skills der Sammlung, die zu Sprache oder Rechtschreibung etwas sagen: ' +
          'hol dir mit get_skill_registry die Liste und mit get_skill jede Anleitung, die dazu passt, und halte ' +
          'dich an sie. Gibt es dazu keine, korrigiere nach den Regeln der deutschen Rechtschreibung.'
        : '',
      'Zitiere jede beanstandete Stelle wörtlich, wie sie im Text steht, und stell die Korrektur daneben. ' +
        'Erfinde keine Stelle, die dort nicht steht.',
      'Ist sprachlich nichts zu beanstanden, sag das und gib eine leere Liste ab — auch das ist ein Ergebnis.',
      'Es geht allein um die Sprache. Sag in diesem Schritt nichts zur Sachrichtigkeit: nicht, ob eine Aussage, ' +
        'eine Formel, eine Zahl oder eine Quelle fachlich stimmt, und auch nichts zu Vollständigkeit, Niveau, ' +
        'Didaktik oder Aufbau. Das bewerten wir später anhand der Qualitätskriterien. Ein fachlicher Fehler ist ' +
        'hier also kein Befund, solange die Stelle sprachlich richtig geschrieben ist.',
      '',
      'Nenne die Stellen zuerst im Chat, je Stelle eine Zeile mit dem Wortlaut und der Korrektur darunter. ' +
        'Die Person sieht nur den Chat — was dort nicht steht, erfährt sie nicht.',
      'Bitte sie danach ausdrücklich zu entscheiden, was mit den Stellen passieren soll, und lass ihr beide Wege ' +
        'offen: Sie kann die Korrekturen annehmen und selbst in ihren Text eintragen — oder sie überspringen, ' +
        'wenn sie den Text gerade nicht ändern kann; dann bleibt er, wie er ist. Beides ist in Ordnung, und der ' +
        'Schritt ist mit beidem fertig. Dräng sie nicht zur Korrektur.',
      'Unter deiner Nachricht werden ihr beide Antworten als Buttons angeboten: „Ich bestätige die Korrekturen“ ' +
        'und „Korrekturen überspringen“. Du musst sie nicht ausschreiben. Deine Nachricht endet mit der Frage, ' +
        'danach kommt kein Satz mehr — was du nicht prüfen konntest, sagst du davor.',
      'Hast du nichts gefunden, sag das in einem Satz und frag, ob es weitergehen soll: sie beendet den Schritt ' +
        'dann mit einem der beiden Buttons, und beide bedeuten hier dasselbe, weil es nichts zu korrigieren gibt.',
      'Rufe submit_result ERST auf, wenn sie geantwortet hat — mit den gefundenen Stellen und mit ' +
        'decision="accepted" oder decision="skipped", je nachdem, was sie gesagt hat. In dem ' +
        'Zug, in dem du die Korrekturen nennst, rufst du es nicht auf: dieser Zug endet mit der Frage. Ohne den ' +
        'Aufruf ist das Ergebnis für uns nicht da, auch wenn es im Chat steht.',
      'Sag ihr danach in einem Satz, wie es steht — bei „accepted“, dass sie die Stellen in ihrem Text ' +
        'nachziehen kann, bei „skipped“, dass der Text unverändert bleibt — und dass als Nächstes die ' +
        'Qualitätsprüfung folgt. Sag in keinem der beiden Fälle, der Text sei geändert worden.',
      ''
    ];
  },

  /** The rules of the language pass again at the end of the task — the last thing read before the answer. */
  proofreadReminder: [
    '',
    '---',
    'Zur Erinnerung, bevor du antwortest:',
    '- Es geht allein um die Sprache: Rechtschreibung, Grammatik, Zeichensetzung. Kein Wort zur Sachrichtigkeit, ' +
      'auch wenn im Text fachlich etwas falsch ist — Aussagen, Formeln, Zahlen und Quellen bewerten wir im ' +
      'nächsten Schritt anhand der Qualitätskriterien. Eine fachlich falsche, aber korrekt geschriebene Stelle ' +
      'ist hier kein Befund.',
    '- Zitiere jede Stelle wörtlich, wie sie im Text steht, und stell die Korrektur daneben.',
    '- Der letzte Satz deiner Nachricht ist die Frage, was mit den Stellen passieren soll — auch dann, wenn du ' +
      'nichts gefunden hast. Die Antworten dazu werden ihr als Buttons angeboten; du listest keine ' +
      'Antwortvorschläge auf und schreibst nach der Frage keinen Satz mehr.',
    '- Du änderst den Text nicht und gibst nichts weiter. Sag nie, etwas sei korrigiert oder übernommen worden.',
    '- Rufe submit_result in diesem Zug nicht auf. Erst wenn die Person geantwortet hat, und dann mit ' +
      'decision="accepted" oder decision="skipped".'
  ],

  /** Step 3: the verdict over the criteria, ahead of the line about where the text stands. */
  quality: (criteria: readonly QualityCriterion[], subject: CheckSubject): readonly string[] => {
    const { title, collection } = subject;
    // Dative: the one place it is used reads "… bei der Erschließung VON <named>".
    const named = title ? `dem Inhalt „${title}“` : 'dem Inhalt der aktuellen Seite';
    const forCollection = collection ? ` für die Sammlung „${collection}“` : '';
    return [
      `Bewerte die Qualität von ${named}${forCollection}.`,
      'Gemeint ist genau dieser eine Inhalt. Beurteile NICHT die übrigen Inhalte der Sammlung und nicht die ' +
        'Sammlung als Ganzes.',
      'Danach folgt noch ein Schritt: das Anreichern der Metadaten. Dieser hier ist fertig, wenn die Person ' +
        'deine Bewertung durchgegangen ist und sie bestätigt hat.',
      '',
      'Das sind unsere Prüfdimensionen. Beurteile jede einzeln:',
      criteria.map((item) => `${item.key}: ${item.caption}`).join('\n'),
      collection
        ? 'Nutze dafür alle zur Sammlung verfügbaren Qualitätssicherungsskills und ihre Prüfdimensionen: hol ' +
          'dir mit get_skill_registry die Liste und mit get_skill jede Anleitung, die zu einer dieser ' +
          'Dimensionen etwas sagt, und urteile danach.'
        : '',
      collection
        ? 'Prüft eine Anleitung etwas, wofür es oben keine Dimension gibt, dann ordne es der nächstliegenden ' +
          'zu, wenn es dorthin gehört. Gehört es nirgends hin, lass es in dein Gesamturteil (suitable) ' +
          'einfließen und sag es in der Zusammenfassung — als eigenes Kriterium können wir es nicht führen.'
        : '',
      'Zu jedem Kriterium gibt es drei mögliche Ergebnisse: „met“, wenn der Inhalt es erfüllt, ' +
        '„violated“, wenn er es verletzt, und „unclear“, wenn der Inhalt nichts hergibt, woran sich das ' +
        'entscheiden ließe.',
      'Rate nicht: sag „unclear“, statt dich für eine der beiden Seiten zu entscheiden. Bei „unclear“ tragen wir ' +
        'zu diesem Kriterium nichts ein — die Begründung sagt dann, was zum Prüfen gefehlt hat.',
      'Sag am Ende außerdem, ob der Inhalt für den Einsatz in Bildung geeignet ist — dein Gesamturteil über ' +
        'alle Dimensionen und alles, was die Anleitungen sonst noch prüfen.',
      '',
      'Schreib dein Urteil zuerst in den Chat: je Kriterium eine Zeile mit ✓ (erfolgreich), ✗ (Probleme ' +
        'gefunden) oder ○ (unklar), dem Namen des Kriteriums und dem Grund in einem Satz, darunter dein ' +
        'Gesamturteil, ob der Inhalt für Bildung geeignet ist, und ' +
        'ein kurzes Fazit, was einer Freigabe im Weg steht. Die Person sieht nur den Chat — was dort nicht ' +
        'steht, erfährt sie nicht.',
      'Bitte sie danach ausdrücklich, dein Urteil durchzugehen und zu bestätigen oder Anpassungen vorzunehmen. ' +
        'Führe sie zu dieser Entscheidung: frag direkt, ob es so stehen bleiben soll, und geh auf ihre Einwände ein.',
      'Unter deiner Nachricht werden ihr die beiden Antworten als Buttons angeboten: „Qualität bestätigen“ und ' +
        '„Anpassungen vornehmen“. Du musst sie nicht ausschreiben. Deine Nachricht endet mit der Frage, danach ' +
        'kommt kein Satz mehr.',
      'Wählt sie „Anpassungen vornehmen“: nimm ihre Änderungen auf, zeig das Urteil, wie es damit lautet, und ' +
        'stell dieselbe Frage erneut. So oft, wie sie Anpassungen will — der Schritt endet erst mit ihrer ' +
        'Bestätigung, und jede deiner Nachrichten endet deshalb mit dieser Frage.',
      'Rufe submit_result ERST auf, wenn sie bestätigt hat — vorher nicht, auch wenn dein Urteil längst fertig ' +
        'ist.',
      'Sobald sie bestätigt: Rufe submit_result in genau diesem Zug auf, mit ihren Korrekturen, falls sie welche ' +
        'hatte, mit confirmed=true und zu jedem Kriterium outcome und reason. Eine Bestätigung im Chat ' +
        'allein reicht nicht — ohne diesen Werkzeugaufruf ist das Ergebnis für uns nicht da und es geht nicht ' +
        'weiter. Sag ihr dann, dass als Nächstes die Metadaten angereichert werden.',
      ''
    ];
  },

  /** The rules of the verdict again at the end of the task. */
  qualityReminder: [
    '',
    '---',
    'Zur Erinnerung, bevor du antwortest:',
    '- Rufe submit_result in diesem Zug nicht auf. Erst wenn die Person bestätigt hat, und dann mit ' +
      'confirmed=true. Wählt sie „Anpassungen vornehmen“, arbeitest du sie ein und fragst erneut.',
    '- Schreib dein Urteil in den Chat, und der letzte Satz deiner Nachricht ist die Frage, ob es so stehen ' +
      'bleiben soll. Die Antworten dazu werden ihr als Buttons angeboten; du listest keine Antwortvorschläge ' +
      'auf und schreibst nach der Frage keinen Satz mehr.'
  ],

  /** Step 4: enrich the metadata from the prescribed vocabularies. */
  enrichment: (subject: CheckSubject, vocabularies: readonly string[]): readonly string[] => {
    // Dative: it reads "… die Metadaten VON <named> an".
    const named = subject.title ? `„${subject.title}“` : 'diesem Inhalt';
    return [
      `Letzter Schritt: Reichere jetzt die Metadaten von ${named} an — demselben Inhalt, den du gerade ` +
        'geprüft hast. Der Schritt ist fertig, wenn die Person deine Werte bestätigt hat.',
      ...(subject.collection
        ? [
            'Falls die Sammlung für das Anreichern von Metadaten eine Anleitung freigegeben hat, hol sie dir ' +
              '(get_skill_registry, dann get_skill) und halte dich an sie. Gibt es dazu keine, reichere nach ' +
              'den folgenden Vorgaben an.'
          ]
        : []),
      'Hol dir Fach, Bildungsstufe, Materialtyp und Zielgruppe aus den vorgegebenen Vokabularen: ' +
        `lookup_wlo_vocabulary mit vocabulary=${askedVocabularies(vocabularies)}. ` +
        'Gib zu jedem Wert die Bezeichnung UND die vollständige URI an, wie das Vokabular sie zurückgibt.',
      'Jedes dieser vier Felder ist eine Liste: nenne alle zutreffenden Werte, nicht nur den ersten. Ein Fach ' +
        'ist es oft, eine Zielgruppe meist mehrere — etwa Lehrende und Lernende zugleich.',
      'Bilde keine URI selbst — eine geratene trifft still nichts. Gibt der Inhalt zu einem Feld nichts her, ' +
        'lass die Liste leer, statt zu raten.',
      'Nenne dazu fünf bis zehn Schlagworte aus dem Inhalt selbst.',
      '',
      'Nenne die Werte zuerst im Chat, je Wert eine Zeile mit Bezeichnung und URI, darunter die Schlagworte. ' +
        'Die Person sieht nur den Chat.',
      'Bitte sie danach ausdrücklich, die Werte durchzugehen und zu bestätigen oder zu korrigieren. Führe sie ' +
        'zu dieser Bestätigung: frag direkt, ob die Metadaten so übernommen werden sollen.',
      'Unter deiner Nachricht werden ihr die beiden Antworten als Buttons angeboten: „Metadaten bestätigen“ und ' +
        '„Anpassungen vornehmen“. Du musst sie nicht ausschreiben. Deine Nachricht endet mit der Frage, danach ' +
        'kommt kein Satz mehr.',
      'Wählt sie „Anpassungen vornehmen“: nimm ihre Änderungen auf, zeig die Werte, wie sie damit lauten, und ' +
        'stell dieselbe Frage erneut. So oft, wie sie Anpassungen will — der Schritt endet erst mit ihrer ' +
        'Bestätigung, und jede deiner Nachrichten endet deshalb mit dieser Frage.',
      'Rufe submit_result ERST auf, wenn sie bestätigt hat — mit ihren Korrekturen, falls sie welche hatte, und ' +
        'mit confirmed=true. In dem Zug, in dem du die Werte vorschlägst, rufst du es nicht auf: dieser Zug ' +
        'endet mit der Frage. Ohne den Aufruf ist das Ergebnis für uns nicht da, auch wenn es im Chat steht.'
    ];
  },

  /** Step 5: the closing word, which asks for nothing back. */
  closing: (subject: CheckSubject): readonly string[] => {
    // Dative: it reads "… die Prüfung VON <named>".
    const named = subject.title ? `„${subject.title}“` : 'diesem Inhalt';
    return [
      `Die Person hat die Metadaten bestätigt. Damit ist die Prüfung von ${named} vollständig abgeschlossen.`,
      'Gratuliere ihr kurz und sag ihr, was geschafft ist: Herkunft geklärt, Qualität geprüft, Metadaten ' +
        'angereichert und bestätigt.',
      'Sag ihr, dass sie jetzt zum nächsten Schritt weitergehen kann — unten im Panel mit „Abschließen und ' +
        'zur Inhaltsübersicht“.',
      'Zwei bis drei Sätze genügen. Stell keine Frage mehr, schlag keine weiteren Werte vor und rufe ' +
        'submit_result nicht auf: es ist nichts mehr zu bestätigen.'
    ];
  },

  /**
   * Where the content's own text stands. The task names it rather than quoting it — the wording travels in the
   * turn's page context — so these lines point at it and say what to do where it is cut short or missing.
   */
  content: {
    inContext:
      '\nDen Wortlaut dieses Inhalts findest du im Seitenkontext dieses Gesprächs, als Text der Seite.',
    truncated: '\nDort ist er abgeschnitten.',
    truncatedFetch: ' Den vollständigen Text bekommst du mit get_url_text von der Adresse der Seite.',
    missing: '\nDer Volltext dieses Inhalts liegt dem Gespräch nicht bei.',
    missingFetch:
      '\nHol ihn dir mit get_url_text von der Adresse der Seite, bevor du urteilst. Erst wenn auch das ' +
      'nichts hergibt, gilt ein Kriterium mangels Text als nicht prüfbar.',
    missingNoFetch:
      '\nBeurteile, was der Seitenkontext hergibt, und sag bei jedem Kriterium ausdrücklich, wenn es ' +
      'mangels Text nicht prüfbar war.'
  }
} as const;
